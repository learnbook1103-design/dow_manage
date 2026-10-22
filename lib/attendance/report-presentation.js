// Report format 2 display and balance editor. Attendance/leave records stay unchanged.
(function (root) {
    // Drafts are temporary; dated balance corrections are saved by the admin callback.
    const leaveDrafts = new Map();
    function leaveBalance(key, automatic = '') { return leaveDrafts.get(key) || automatic; }
    if (root.document) {
        root.document.addEventListener('focusout', async event => {
            const field = event.target.closest?.('[data-leave-balance-key]');
            if (field && !field.textContent.trim()) {
                leaveDrafts.delete(field.dataset.leaveBalanceKey);
                field.textContent = field.dataset.autoBalance || '';
                return;
            }
            if (field && field.dataset.leaveBalanceDate && leaveDrafts.has(field.dataset.leaveBalanceKey)) {
                const key = field.dataset.leaveBalanceKey;
                if (typeof root.saveLeaveBalanceAdjustment !== 'function') return;
                field.contentEditable = 'false';
                field.setAttribute('aria-busy','true');
                try {
                    await root.saveLeaveBalanceAdjustment(field.dataset.leaveBalanceName, field.dataset.leaveBalanceDate, field.textContent);
                    leaveDrafts.delete(key);
                    field.dataset.autoBalance = String(Number(field.textContent));
                    field.textContent = field.dataset.autoBalance;
                    field.title = `${field.dataset.leaveBalanceDate} 기준 잔여 ${field.textContent}일 저장됨`;
                } catch(error) {
                    leaveDrafts.delete(key);
                    field.textContent = field.dataset.autoBalance || '';
                    root.alert('잔여연차 저장 실패: '+error.message+'\n수정값은 저장되지 않았습니다. 다시 입력해 주세요.');
                } finally {
                    field.contentEditable = 'plaintext-only';
                    field.removeAttribute('aria-busy');
                }
            }
        });
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
