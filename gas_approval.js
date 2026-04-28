const FOLDER_ID = '1sEp5apMd3YeQl9D9LIdarmgQWHnE8hQ2';
const SHEET_NAME = '결재_마스터';
const INTRANET_URL = 'https://dow-manage.vercel.app'; // 배포 후 URL 확인 필요

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
    sheet.appendRow(['ID','유형','신청자','금액','상태','상세내용','메모','신청일시','결재자1','결재일시1','결재자2','결재일시2','결재자3','결재일시3','결재자4','결재일시4','결재자5','결재일시5']);
    sheet.setFrozenRows(1);
  }
  return ss.getActiveSheet();
}

function sendMail(to, subject, body, senderName, senderEmail) {
  if (!to) return;
  try {
    GmailApp.sendEmail(to, subject, '', {
      htmlBody: body,
      name: senderName || 'DOW Valve 결재시스템',
      replyTo: senderEmail || ''
    });
  } catch(e) {}
}

function buildSubmitMailBody(body) {
  const typeIcon = { '비품구매':'🛒', '경조사비':'🌸', '출장비':'✈️', '식비':'🍽️' };
  const icon = typeIcon[body.type] || '📋';
  return `
    <div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:#5b21b6;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
        <div style="font-size:1.1rem;font-weight:700;">${icon} 결재 요청</div>
        <div style="font-size:0.85rem;opacity:0.85;margin-top:4px;">DOW Valve 결재 시스템</div>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
        <p style="margin:0 0 16px;font-size:0.95rem;">안녕하세요, <strong>${body.approverName}</strong>님.<br>아래 결재 요청 건을 검토해 주세요.</p>
        <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
          <tr><td style="padding:8px 12px;background:#f9fafb;font-weight:600;width:90px;border-radius:6px 0 0 0;">유형</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${body.type}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;font-weight:600;">신청자</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${body.applicant}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;font-weight:600;">금액</td><td style="padding:8px 12px;font-weight:700;color:#0071e3;">${Number(body.amount).toLocaleString()}원</td></tr>
        </table>
        <div style="margin-top:16px;">
          <a href="${INTRANET_URL}/approval.html?id=${body.id}" style="display:inline-block;background:#5b21b6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:0.88rem;font-weight:700;">상세보기 · 결재하기 →</a>
        </div>
        <p style="margin:10px 0 0;font-size:0.78rem;color:#6e6e73;">버튼이 작동하지 않으면 DOW Valve 인트라넷에서 직접 확인해 주세요.</p>
      </div>
    </div>`;
}

function buildDecideMailBody(body, isApplicant) {
  const statusText = body.overall_status === 'approved' ? '✅ 최종 승인' : body.overall_status === 'rejected' ? '❌ 반려' : `✓ ${body.current_step - 1}단계 승인 완료`;
  const statusColor = body.overall_status === 'approved' ? '#065f46' : body.overall_status === 'rejected' ? '#991b1b' : '#5b21b6';
  const target = isApplicant ? body.applicant : body.approverName;
  return `
    <div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:${statusColor};color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
        <div style="font-size:1.1rem;font-weight:700;">${statusText}</div>
        <div style="font-size:0.85rem;opacity:0.85;margin-top:4px;">DOW Valve 결재 시스템</div>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
        <p style="margin:0 0 16px;font-size:0.95rem;">안녕하세요, <strong>${target}</strong>님.<br>${body.type} 결재 건이 <strong>${statusText}</strong> 처리됐습니다.</p>
        <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
          <tr><td style="padding:8px 12px;background:#f9fafb;font-weight:600;width:90px;">유형</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${body.type}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;font-weight:600;">신청자</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${body.applicant}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;font-weight:600;">처리자</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${body.decided_by}</td></tr>
          ${body.note ? `<tr><td style="padding:8px 12px;background:#f9fafb;font-weight:600;">사유</td><td style="padding:8px 12px;color:#991b1b;">${body.note}</td></tr>` : ''}
        </table>
      </div>
    </div>`;
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const sheet = getOrCreateSheet();

    if (action === 'submit') {
      sheet.appendRow([body.id, body.type, body.applicant, body.amount, 'pending', JSON.stringify(body.data), '', new Date().toLocaleString('ko-KR')]);
      // 1단계 결재자에게 알림
      if (body.approverEmail && body.approverName) {
        sendMail(body.approverEmail, `[결재 요청] ${body.type} — ${body.applicant}`, buildSubmitMailBody(body), body.applicant, body.applicantEmail);
      }
    }

    if (action === 'decide') {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === body.id) {
          sheet.getRange(i+1, 5).setValue(body.overall_status || body.status);
          sheet.getRange(i+1, 7).setValue(body.note || '');
          const step = Number(body.decided_step) || 1;
          const approverCol = 7 + step * 2;       // 결재자N: 9,11,13,15,17
          const decidedAtCol = 8 + step * 2;      // 결재일시N: 10,12,14,16,18
          sheet.getRange(i+1, approverCol).setValue(body.decided_by);
          sheet.getRange(i+1, decidedAtCol).setValue(new Date().toLocaleString('ko-KR'));
          break;
        }
      }
      // 다음 결재자 또는 신청자에게 알림
      if (body.overall_status === 'pending' && body.approverEmail && body.approverName) {
        sendMail(body.approverEmail, `[결재 요청] ${body.type} — ${body.applicant} (${body.current_step}단계)`, buildSubmitMailBody(body), body.applicant, body.applicantEmail);
      } else if (body.overall_status !== 'pending' && body.applicantEmail) {
        sendMail(body.applicantEmail, `[결재 결과] ${body.type} — ${body.overall_status === 'approved' ? '최종 승인' : '반려'}`, buildDecideMailBody(body, true), body.decided_by, body.decidedByEmail);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}
