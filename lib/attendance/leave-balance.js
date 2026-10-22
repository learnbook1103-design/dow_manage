// Monthly reconciliation of an application-deducted balance.
(function (root) {
    const nameKey = value => String(value || '').replace(/\s/g, '');
    const number = value => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
    function parse(holdingRows, monthlyRows, asOf) {
        if (!validDate(asOf)) throw new Error('기준일을 입력해 주세요.');
        const hi = holdingRows.findIndex(r => r.includes('이름') && r.includes('연차'));
        const mi = monthlyRows.findIndex(r => r.includes('이름') && r.includes('1월') && r.includes('12월'));
        if (hi < 0 || mi < 0) throw new Error('휴가 보유현황과 월별 연차 사용내역 파일을 각각 선택해 주세요.');
        const h = holdingRows[hi], m = monthlyRows[mi];
        const employees = Object.create(null);
        for (const r of monthlyRows.slice(mi + 1)) {
            const name = nameKey(r[m.indexOf('이름')]);
            if (!name) continue;
            if (employees[name]) throw new Error('월별 내역에 중복 이름이 있습니다: ' + name);
            const months = Array.from({length: 12}, (_, i) => {
                const v = r[m.indexOf(`${i + 1}월`)];
                return v === '' || v == null ? 0 : number(v);
            });
            if (months.some(v => v == null || v < 0)) throw new Error('월별 사용일수를 확인해 주세요: ' + name);
            const joinDate = String(r[m.indexOf('입사일')] || '').trim();
            employees[name] = {months, balance: null, joinDate};
        }
        const seen = new Set();
        for (const r of holdingRows.slice(hi + 1)) {
            const name = nameKey(r[h.indexOf('이름')]);
            if (!name) continue;
            if (seen.has(name)) throw new Error('보유현황에 중복 이름이 있습니다: ' + name);
            seen.add(name);
            if (employees[name]) employees[name].balance = number(r[h.indexOf('연차')]);
        }
        // User-confirmed supplement for the supplied September snapshot only:
        // hired Aug 3, one day earned Sep 3, no September use. October use must
        // come from the October upload, not a pre-entered attendance record.
        if (asOf === '2026-09-18' && seen.has('홍선기') && !employees['홍선기']) {
            const row = holdingRows.slice(hi + 1).find(r => nameKey(r[h.indexOf('이름')]) === '홍선기');
            if (number(row[h.indexOf('연차')]) == null) {
                employees['홍선기'] = {months: Array(12).fill(0), balance: 1, joinDate: '2026-08-03',
                    source: '사용자 확인: 9월 발생 1일, 사용 0일'};
            }
        }
        return {asOf, employees};
    }
    function calculate(baseline, name, cutoff, leaves, holidays = []) {
        const unavailable = reason => ({value: null, reason});
        if (!baseline) return unavailable('연차 기준 파일을 불러오세요');
        if (!validDate(cutoff)) return unavailable('보고서 기준일 확인 필요');
        const month = baseline.asOf.slice(0, 7);
        if (cutoff.slice(0, 7) !== month) return unavailable('보고서와 같은 월의 기준 자료가 필요합니다');
        const emp = baseline.employees[nameKey(name)];
        if (!emp || emp.balance == null) return unavailable('기준 보유일수 없음 · 직접 입력 가능');
        if (!validDate(emp.joinDate)) return unavailable('월차 대상 판정을 위한 입사일 확인 필요');
        // User policy: employees hired in the reporting year accrue on their hire-day,
        // starting the following month. Adjust only the gap from the snapshot date.
        let monthlyAdjustment = 0;
        if (emp.joinDate.slice(0, 4) === cutoff.slice(0, 4) && emp.joinDate.slice(0, 7) < month) {
            const anniversary = `${month}-${emp.joinDate.slice(8, 10)}`;
            if (!validDate(anniversary)) return unavailable('입사일과 같은 날짜가 없는 달의 월차 발생일 확인 필요');
            monthlyAdjustment = Number(cutoff >= anniversary) - Number(baseline.asOf >= anniversary);
        }
        if (!Array.isArray(leaves)) return unavailable('해당 월 전체 휴가 상세 내역을 업로드하세요');
        const monthIndex = Number(month.slice(5)) - 1;
        const seen = new Set(), byDate = new Map();
        let total = 0, used = 0;
        for (const lv of leaves) {
            if (nameKey(lv.name) !== nameKey(name) || !/연차|반차/.test(lv.type || '')) continue;
            const status = String(lv.status || '');
            if (/취소|반려|삭제/.test(status)) continue;
            const start = String(lv.start || ''), end = String(lv.end || lv.start || '');
            if (!validDate(start) || !validDate(end) || end < start) return unavailable('휴가 날짜 확인 필요');
            if (end < month + '-01' || start.slice(0, 7) > month) continue;
            if (start.slice(0, 7) !== month || end.slice(0, 7) !== month) return unavailable('월을 걸친 휴가의 월별 일수 확인 필요');
            if (status && !/승인|완료|대기/.test(status)) return unavailable('휴가 승인 상태 확인 필요');
            const amount = number(lv.days);
            const key = JSON.stringify([start, end, lv.type, amount, status]);
            if (seen.has(key)) continue;
            seen.add(key);
            const dates = [];
            for (let d = new Date(start + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
                const day = d.toISOString().slice(0, 10);
                if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays.includes(day)) dates.push(day);
            }
            const daily = /반차/.test(lv.type) || amount === 0.5 ? 0.5 : 1;
            if (!dates.length || amount !== dates.length * daily) return unavailable('휴가 사용일수와 날짜 확인 필요');
            total += amount;
            for (const date of dates) {
                byDate.set(date, (byDate.get(date) || 0) + daily);
                if (byDate.get(date) > 1) return unavailable('같은 날짜의 중복 휴가 확인 필요');
                if (date <= cutoff && !/대기/.test(status)) used += daily;
            }
        }
        if (Math.abs(total - emp.months[monthIndex]) > 0.00001) return unavailable('월별 합계와 상세 내역 불일치 · 기준 파일을 함께 갱신하세요');
        const restored = emp.months.slice(monthIndex).reduce((sum, n) => sum + n, 0);
        return {value: Math.round((emp.balance + restored - used + monthlyAdjustment) * 100) / 100,
            reason: `${cutoff} 기준 · 보유 ${emp.balance} + 신청분 복원 ${restored} − 사용 ${used} + 월차 기준일 보정 ${monthlyAdjustment}일`};
    }
    // Recompute from a fixed opening balance; never subtract from a previous result.
    function calculateOpening(baseline, name, cutoff, records) {
        const unavailable = reason => ({value:null, reason});
        if (!baseline || baseline.version !== 2 || !validDate(cutoff)) return unavailable('초기 잔여 자료 확인 필요');
        const emp = baseline.employees[nameKey(name)];
        if (!emp || number(emp.balance) == null) return unavailable('초기 잔여일수 미입력');
        // Reconcile from the pre-September opening when it is available, including
        // for October onward. Otherwise edits to September leave would never
        // update balances that had already incorporated that leave on September 30.
        const historical = validDate(baseline.historyAsOf) && number(emp.historyBalance) != null;
        const start = historical ? baseline.historyAsOf : baseline.asOf;
        const opening = historical ? emp.historyBalance : emp.balance;
        if (!validDate(start) || cutoff < start || number(opening) == null) return unavailable('초기 기준일 이전 보고서입니다');
        if (!Array.isArray(records)) return unavailable('사용 내역을 불러오지 못했습니다');
        let grants = 0;
        // Explicit end prevents silently extending an unconfirmed monthly-to-annual policy.
        if (cutoff > emp.policyThrough) return unavailable('다음 연도 부여일수·전환 기준 설정 필요');
        if (emp.accrualType === 'monthly') {
            if (!validDate(emp.joinDate)) return unavailable('입사일 확인 필요');
            for (let d = new Date(start.slice(0,7) + '-01T00:00:00Z'); d.toISOString().slice(0,7) <= cutoff.slice(0,7); d.setUTCMonth(d.getUTCMonth()+1)) {
                const month = d.toISOString().slice(0,7), date = month + '-' + emp.joinDate.slice(8);
                if (month <= emp.joinDate.slice(0,7)) continue;
                if (!validDate(date)) return unavailable('해당 월의 월차 발생일 설정 필요');
                if (date > start && date <= cutoff && (!emp.leaveDate || date <= emp.leaveDate)) grants++;
            }
        }
        for (const grant of emp.annualGrants || []) {
            if (!validDate(grant.date) || number(grant.days) == null || grant.days < 0) return unavailable('연차 부여 설정 확인 필요');
            if (grant.date > start && grant.date <= cutoff && (!emp.leaveDate || grant.date <= emp.leaveDate)) grants += grant.days;
        }
        const days = new Map();
        for (const r of records) {
            if (nameKey(r.name) !== nameKey(name) || r.date <= start || r.date > cutoff) continue;
            const annual = r.in_time === '연차' || r.out_time === '연차';
            const used = annual ? 1 : (r.in_time === '반차' ? 0.5 : 0) + (r.out_time === '반차' ? 0.5 : 0);
            days.set(r.date, used);
        }
        const used = [...days.values()].reduce((a,b)=>a+b,0);
        return {value: Math.round((opening + grants - used)*100)/100,
            reason:`${start} 초기 ${opening} + 발생 ${grants} − 사용 ${used} = ${cutoff} 기준`};
    }
    const api = {parse, calculate, calculateOpening};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.AttendanceLeaveBalance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
