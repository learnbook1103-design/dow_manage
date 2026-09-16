const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');

class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.styles = {}; this.style = { setProperty: (key, value) => this.styles[key] = value }; this.classList = { remove() {} }; }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return (this.html || '') + this.children.map(child => child.outerHTML).join(''); }
    appendChild(child) { this.children.push(child); }
    get outerHTML() { return `<${this.tag} class="${this.className}" style="${Object.entries(this.styles).map(([k, v]) => `${k}:${v}`).join(';')}">${this.innerHTML}${this.textContent || ''}</${this.tag}>`; }
}

function fixture() {
    const dates = Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    const employees = ['가나다', '나라마', '다마바', '라바사', '마사아', '바아자', '사자차', '아차카'].map((name, i) => ({ name, org: i < 6 ? '시험팀' : '밸브파크팀', shift: '0800-1700' }));
    const records = Object.fromEntries(employees.map((emp, i) => [emp.name, Object.fromEntries(dates.map(date => [date, { inTime: i === 0 ? '08:05' : `07:${30 + i}`, outTime: `17:${10 + i}`, reason: i === 0 ? '지각' : '', shiftStart: '0800' }]))]));
    records['나라마'][dates[0]] = { inTime: '연차', outTime: '연차', reason: '연차' };
    records['나라마'][dates[1]] = { inTime: '반차', outTime: '17:00', reason: '오전반차' };
    records['나라마'][dates[2]] = { inTime: '08:00', outTime: '13:00', reason: '오후반차' };
    records['다마바'][dates[0]].reason = '출장(시험 거래처 미팅)';
    records['다마바'][dates[1]].reason = '외근(시험 거래처)';
    employees[5].joinDate = dates[3];
    return { dates, employees, records };
}

function render(mode = 'simple', { source, data = fixture(), showLeave = true, corrections = {} } = {}) {
    const html = source || fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
    const start = html.indexOf('function renderMatrixReport(');
    const end = html.indexOf('function escapeTardyReportHtml(', start);
    if (start < 0 || end < 0) throw new Error('Report renderer boundary missing');
    const container = new Element('div');
    const context = {
        document: { createElement: tag => new Element(tag), querySelector: () => ({ value: mode }) },
        reportContainer: container, reportDateInput: { value: '2026-09-16' }, simpleLeaveColumnToggle: { checked: showLeave },
        employeeConfigList: data.employees, manualCorrections: corrections, manualReasons: {}, unconfirmedAnomaliesMap: {}, showAnomaliesHighlight: true,
        currentUniqueDates: new Set(data.dates), normalizeName: name => name, expandShift: value => value === '0800' ? '0800-1700' : value,
        stripAccessLogReasonText: value => value,
        escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
        AttendanceReportPresentation: require('../../lib/attendance/report-presentation'),
    };
    vm.createContext(context);
    vm.runInContext(html.slice(start, end), context);
    context.renderMatrixReport([data.dates], data.employees.map(emp => emp.name), data.records);
    return container.innerHTML;
}
module.exports = { render, fixture, root };
