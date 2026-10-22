const test = require('node:test');
const assert = require('node:assert/strict');
const {parse, calculate} = require('../../lib/attendance/leave-balance');
const header = ['이름', '잔여 연차', ...Array.from({length: 12}, (_, i) => `${i + 1}월`), '입사일'];
function baseline(balance = 3, september = 1.5) {
    return parse([['이름', '연차'], ['시험사원', balance]],
        [header, ['시험사원', 99, 0, 0, 0, 0, 0, 0, 0, 0, september, 2, 0, 0, '2025-02-09']], '2026-09-18');
}
const detail = [
    {name: '시험사원', start: '2026-09-10', type: '연차', days: 1, status: '승인'},
    {name: '시험사원', start: '2026-09-21', type: '오후반차', days: 0.5, status: '완료'}
];
test('explicit monthly start grants on the 15th from October without changing hire date or regranting September', () => {
    const {calculateOpening:calc}=require('../../lib/attendance/leave-balance');
    const employee={balance:0,historyBalance:0,joinDate:'2022-07-12',accrualType:'monthly',monthlyStart:'2026-10-15',policyThrough:null,annualGrants:[]};
    const b={version:2,asOf:'2026-09-30',historyAsOf:'2026-08-31',employees:{시험:employee}};
    for(const [date,value] of [['2026-09-15',0],['2026-09-30',0],['2026-10-14',0],['2026-10-15',1],['2026-11-14',1],['2026-11-15',2],['2027-01-01',3],['2027-01-15',4]]) {
        assert.equal(calc(b,'시험',date,[]).value,value,date);
    }
    const records=[{name:'시험',date:'2026-10-16',out_time:'반차'}];
    assert.equal(calc(b,'시험','2026-10-31',records).value,0.5);
    assert.equal(employee.joinDate,'2022-07-12');
});
test('confirmed September supplement fills missing Hong data without pre-deducting October use', () => {
    const holding = [['이름', '연차'], ['홍선기', '']];
    const b = parse(holding, [header], '2026-09-18');
    const october = [{name:'홍선기',start:'2026-10-07',type:'반차',days:0.5,status:'승인'}];
    assert.equal(calculate(b, '홍선기', '2026-09-15', []).value, 1);
    assert.equal(calculate(b, '홍선기', '2026-09-30', october).value, 1);
    assert.equal(calculate(b, '홍선기', '2026-10-15', october).value, null);
    assert.equal(parse(holding, [header], '2026-10-14').employees['홍선기'], undefined);
    const monthly = [header, ['홍선기', 0, ...Array(12).fill(0), '2026-08-03']];
    const updated = parse([holding[0], ['홍선기', 2]], monthly, '2026-09-18');
    assert.equal(updated.employees['홍선기'].balance, 2);
});
test('restores future requests and subtracts only use through the report cutoff', () => {
    assert.equal(calculate(baseline(), '시험사원', '2026-09-15', detail).value, 5.5);
    assert.equal(calculate(baseline(), '시험사원', '2026-09-30', detail).value, 5);
    assert.equal(calculate(baseline(0), '시험사원', '2026-09-30', detail).value, 2);
    assert.equal(calculate(baseline(-4), '시험사원', '2026-09-30', detail).value, -2);
});
test('missing baseline, people, month, detail and reconciliation mismatch do not become zero', () => {
    for (const [b,n,d,l] of [[null,'시험사원','2026-09-15',detail], [baseline(),'없음','2026-09-15',detail],
        [baseline(),'시험사원','2026-10-15',detail], [baseline(),'시험사원','2026-09-15',null],
        [baseline(),'시험사원','2026-09-15',detail.slice(0,1)], [baseline(null),'시험사원','2026-09-15',detail]]) {
        assert.equal(calculate(b,n,d,l).value, null);
    }
});
test('duplicates and rejected requests do not double deduct; pending is not used', () => {
    const duplicate = [...detail, ...detail, {...detail[0], start:'2026-09-11', status:'취소'}];
    assert.equal(calculate(baseline(), '시험사원', '2026-09-30', duplicate).value, 5);
    const pending = detail.map(l => ({...l, status:'대기'}));
    assert.equal(calculate(baseline(), '시험사원', '2026-09-30', pending).value, 6.5);
});
test('multi-day leave splits by workdays and respects holidays and cutoff', () => {
    const rows = [{name:'시험사원', start:'2026-09-14', end:'2026-09-16', type:'연차', days:2}];
    assert.equal(calculate(baseline(3,2), '시험사원','2026-09-15',rows,['2026-09-15']).value,6);
    assert.equal(calculate(baseline(3,2), '시험사원','2026-09-15',rows).value,null);
    assert.equal(calculate(baseline(3,2), '시험사원','2026-09-15', [{...rows[0],start:'2026-08-31'}]).value,null);
});
test('invalid formats and duplicate names reject new baseline', () => {
    assert.throws(() => parse([], [], '2026-09-18'));
    assert.throws(() => parse([['이름','연차'], ['시험사원',3], ['시험사원',4]], [header], '2026-09-18'));
    assert.equal(calculate(baseline(3,0),'시험사원','2026-09-15',[]).value,5);
});

