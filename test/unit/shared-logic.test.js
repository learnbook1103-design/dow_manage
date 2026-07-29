const test = require('node:test');
const assert = require('node:assert/strict');

const {
    cleanTime,
    expandShift,
    isWeekendDateString,
    normalizeAttendanceDateValue,
    detectHalfDayIsAM,
    calculateAnomalies
} = require('../../shared_logic');

test('시간과 근무조 입력을 정규화한다', () => {
    assert.equal(cleanTime(0.5), '12:00');
    assert.equal(cleanTime('2026-07-24 8:05:30'), '08:05');
    assert.equal(cleanTime('-'), '');
    assert.equal(expandShift('830'), '0830-1730');
    assert.equal(expandShift('08:00-17:00'), '08:00-17:00');
});

test('날짜 입력과 주말 여부를 안정적으로 판정한다', () => {
    assert.equal(normalizeAttendanceDateValue('2026/7/24'), '2026-07-24');
    assert.equal(normalizeAttendanceDateValue('7/24/26'), '2026-07-24');
    assert.equal(normalizeAttendanceDateValue('not-a-date'), '');
    assert.equal(isWeekendDateString('2026-07-25'), true);
    assert.equal(isWeekendDateString('2026-07-24'), false);
});

test('실제 출퇴근 시간이 반차 라벨보다 우선한다', () => {
    assert.equal(detectHalfDayIsAM('', '11:30', ''), true);
    assert.equal(detectHalfDayIsAM('', '', '13:30'), false);
});

test('근무조보다 늦은 출근을 지각으로 계산한다', () => {
    const anomalies = calculateAnomalies([
        {
            이름: '테스트직원',
            날짜: '2026-07-20',
            출근: '09:05',
            퇴근: '17:35',
            근무조: '0830-1730'
        }
    ], {
        employeeConfigList: [
            { name: '테스트직원', shift: '0830-1730' }
        ],
        currentUniqueDates: new Set(['2026-07-20'])
    });

    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0].reason, '지각');
    assert.equal(anomalies[0].inAnom, true);
    assert.equal(anomalies[0].outAnom, false);
});

test('주말과 지정 휴일은 이상근태 계산에서 제외한다', () => {
    const records = [
        { 이름: '테스트직원', 날짜: '2026-07-25', 출근: '', 퇴근: '', 근무조: '0830-1730' },
        { 이름: '테스트직원', 날짜: '2026-07-27', 출근: '', 퇴근: '', 근무조: '0830-1730' }
    ];
    const anomalies = calculateAnomalies(records, {
        employeeConfigList: [{ name: '테스트직원', shift: '0830-1730' }],
        currentUniqueDates: new Set(['2026-07-25', '2026-07-27']),
        holidayDates: ['2026-07-27']
    });

    assert.deepEqual(anomalies, []);
});
