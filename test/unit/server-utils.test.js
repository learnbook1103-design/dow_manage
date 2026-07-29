const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    safePath,
    getWeekRange,
    toGeminiContents
} = require('../../server');

test('허브 경로는 hub-data 내부만 허용한다', () => {
    const safe = safePath('sales/tasks/test.md');

    assert.equal(safe.endsWith(path.join('hub-data', 'sales', 'tasks', 'test.md')), true);
    assert.throws(() => safePath('../outside.txt'), /허브 외부 경로 접근 불가/);
    assert.throws(() => safePath('../hub-data-copy/file.txt'), /허브 외부 경로 접근 불가/);
});

test('주간 범위는 일요일에도 직전 월요일부터 금요일이다', () => {
    assert.deepEqual(
        getWeekRange(new Date('2026-07-26T12:00:00+09:00')),
        { start: '2026-07-20', end: '2026-07-24' }
    );
});

test('대화 메시지를 Gemini 역할과 문자열 파트로 변환한다', () => {
    assert.deepEqual(toGeminiContents([
        { role: 'user', content: '질문' },
        { role: 'assistant', content: { answer: 1 } }
    ]), [
        { role: 'user', parts: [{ text: '질문' }] },
        { role: 'model', parts: [{ text: '{"answer":1}' }] }
    ]);
});
