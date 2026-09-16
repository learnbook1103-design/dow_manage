// Offline, synthetic preview only: no application bootstrap, DB, cloud or authentication.
const fs = require('node:fs');
const path = require('node:path');
const { render, root, fixture } = require('../test/fixtures/report-renderer');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const inlineStyle = admin.match(/<style>([\s\S]*?)<\/style>/)[1];
const presentationScript = fs.readFileSync(path.join(root, 'lib/attendance/report-presentation.js'), 'utf8');
const outDir = path.join(root, 'outputs', 'report-v2-preview');
fs.mkdirSync(outDir, { recursive: true });
const data = fixture();
// Use short sample reasons for the layout preview; long-text coverage stays in the unit fixture.
data.records['다마바'][data.dates[0]].reason = '출장';
data.records['다마바'][data.dates[1]].reason = '외근';
// Expand only the synthetic preview; keep production employees and unit fixtures intact.
for (let i = 9; i <= 22; i++) {
    const name = '시험' + String(i).padStart(2, '0');
    data.employees.splice(data.employees.length - 2, 0, { name, org: '시험팀', shift: '0800-1700' });
    data.records[name] = Object.fromEntries(data.dates.map(date => [date, {
        inTime: '07:' + String(30 + i), outTime: '17:' + String(10 + i), reason: '', shiftStart: '0800'
    }]));
}
for (const mode of ['simple', 'standard']) {
    const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8') + inlineStyle + fs.readFileSync(path.join(root, 'report-v2.css'), 'utf8');
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>익명 근태 양식 ${mode}</title><style>${css}</style></head><body><p class="no-print">익명 시험자료 · 실제 직원/저장 보고서 아님 · ${mode}</p><div id="report-container">${render(mode, { data })}</div></body></html>`;
    fs.writeFileSync(path.join(outDir, `${mode}.html`), html.replace('</body>', `<script>${presentationScript}</script></body>`));
}
console.log(outDir);
