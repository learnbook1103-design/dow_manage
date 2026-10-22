const test = require('node:test');
const assert = require('node:assert/strict');
const {prepare,save} = require('../../lib/attendance/leave-adjustments');
const {calculateOpening:calc} = require('../../lib/attendance/leave-balance');
const baseline = () => ({version:2,asOf:'2026-09-30',historyAsOf:'2026-08-31',employees:{
    김현욱:{balance:0,historyBalance:0,monthlyStart:'2026-10-15',accrualType:'monthly',policyThrough:null},
    다른직원:{balance:3,accrualType:'annual',annualGrants:[{date:'2027-01-01',days:15}]}
}});
test('dated adjustment excludes same-day accrual and usage, retains older reports, and rolls forward',()=>{
 const original=baseline();
 let b=prepare(original,'김현욱','2026-10-15','4');
 const records=[{name:'김현욱',date:'2026-10-15',in_time:'연차'},{name:'김현욱',date:'2026-10-16',out_time:'반차'}];
 assert.equal(calc(b,'김현욱','2026-10-14',records).value,0);
 assert.equal(calc(b,'김현욱','2026-10-15',records).value,4);
 assert.equal(calc(b,'김현욱','2026-10-31',records).value,3.5);
 assert.equal(calc(b,'김현욱','2026-11-15',records).value,4.5);
 b=prepare(b,'김현욱','2026-11-15','0');
 assert.equal(calc(b,'김현욱','2026-10-31',records).value,3.5);
 assert.equal(calc(b,'김현욱','2026-12-15',records).value,1);
 b=prepare(b,'김현욱','2026-11-15','-1');
 assert.equal(b.employees.김현욱.adjustments.length,2);
 assert.equal(calc(b,'김현욱','2026-12-15',records).value,0);
 assert.equal(original.employees.김현욱.adjustments,undefined);
 assert.deepEqual(b.employees.다른직원,original.employees.다른직원);
});
test('annual grant after manual baseline and missing initial balance',()=>{
 const b=baseline(); b.employees.다른직원.balance=null;
 const saved=prepare(b,'다른직원','2026-12-31','2.5');
 assert.equal(calc(saved,'다른직원','2026-12-31',[]).value,2.5);
 assert.equal(calc(saved,'다른직원','2027-01-01',[]).value,17.5);
 for(const input of ['', 'abc','NaN','Infinity','1.234']) assert.throws(()=>prepare(b,'김현욱','2026-10-15',input));
 assert.throws(()=>prepare(b,'김현욱','2026-02-30','1'));
});
function client(result) {
 const original=baseline(), calls=[];
 return {original,calls,from(){let write=false;const q={
 select(){return write?Promise.resolve(result):q;},eq(...args){calls.push(args);return q;},is(...args){calls.push(args);return q;},
 single:async()=>({data:{value:original,updated_at:'revision-1'}}),
 update(value){write=true;calls.push(value);if(result.data?.length) result.data[0].value=value.value;return q;}
 };return q;}};
}
test('save persists full setting with timestamp guard and rejects conflicts or failures',async()=>{
 const c=client({data:[{}]});
 const saved=await save(c,'김현욱','2026-10-15','0');
 assert.deepEqual(saved.employees.김현욱.adjustments,[{date:'2026-10-15',balance:0}]);
 assert.ok(c.calls.some(x=>Array.isArray(x)&&x[0]==='updated_at'&&x[1]==='revision-1'));
 assert.deepEqual(saved.employees.다른직원,c.original.employees.다른직원);
 await assert.rejects(save(client({data:[]}),'김현욱','2026-10-15','1'),/다른 담당자/);
 await assert.rejects(save(client({error:new Error('offline')}),'김현욱','2026-10-15','1'),/offline/);
});
test('editor saves on blur, clears temporary override, and restores prior value on failure',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),events={},messages=[];
 let fail=false,saves=0;
 const context={document:{addEventListener:(name,fn)=>events[name]=fn},alert:m=>messages.push(m),
  saveLeaveBalanceAdjustment:async(name,date,text)=>{saves++;assert.equal(name,'김현욱');assert.equal(date,'2026-10-15');if(fail)throw new Error('offline');}};
 vm.runInNewContext(fs.readFileSync('lib/attendance/report-presentation.js','utf8'),context);
 const field={dataset:{leaveBalanceKey:'key',leaveBalanceName:'김현욱',leaveBalanceDate:'2026-10-15',autoBalance:'1'},textContent:'0',setAttribute(){},removeAttribute(){}};
 const event={target:{closest:()=>field}};
 events.input(event);await events.focusout(event);
 assert.equal(saves,1);assert.equal(field.dataset.autoBalance,'0');
 assert.equal(context.AttendanceReportPresentation.leaveBalance('key','9'),'9');
 field.textContent='3';fail=true;events.input(event);await events.focusout(event);
 assert.equal(field.textContent,'0');assert.match(messages[0],/저장 실패/);
 field.textContent='';events.input(event);await events.focusout(event);
 assert.equal(saves,2);assert.equal(field.textContent,'0');
});
