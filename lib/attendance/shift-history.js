(function (root) {
    const moduleName = 'attendance_shift_history';
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

    function makeChange(date, start, end) {
        const parsed = new Date(date + 'T00:00:00Z');
        if (!datePattern.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
            throw new Error('적용 시작일을 입력해 주세요.');
        }
        if (!timePattern.test(start) || !timePattern.test(end) || end <= start) {
            throw new Error('퇴근 시간은 출근 시간보다 늦어야 합니다.');
        }
        return {date, shift: start.replace(':', '') + '-' + end.replace(':', '')};
    }

    async function load(client) {
        const histories = new Map();
        const pageSize = 500;
        for (let from = 0; ; from += pageSize) {
            const {data, error} = await client.from('app_settings').select('value')
                .eq('module', moduleName).order('key').range(from, from + pageSize - 1);
            if (error) throw error;
            for (const {value} of data) {
                if (!value?.name || !datePattern.test(value.date) || !/^\d{4}-\d{4}$/.test(value.shift)) continue;
                if (!histories.has(value.name)) histories.set(value.name, []);
                histories.get(value.name).push({date: value.date, shift: value.shift});
            }
            if (data.length < pageSize) return histories;
        }
    }

    async function save(client, name, date, start, end) {
        const change = makeChange(date, start, end);
        const employee = await client.from('employees').select('name').eq('name', name).maybeSingle();
        if (employee.error) throw employee.error;
        if (!employee.data) throw new Error('사원 명단을 먼저 클라우드에 저장해 주세요.');
        const {error} = await client.from('app_settings').upsert({
            module: moduleName,
            key: JSON.stringify([name, date]),
            value: {name, ...change},
            updated_at: new Date().toISOString()
        }, {onConflict: 'module,key'});
        if (error) throw error;
        return change;
    }

    const api = {makeChange, load, save};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.AttendanceShiftHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
