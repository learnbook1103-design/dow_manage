const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const normalizer = require('../../lib/attendance/import-normalizer');
const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../fixtures/attendance-import.json'), 'utf8')
);

test('한 열에 뭉친 CSV 형태를 업로드 전에 감지한다', () => {
    assert.equal(normalizer.isPackedSingleColumnSheet(fixture.packedRows), true);
    assert.equal(normalizer.isPackedSingleColumnSheet([
        ['날짜', '이름', '출근', '퇴근'],
        ['2026-07-20', '테스트직원', '08:15', '17:40']
    ]), false);
});

test('제목 행 뒤에 있는 실제 근태 헤더를 찾는다', () => {
    const rows = [
        ['2026년 7월 근태 내역'],
        [],
        ['일자', '성명', '출근시간', '퇴근시간']
    ];

    assert.equal(normalizer.findHeaderRowIndex(rows), 2);
});

test('문자열과 엑셀 일련번호 날짜/시간을 파싱한다', () => {
    const parseDateCode = () => ({
        y: 2026,
        m: 7,
        d: 20,
        H: 8,
        M: 5,
        S: 9
    });

    assert.equal(normalizer.parseAttendanceDate('2026/7/20'), '2026-07-20');
    assert.equal(
        normalizer.parseAttendanceDate(46200, { parseDateCode }),
        '2026-07-20'
    );
    assert.deepEqual(
        normalizer.parseAttendanceDateTime(46200.3, { parseDateCode }),
        { date: '2026-07-20', time: '08:05:09' }
    );
});

test('다양한 행 헤더를 표준 근태 컬럼으로 정규화한다', () => {
    const [row] = normalizer.normalizeRows(fixture.matrixRows);

    assert.equal(row['날짜'], '2026-07-20');
    assert.equal(row['이름'], '테스트직원');
    assert.equal(row['출근'], '08:15');
    assert.equal(row['퇴근'], '17:40');
    assert.equal(row['근무조'], '0830-1730');
    assert.equal(row['비고'], '외근, 생일');
});

test('컬럼 별칭 규칙은 정규 컬럼을 우선하고 한 곳에서 매핑한다', () => {
    const headers = ['날짜', '근태일자', '사원명', '출근시각', '퇴근시간', '근무조명'];

    assert.equal(normalizer.findSourceHeader(headers, '날짜'), '날짜');
    assert.deepEqual(normalizer.createCanonicalHeaderMap(headers), {
        사원명: '이름',
        출근시각: '출근',
        퇴근시간: '퇴근',
        근무조명: '근무조'
    });
    assert.equal(Object.isFrozen(normalizer.ATTENDANCE_COLUMN_RULES), true);
});

test('출입 로그 시간 구간의 경계값을 고정한다', () => {
    assert.equal(normalizer.getAttendanceLogBucket('04:59'), 'prevOut');
    assert.equal(normalizer.getAttendanceLogBucket('05:00'), 'in');
    assert.equal(normalizer.getAttendanceLogBucket('11:59'), 'in');
    assert.equal(normalizer.getAttendanceLogBucket('12:00'), 'lunch');
    assert.equal(normalizer.getAttendanceLogBucket('12:59'), 'lunch');
    assert.equal(normalizer.getAttendanceLogBucket('13:00'), 'out');
});

test('출입 이벤트를 날짜별 최초 출근과 최종 퇴근으로 집계한다', () => {
    const rows = normalizer.normalizeRows(fixture.eventRows);
    const day = rows.find((row) => row['이름'] === '테스트직원');
    const overnight = rows.find((row) => row['이름'] === '야간직원');

    assert.deepEqual(day, {
        날짜: '2026-07-20',
        이름: '테스트직원',
        출근: '08:12:00',
        퇴근: '17:44:00',
        근무조: '0830-1730'
    });
    assert.equal(overnight['날짜'], '2026-07-20');
    assert.equal(overnight['퇴근'], '26:15');
});

test('빈 파일과 한 열 파일은 거부하고 정상 행은 허용한다', () => {
    assert.equal(
        normalizer.validateAttendanceUpload('empty.xlsx', [], []).ok,
        false
    );
    assert.equal(
        normalizer.validateAttendanceUpload('packed.csv', fixture.packedRows, []).ok,
        false
    );
    assert.equal(
        normalizer.validateAttendanceUpload(
            'normal.xlsx',
            [
                ['날짜', '이름', '출근', '퇴근'],
                ['2026-07-20', '테스트직원', '08:15', '17:40']
            ],
            [{
                날짜: '2026-07-20',
                이름: '테스트직원',
                출근: '08:15',
                퇴근: '17:40'
            }]
        ).ok,
        true
    );
});
