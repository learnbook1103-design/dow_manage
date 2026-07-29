const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');

function readHtmlFiles() {
    return fs.readdirSync(projectRoot)
        .filter((fileName) => fileName.endsWith('.html'))
        .map((fileName) => ({
            fileName,
            source: fs.readFileSync(path.join(projectRoot, fileName), 'utf8')
        }));
}

test('사용 중인 HTML 진입점은 비활성 script.js를 로드하지 않는다', () => {
    const references = readHtmlFiles()
        .filter(({ source }) => /<script[^>]+src=["']script\.js["']/i.test(source))
        .map(({ fileName }) => fileName);

    assert.deepEqual(references, []);
});

test('admin은 공통 로직 다음에 근태 모듈을 로드하고 중복 구현을 두지 않는다', () => {
    const admin = fs.readFileSync(path.join(projectRoot, 'admin.html'), 'utf8');
    const sharedLogicIndex = admin.indexOf('src="shared_logic.js"');
    const importerIndex = admin.indexOf('src="lib/attendance/import-normalizer.js"');

    assert.notEqual(sharedLogicIndex, -1);
    assert.ok(importerIndex > sharedLogicIndex);
    assert.doesNotMatch(admin, /function\s+(?:normalizeRows|validateAttendanceUpload)\s*\(/);
    assert.match(admin, /attendanceImporter\.normalizeRows/);
});

test('로그인과 관리자 화면은 사용자 세션 키를 공통 모듈로 관리한다', () => {
    ['index.html', 'admin.html'].forEach((fileName) => {
        const source = fs.readFileSync(path.join(projectRoot, fileName), 'utf8');
        assert.match(source, /lib\/browser\/session-store\.js/);
        assert.doesNotMatch(
            source,
            /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\([^)]*attendance_user_/
        );
    });
});
