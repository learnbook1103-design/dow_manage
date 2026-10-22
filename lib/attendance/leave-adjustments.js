(function(root) {
    function prepare(baseline, name, date, text) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date+'T00:00:00Z').toISOString().slice(0,10) !== date)
            throw new Error('보정 기준일을 확인하세요.');
        const raw = String(text).trim();
        if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(Number(raw)))
            throw new Error('잔여일수는 숫자로 입력하세요. (예: 0, 1.5, -1)');
        if (baseline?.version !== 2 || !baseline.employees?.[name]) throw new Error('직원의 초기 잔여 설정을 먼저 불러오세요.');
        if (date < (baseline.historyAsOf || baseline.asOf)) throw new Error('초기 기준일 이전에는 보정할 수 없습니다.');
        const value = JSON.parse(JSON.stringify(baseline));
        const emp = value.employees[name];
        emp.adjustments = [...(emp.adjustments || []).filter(a => a.date !== date), {date, balance:Number(raw)}]
            .sort((a,b) => a.date.localeCompare(b.date));
        return value;
    }
    async function save(client, name, date, text) {
        const query = () => client.from('app_settings');
        const {data:row,error} = await query().select('value,updated_at').eq('module','attendance').eq('key','leave_opening_v2').single();
        if (error) throw error;
        const value = prepare(row.value, name, date, text);
        let update = query().update({value,updated_at:new Date().toISOString()}).eq('module','attendance').eq('key','leave_opening_v2');
        update = row.updated_at == null ? update.is('updated_at',null) : update.eq('updated_at',row.updated_at);
        const result = await update.select('value');
        if (result.error) throw result.error;
        if (result.data?.length !== 1) throw new Error('다른 담당자가 설정을 변경했습니다. 다시 불러온 뒤 입력해 주세요.');
        return result.data[0].value;
    }
    const api = {prepare,save};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.AttendanceLeaveAdjustments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
