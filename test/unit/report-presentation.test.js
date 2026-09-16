const test = require('node:test');
const assert = require('node:assert/strict');
const { timeText, reasonText } = require('../../lib/attendance/report-presentation');
const { render, fixture } = require('../fixtures/report-renderer');

test('format 2 leave display preserves attendance values', () => {
    const half = { inTime: '08:00', outTime: '13:00', reason: '오후반차' };
    assert.equal(timeText(half, 'out', '13:00'), '반차');
    assert.equal(timeText(half, 'in', '08:00'), '08:00');
    assert.deepEqual(half, { inTime: '08:00', outTime: '13:00', reason: '오후반차' });
    assert.equal(timeText({ reason: '연차' }, 'in', ''), '연차');
    assert.equal(timeText({ reason: '연차', inTime: '08:00' }, 'out', ''), '');
    assert.equal(timeText(undefined, 'in', ''), '');
});

test('format 2 uses three rows, group divider, editable balance and detailed tardiness without mutating input', () => {
    const data = fixture();
    const before = JSON.stringify(data);
    const html = render('simple', { data });
    assert.equal(JSON.stringify(data), before);
    assert.equal((html.match(/rowspan="3" class="sticky-col td-name"/g) || []).length, 8);
    assert.equal((html.match(/class="internal-row group-start"/g) || []).length, 1);
    assert.match(html, /<h2>근태 보고서<\/h2>/);
    assert.doesNotMatch(html, /사원 \d+명/);
    assert.match(html, /approval-table/);
    assert.match(html, /<th>담당<\/th><th>부장<\/th><th>전무<\/th><th>대표이사<\/th><th>회장<\/th>/);
    assert.equal((html.match(/contenteditable="plaintext-only"/g) || []).length, 8);
    assert.match(html, /가나다 잔여 연차 직접 입력/);
    assert.doesNotMatch(html, />13:00</);
    assert.doesNotMatch(html, /13:00\/반/);
    assert.doesNotMatch(html, />오전반차<|>오후반차</);
    assert.equal((html.match(/>반차</g) || []).length, 2);
    assert.equal((html.match(/>연차<\/td>/g) || []).length, 1);
    assert.match(html, /출장\(시험 거래처 미팅\)/);
    assert.match(html, /지각 내역 및 시간 \(12건\)/);
    assert.match(html, /\[09\/01\].*?<strong>가나다<\/strong>/);
    assert.match(html, /earliest-in-cell-park/);
    assert.match(html, /latest-out-cell-park/);
});

test('format 2 retains existing reason labels, business text and consecutive-cell merging', () => {
    const data = fixture();
    data.records['다마바'][data.dates[2]].reason = '출장(시험 거래처 미팅)';
    data.records['다마바'][data.dates[3]].reason = '출장(시험 거래처 미팅)';
    const html = render('simple', { data });
    const reasonRows = value => value.match(/<tr class="employee-border-bottom">[\s\S]*?<\/tr>/g);
    assert.deepEqual(reasonRows(html), reasonRows(render('standard', { data }).replace(/>연차<|>오전반차<|>오후반차</g, '><')));
    assert.match(html, /colspan="2">출장\(시험 거래처 미팅\)/);
    assert.doesNotMatch(html, /reason-cell">연차<|reason-cell">반차</);
    assert.match(html, /reason-cell">시험 거래처</);
});

test('format 1 unchanged leave/reason display and same tardy details, optional balance and empty summary', () => {
    const standard = render('standard');
    assert.doesNotMatch(standard, /report-page-simple|group-start|잔여 연차 데이터 미연동/);
    assert.match(standard, /approval-table/);
    assert.match(standard, />오후반차</);
    const details = html => html.slice(html.indexOf('<div class="tardy-summary-section"'));
    assert.equal(details(standard), details(render('simple')));
    assert.doesNotMatch(render('simple', { showLeave: false }), /contenteditable/);
    const data = fixture();
    data.dates.forEach(date => { data.records['가나다'][date].inTime = '07:55'; });
    assert.match(render('simple', { data }), /없음 \(0건\)/);
});

test('manual leave balances stay separate by employee and period for the open session', () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const handlers = {};
    const context = { document: { addEventListener: (type, fn) => { handlers[type] = fn; } } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../../lib/attendance/report-presentation'), 'utf8'), context);
    const api = context.AttendanceReportPresentation;
    const firstKey = JSON.stringify([2026, '09', true, '가나다']);
    const nextKey = JSON.stringify([2026, '09', false, '가나다']);
    const field = { dataset: { leaveBalanceKey: firstKey }, textContent: '7.5' };
    handlers.input({target: { closest: () => field }});
    assert.equal(api.leaveBalance(firstKey), '7.5');
    assert.equal(api.leaveBalance(nextKey), '');
    assert.equal(api.leaveBalance(JSON.stringify([2026, '09', true, '나라마'])), '');
    field.textContent = '0';
    handlers.input({target: { closest: () => field }});
    assert.equal(api.leaveBalance(firstKey), '0');
    field.textContent = '';
    handlers.input({target: { closest: () => field }});
    assert.equal(api.leaveBalance(firstKey), '');
});

test('leave labels occupy the requested time slot without changing source records', () => {
    const annual = {inTime:'연차', outTime:'연차', reason:'연차'};
    assert.equal(timeText(annual, 'in', '연차'), '연차');
    assert.equal(timeText(annual, 'out', '연차'), '');
    assert.equal(reasonText(annual, '연차'), '');
    const morning = {inTime:'09:00', outTime:'17:00', reason:'오전반차'};
    assert.equal(timeText(morning, 'in', '09:00'), '반차');
    assert.equal(timeText(morning, 'out', '17:00'), '17:00');
    assert.equal(reasonText(morning, '오전반차'), '');
    const afternoon = {inTime:'08:00', outTime:'13:00', reason:'오후 반차'};
    assert.equal(timeText(afternoon, 'out', '13:00'), '반차');
    assert.equal(timeText(afternoon, 'in', '08:00'), '08:00');
    assert.equal(reasonText(afternoon, '오후 반차, 개인 사정'), '개인 사정');
    assert.equal(afternoon.outTime, '13:00');
    assert.equal(reasonText({}, '연차 취소 확인'), '연차 취소 확인');
    assert.equal(reasonText({}, '출장(거래처)'), '출장(거래처)');
});
