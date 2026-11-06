const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../../shared_logic');
const {calculateAnomalies} = shared;
const {load, save} = require('../../lib/attendance/shift-history');
const {render, fixture} = require('../fixtures/report-renderer');
const fs = require('node:fs');
const vm = require('node:vm');

function cloud() {
    const rows = new Map();
    return {
        failWrite: false,
        from(table) {
            if (table === 'employees') {
                return {select: () => ({eq: (_, name) => ({
                    maybeSingle: async () => ({data: name === '테스트직원' ? {name} : null})
                })})};
            }
            assert.equal(table, 'app_settings');
            return {
                upsert: async (row, options) => {
                    assert.equal(options.onConflict, 'module,key');
                    if (this.failWrite) return {error: new Error('저장 권한 없음')};
                    rows.set(row.key, row);
                    return {error: null};
                },
                select: () => ({eq: (_, module) => ({order: () => ({
                    range: async (from, to) => ({data: [...rows.values()]
                        .filter(row => row.module === module).slice(from, to + 1)})
                })})})
            };
        }
    };
}

test('저장 후 다시 불러온 근무조 이력으로 적용일 이후의 지각과 조퇴를 판정한다', async () => {
    const client = cloud();
    await save(client, '테스트직원', '2026-11-09', '08:30', '17:30');
    await save(client, '테스트직원', '2026-10-01', '09:30', '18:00');
    const history = (await load(client)).get('테스트직원');
    const dates = ['2026-09-30', '2026-10-01', '2026-11-09'];
    const anomalies = calculateAnomalies(dates.map(date => ({
        이름: '테스트직원', 날짜: date, 출근: '09:20', 퇴근: '17:45', 근무조: '0900-1800'
    })), {
        employeeConfigList: [{name: '테스트직원', shift: '0900-1800', shiftHistory: history}],
        currentUniqueDates: new Set(dates)
    });
    assert.deepEqual(anomalies.map(a => [a.date, a.shift, a.inAnom, a.outAnom]), [
        ['2026-09-30', '0900-1800', true, true],
        ['2026-10-01', '0930-1800', false, true],
        ['2026-11-09', '0830-1730', true, false]
    ]);
});

test('같은 날짜의 변경을 다시 저장하고 잘못된 입력이나 실패 시 기존 이력을 보존한다', async () => {
    const client = cloud();
    await save(client, '테스트직원', '2026-10-01', '09:00', '18:00');
    await save(client, '테스트직원', '2026-10-01', '09:30', '18:00');
    await assert.rejects(save(client, '테스트직원', '2026-02-30', '09:30', '18:00'), /시작일/);
    await assert.rejects(save(client, '테스트직원', '2026-10-01', '18:00', '09:30'), /퇴근 시간/);
    await assert.rejects(save(client, '미등록사원', '2026-10-01', '09:30', '18:00'), /사원 명단/);
    client.failWrite = true;
    await assert.rejects(save(client, '테스트직원', '2026-10-01', '10:00', '18:00'), /저장 권한 없음/);
    assert.deepEqual((await load(client)).get('테스트직원'), [{date: '2026-10-01', shift: '0930-1800'}]);
});

test('보고서 지각 요약에도 근무조 변경일부터 새 출근 기준이 적용된다', () => {
    const data = fixture();
    const employee = data.employees[0];
    employee.shiftHistory = [{date: '2026-09-02', shift: '0830-1730'}];
    const html = render('simple', {data});
    assert.match(html, /지각 내역 및 시간 \(1건\)/);
});

test('근무조 모달은 저장 실패 시 입력을 유지하고 저장 성공 시 화면을 재계산한다', async () => {
    const elements = new Map();
    const document = {
        createElement: () => ({}),
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, {
                events: {},
                addEventListener(name, handler) { this.events[name] = handler; },
                querySelector: () => ({replaceChildren() {}}),
                showModal() { this.open = true; },
                close() { this.open = false; }
            });
            return elements.get(id);
        }
    };
    const client = cloud();
    const employee = {name: '테스트직원', shift: '0900-1800'};
    let recalculated = 0;
    const context = vm.createContext({
        ...shared, document, supabase: client, AttendanceShiftHistory: {save},
        employeeConfigList: [employee], renderEmployeeManager() {},
        updateAndProcessData() { recalculated++; }
    });
    const source = fs.readFileSync(require.resolve('../../admin.html'), 'utf8');
    const start = source.indexOf('let tempEmployeeConfigList = [];');
    const end = source.indexOf('updateAndProcessData();', source.indexOf("shiftForm.addEventListener('submit'", start));
    vm.runInContext(source.slice(start, end) + 'updateAndProcessData();\n});', context);
    vm.runInContext('openShiftChange(employeeConfigList[0])', context);
    const field = id => document.getElementById('shift-change-' + id);
    assert.equal(field('date').value, '');
    assert.equal(field('dialog').open, true);
    field('date').value = '2026-10-01';
    field('start').value = '09:30';
    const submit = () => field('form').events.submit({preventDefault() {}});
    client.failWrite = true;
    await submit();
    assert.equal(field('dialog').open, true);
    assert.equal(field('start').value, '09:30');
    assert.match(field('error').textContent, /저장 권한 없음/);
    assert.equal(recalculated, 0);
    client.failWrite = false;
    await submit();
    assert.equal(field('dialog').open, false);
    assert.equal(recalculated, 1);
    assert.equal(employee.shift, '0900-1800');
    assert.equal(shared.resolveAttendanceShift(employee, '2026-10-01', '0900-1800'), '0930-1800');
});
