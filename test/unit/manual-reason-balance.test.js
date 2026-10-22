const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {calculateOpening}=require('../../lib/attendance/leave-balance');

function setup(date='2026-10-07') {
    const key=`시험_${date}`;
    let stored={manager_key:key,name:'시험',date,in_time:'연차',out_time:null,manager_reason:'연차',status_leave:true};
    let fail=false;
    const context={
        supabase:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{...stored}})})}),
            upsert:async rows=>{if(fail)return {error:new Error('save failed')};stored={...rows[0]};return {error:null};}})},
        splitManagerKey:()=>['시험',date],manualCorrections:{[key]:{leave:true}},
        manualReasons:{[key]:'연차'},employeeExplanations:{},manualEarlyPunches:{},unconfirmedAnomaliesMap:{},
        attendanceFilesMap:new Map([['Cloud_Data',[{이름:'시험',날짜:date,출근:'연차',퇴근:''}]]]),
        normalizeName:v=>v,normalizeAttendanceDateValue:v=>v,expandShift:v=>v,stripAccessLogReasonText:v=>v,
        AttendanceManualReason:require('../../lib/attendance/manual-reason'),
        leaveLedgerRecords:[{...stored}],localStorage:{setItem(){}},console:{error(){}}
    };
    const html=fs.readFileSync(require.resolve('../../admin.html'),'utf8');
    const start=html.indexOf('async function syncSingleRecordToCloud(');
    vm.createContext(context);
    vm.runInContext(html.slice(start,html.indexOf('function updateAndProcessData(',start)),context);
    const opening={version:2,asOf:'2026-09-30',employees:{시험:{balance:5,accrualType:'annual',policyThrough:'2026-12-31'}}};
    return {context,opening,setFail:()=>{fail=true;},record:()=>stored,
        save:async next=>{context.manualReasons[key]=next;await context.syncSingleRecordToCloud(key,{reasonEdit:true});},
        balance:()=>calculateOpening(opening,'시험','2026-10-15',context.leaveLedgerRecords).value};
}

test('actual save path recalculates annual → half → cancellation, repeat save and reload without double adjustment',async()=>{
    const f=setup();
    assert.equal(f.balance(),4);
    await f.save('오후반차');assert.equal(f.balance(),4.5);
    await f.save('오후반차');assert.equal(f.balance(),4.5);
    await f.save('오전반차');assert.equal(f.balance(),4.5);
    await f.save('');assert.equal(f.balance(),5);
    assert.equal(calculateOpening(f.opening,'시험','2026-10-15',[f.record()]).value,5);
    await f.save('연차');assert.equal(f.balance(),4);
    assert.equal(f.context.leaveLedgerRecords.length,1);
});

test('failed save leaves cached usage, stored usage and calculated balance unchanged',async()=>{
    const f=setup();f.setFail();
    await assert.rejects(f.save(''),/save failed/);
    assert.equal(f.record().in_time,'연차');
    assert.equal(f.context.attendanceFilesMap.get('Cloud_Data')[0].출근,'연차');
    assert.equal(f.balance(),4);
});

test('changing September usage also updates October balance instead of freezing the old September closing balance',async()=>{
    const f=setup('2026-09-22');
    f.opening.historyAsOf='2026-08-31';
    f.opening.employees.시험.historyBalance=6;
    assert.equal(f.balance(),5);
    await f.save('오후반차');assert.equal(f.balance(),5.5);
    await f.save('');assert.equal(f.balance(),6);
    assert.equal(calculateOpening(f.opening,'시험','2026-09-15',[f.record()]).value,6);
});
