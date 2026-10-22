(function(root) {
    function kind(reason) {
        const tokens = String(reason || '').split(/[,;·]/).map(v => v.replace(/\s/g, ''));
        return ['연차','오전반차','오후반차','반차'].find(v => tokens.includes(v)) || '';
    }
    function revise(record, previous, next) {
        const result = {...record, manager_reason:next};
        const before = kind(previous), after = kind(next);
        if (before === after) return result;
        if (before === '연차') {
            if (result.in_time === '연차') result.in_time = null;
            if (result.out_time === '연차') result.out_time = null;
        } else if (before) {
            if (before !== '오후반차' && result.in_time === '반차') result.in_time = null;
            if (before !== '오전반차' && result.out_time === '반차') result.out_time = null;
        }
        if (after === '연차' && !result.in_time && !result.out_time) result.in_time = '연차';
        else if (after === '오전반차' && !result.in_time) result.in_time = '반차';
        else if ((after === '오후반차' || after === '반차') && !result.out_time) result.out_time = '반차';
        // Confirmation for the previous derived leave does not confirm a new choice.
        if (before) result.status_leave = false;
        return result;
    }
    const api = {revise, kind};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.AttendanceManualReason = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
