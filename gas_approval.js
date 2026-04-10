const FOLDER_ID = '1sEp5apMd3YeQl9D9LIdarmgQWHnE8hQ2';
const SHEET_NAME = '결재_마스터';
function getOrCreateSheet() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.getFilesByName(SHEET_NAME);
  let ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(SHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    const sheet = ss.getActiveSheet();
    sheet.appendRow(['ID','유형','신청자','금액','상태','상세내용','메모','결재자','결재일시','신청일시']);
    sheet.setFrozenRows(1);
  }
  return ss.getActiveSheet();
}
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const sheet = getOrCreateSheet();
    if (action === 'submit') {
      sheet.appendRow([body.id,body.type,body.applicant,body.amount,'pending',JSON.stringify(body.data),'','','',new Date().toLocaleString('ko-KR')]);
    }
    if (action === 'decide') {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === body.id) {
          sheet.getRange(i+1,5).setValue(body.status);
          sheet.getRange(i+1,7).setValue(body.note||'');
          sheet.getRange(i+1,8).setValue(body.decided_by);
          sheet.getRange(i+1,9).setValue(new Date().toLocaleString('ko-KR'));
          break;
        }
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}
