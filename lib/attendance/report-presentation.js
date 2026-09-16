// Display-only adapter for report format 2. Never changes attendance/leave records.
(function (root) {
    // Draft values belong to this open report session, not attendance records.
    const leaveDrafts = new Map();
    function leaveBalance(key) { return leaveDrafts.get(key) || ''; }
    if (root.document) {
        root.document.addEventListener('input', event => {
            const field = event.target.closest?.('[data-leave-balance-key]');
            if (field) leaveDrafts.set(field.dataset.leaveBalanceKey, field.textContent);
        });
        root.document.addEventListener('keydown', event => {
            if (event.key === 'Enter' && event.target.closest?.('[data-leave-balance-key]')) {
                event.preventDefault();
                event.target.blur();
            }
        });
    }
    function leaveLabel(record, direction) {
        const reasons = String(record?.reason || '').split(/[,;·]/).map(text => text.trim());
        const labels = [record?.inTime, record?.outTime];
        if (reasons.includes('연차') || labels.includes('연차')) return direction === 'in' ? '연차' : '';
        const half = direction === 'in' ? /^오전\s*반차$/ : /^오후\s*반차$/;
        const value = direction === 'in' ? record?.inTime : record?.outTime;
        if (reasons.some(text => half.test(text)) || /^(?:오전\s*|오후\s*)?반차$/.test(String(value || ''))) return '반차';
        return '';
    }

    function timeText(record, direction, fallback) {
        const label = leaveLabel(record, direction);
        if (label) return label;
        const value = direction === 'in' ? record?.inTime : record?.outTime;
        if (value === '연차') return '';
        return fallback || '';
    }

    function reasonText(record, reason) {
        const text = String(reason || '');
        if (!leaveLabel(record, 'in') && !leaveLabel(record, 'out')) return text;
        // Remove only duplicate leave labels; keep notes and business reasons.
        return text.split(/[,;·]/).map(part => part.trim())
            .filter(part => !/^(?:연차|(?:오전\s*|오후\s*)?반차)$/.test(part)).join(', ');
    }

    const api = { timeText, reasonText, leaveBalance };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.AttendanceReportPresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
