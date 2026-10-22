const test = require('node:test');
const assert = require('node:assert/strict');
const {revise, kind} = require('../../lib/attendance/manual-reason');
const {calculateAnomalies} = require('../../shared_logic');

test('manager annual leave stays editable after cloud reload without becoming a real anomaly', () => {
    const rows=[{이름:'시험',날짜:'2026-10-20',출근:'연차',퇴근:'',근무조:'0800-1700'}];
    const config={employeeConfigList:[{name:'시험'}],currentUniqueDates:new Set(['2026-10-20']),manualReasons:{'시험_2026-10-20':'연차'}};
    assert.equal(calculateAnomalies(rows,config).length,0);
    const editable=calculateAnomalies(rows,{...config,ignoreManualReasonsForDetection:true});
    assert.equal(editable.length,1);
    assert.equal(editable[0].inAnom,false);
    assert.equal(editable[0].outAnom,false);
    assert.equal(calculateAnomalies(rows,{...config,manualReasons:{},ignoreManualReasonsForDetection:true}).length,0);
});
test('clearing or changing manager leave removes old labels and preserves real punch data', () => {
    const annual={in_time:'연차',out_time:null,status_leave:true};
    assert.equal(revise(annual,'연차','').in_time,null);
    assert.equal(revise(annual,'연차','외근').in_time,null);
    const half=revise(annual,'연차','오후반차');
    assert.equal(half.in_time,null);assert.equal(half.out_time,'반차');
    const morning=revise(half,'오후반차','오전반차');
    assert.equal(morning.in_time,'반차');assert.equal(morning.out_time,null);
    assert.equal(revise({in_time:'08:00',out_time:'반차'},'오후반차','').in_time,'08:00');
    assert.equal(revise({in_time:'08:00',out_time:'반차'},'오후반차','').out_time,null);
    assert.equal(annual.in_time,'연차');
});
test('unrelated uploaded leave and non-leave notes are preserved', () => {
    assert.equal(revise({in_time:'연차'},'','출장 확인').in_time,'연차');
    assert.equal(kind('연차 취소 확인'),'');
    assert.equal(kind('오후 반차, 개인사정'),'오후반차');
    assert.equal(revise({in_time:null,out_time:null},'','연차 취소 확인').in_time,null);
});