test('real report renderer writes calculated values and explains missing employee data', () => {
    const {render} = require('../fixtures/report-renderer');
    const b = {version:2,asOf:'2026-09-30',historyAsOf:'2026-08-31',employees:{'가나다':{balance:5.5,historyBalance:5.5,accrualType:'annual',policyThrough:'2026-12-31'}}};
    const html = render('simple', {baseline:b, leaves:[]});
    assert.match(html, /data-auto-balance="5.5"[^>]*>5.5<\/span>/);
    assert.match(html, /초기 잔여일수 미입력/);
    assert.doesNotMatch(render('standard', {baseline:b, leaves:detail}), /data-auto-balance/);
});

test('fixed opening balance rolls forward across months, only on hire-day, with no double subtraction', () => {
    const {calculateOpening:calc} = require('../../lib/attendance/leave-balance');
    const b={version:2,asOf:'2026-09-30',historyAsOf:'2026-08-31',employees:{'시험':{balance:0.5,historyBalance:0,joinDate:'2026-08-03',accrualType:'monthly',policyThrough:'2026-12-31'}}};
    const records=[{name:'시험',date:'2026-09-22',out_time:'반차'}, {name:'시험',date:'2026-10-07',out_time:'반차'}];
    assert.equal(calc(b,'시험','2026-09-15',records).value,1);
    assert.equal(calc(b,'시험','2026-09-30',records).value,0.5);
    assert.equal(calc(b,'시험','2026-10-02',records).value,0.5);
    assert.equal(calc(b,'시험','2026-10-03',records).value,1.5);
    assert.equal(calc(b,'시험','2026-10-15',records).value,1);
    assert.equal(calc(b,'시험','2026-10-15',[...records,...records]).value,1);
    assert.equal(calc(b,'시험','2026-11-15',records).value,2);
    assert.equal(calc(b,'시험','2027-01-01',records).value,null);
    assert.equal(calc(b,'시험','2026-10-15',null).value,null);
});

test('both half-day slots count once each; annual grants are explicit and date-bound', () => {
    const {calculateOpening:calc}=require('../../lib/attendance/leave-balance');
    const b={version:2,asOf:'2026-09-30',employees:{'시험':{balance:2,accrualType:'annual',policyThrough:'2027-12-31',annualGrants:[{date:'2027-01-01',days:15}]}}};
    const r=[{name:'시험',date:'2026-10-07',in_time:'반차',out_time:'반차'}];
    assert.equal(calc(b,'시험','2026-10-07',r).value,1);
    assert.equal(calc(b,'시험','2026-12-31',r).value,1);
    assert.equal(calc(b,'시험','2027-01-01',r).value,16);
    assert.equal(calc(b,'시험','2027-01-02',r).value,16);
    assert.equal(calc(b,'시험','2026-10-07',[{...r[0],in_time:'',out_time:''}]).value,2);
});

test('monthly leave accrues on the hire-day, not the first day, without counting snapshot accrual twice', () => {
    const b = baseline(6, 0);
    const emp = b.employees['시험사원'];
    emp.months.fill(0);
    emp.joinDate = '2026-02-09';
    assert.equal(calculate(b, '시험사원', '2026-09-08', []).value, 5);
    assert.equal(calculate(b, '시험사원', '2026-09-09', []).value, 6);
    assert.equal(calculate(b, '시험사원', '2026-09-18', []).value, 6);
    assert.equal(calculate(b, '시험사원', '2026-09-30', []).value, 6);
    emp.joinDate = '2026-03-03';
    assert.equal(calculate(b, '시험사원', '2026-09-02', []).value, 5);
    assert.equal(calculate(b, '시험사원', '2026-09-03', []).value, 6);
    emp.joinDate = '2026-02-19';
    assert.equal(calculate(b, '시험사원', '2026-09-18', []).value, 6);
    assert.equal(calculate(b, '시험사원', '2026-09-19', []).value, 7);
    emp.joinDate = '2026-09-03';
    assert.equal(calculate(b, '시험사원', '2026-09-30', []).value, 6);
    emp.joinDate = '';
    assert.equal(calculate(b, '시험사원', '2026-09-30', []).value, null);
});
