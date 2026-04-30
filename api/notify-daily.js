const { GoogleGenerativeAI } = require('@google/generative-ai');

const SUPABASE_URL = 'https://grxslikvzxafmxuepusy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyeHNsaWt2enhhZm14dWVwdXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDI4MzAsImV4cCI6MjA4ODY3ODgzMH0.F2Kz13S44mPdt4RelEIGzGP7qfZBbNRm-HAaKxJZdjc';

const GH_OWNER = 'learnbook1103-design';
const GH_REPO = 'dow_manage';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbw9ilToZxa0TbUJcOSisgYXVL-g-S5jy8eptzaHLcgAu53GmYdtZ5AXsxmoKxphBLTomA/exec';
const HUB_URL = 'https://dow-manage.vercel.app';

function ghHeaders() {
    return {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
}

async function readHubFile(path) {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/hub-data/${path}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (!res.ok) return null;
    const json = await res.json();
    return Buffer.from(json.content, 'base64').toString('utf-8');
}

async function getEmployees() {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/employees?select=name,email,org&email=not.is.null`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.filter(e => e.email && e.email.trim() && e.org && e.org.trim());
}

async function extractTeamTasks(teamContent, isMonday, org) {
    if (!teamContent) return { warnings: [], tasks: [] };
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const nowKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const todayStr = `${nowKST.getFullYear()}년 ${nowKST.getMonth() + 1}월 ${nowKST.getDate()}일`;

    const prompt = `오늘은 ${todayStr}입니다. 다음은 ${org} 팀의 업무 허브 파일입니다.

---
${teamContent}
---

이 파일에서 ${isMonday ? '이번 주 팀 업무' : '오늘 기준 팀 업무'}를 추출해 JSON으로만 응답하세요.

{
  "warnings": ["기한 초과/지연/주의 건 (없으면 빈 배열)"],
  "tasks": ["${isMonday ? '이번 주 주요 할 일' : '오늘 할 일'} (없으면 빈 배열)"]
}

JSON 외 다른 텍스트 없이 응답하세요.`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(text);
    } catch {
        return { warnings: [], tasks: [] };
    }
}

function buildEmailHtml(name, org, teamData, personalContent, isMonday) {
    const nowKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const dateStr = nowKST.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const title = isMonday ? '이번 주 업무 브리핑' : '오늘의 업무 브리핑';
    const taskLabel = isMonday ? '이번 주 팀 과제' : '오늘 할 일';

    const warningsHtml = teamData.warnings.length ? `
        <div style="margin-bottom:20px;">
            <div style="font-weight:700;font-size:0.88rem;color:#dc2626;margin-bottom:8px;">⚠️ 주의 건</div>
            <ul style="margin:0;padding-left:18px;">
                ${teamData.warnings.map(w => `<li style="margin-bottom:5px;font-size:0.87rem;color:#374151;">${w}</li>`).join('')}
            </ul>
        </div>` : '';

    const tasksHtml = teamData.tasks.length ? `
        <div style="margin-bottom:20px;">
            <div style="font-weight:700;font-size:0.88rem;color:#0071e3;margin-bottom:8px;">📌 ${taskLabel}</div>
            <ul style="margin:0;padding-left:18px;">
                ${teamData.tasks.map(t => `<li style="margin-bottom:5px;font-size:0.87rem;color:#374151;">${t}</li>`).join('')}
            </ul>
        </div>` : '';

    const personalHtml = personalContent ? `
        <div style="margin-bottom:20px;padding:14px;background:#f8faff;border-radius:8px;border-left:3px solid #0071e3;">
            <div style="font-weight:700;font-size:0.88rem;color:#1d4ed8;margin-bottom:6px;">👤 내 업무</div>
            <pre style="margin:0;font-family:inherit;font-size:0.84rem;color:#374151;white-space:pre-wrap;">${personalContent.slice(0, 800)}</pre>
        </div>` : '';

    const emptyHtml = !teamData.warnings.length && !teamData.tasks.length && !personalContent
        ? `<p style="color:#6b7280;font-size:0.88rem;">오늘 특별한 업무 항목이 없습니다.</p>` : '';

    return `<div style="font-family:'Apple SD Gothic Neo',Pretendard,sans-serif;max-width:520px;margin:0 auto;">
        <div style="background:#0071e3;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
            <div style="font-size:1.05rem;font-weight:700;">📋 ${title}</div>
            <div style="font-size:0.83rem;opacity:0.85;margin-top:4px;">${dateStr} · ${org}</div>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
            <p style="margin:0 0 20px;font-size:0.93rem;">안녕하세요, <strong>${name}</strong>님.</p>
            ${warningsHtml}
            ${tasksHtml}
            ${personalHtml}
            ${emptyHtml}
            <div style="margin-top:24px;padding-top:16px;border-top:1px solid #f3f4f6;">
                <a href="${HUB_URL}/hub.html" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:0.88rem;font-weight:700;">업무 허브에서 확인하기 →</a>
            </div>
            <p style="margin:12px 0 0;font-size:0.76rem;color:#9ca3af;">DOW Valve 업무 허브 자동 발송 메일</p>
        </div>
    </div>`;
}

async function sendViaGAS(to, subject, html) {
    const res = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'notify', to, subject, html })
    });
    return res.ok;
}

const TEST_EMAIL = 'dowvalve.jeong@gmail.com';
const TEST_NAME = '정상민';
const TEST_ORG = '2차전지영업팀';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const isTest = req.query.test === 'true';

    if (!isTest) {
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    try {
        const nowKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const day = nowKST.getDay();
        const isMonday = day === 1;

        // 테스트 모드: 정상민 메일로만 발송
        if (isTest) {
            const teamContent = await readHubFile(`sales/tasks/${TEST_ORG}.md`);
            const teamData = await extractTeamTasks(teamContent, isMonday, TEST_ORG);
            const personalContent = await readHubFile(`sales/tasks/personal/${TEST_NAME}.md`);
            const html = buildEmailHtml(TEST_NAME, TEST_ORG, teamData, personalContent, isMonday);
            const dateLabel = nowKST.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
            const subject = `[테스트] ${isMonday ? '이번 주 업무' : '오늘의 업무'} ${dateLabel} · ${TEST_NAME}님`;
            await sendViaGAS(TEST_EMAIL, subject, html);
            return res.status(200).json({ ok: true, sent: 1, mode: 'test', to: TEST_EMAIL });
        }

        const employees = await getEmployees();
        if (!employees.length) return res.status(200).json({ ok: true, sent: 0, reason: '이메일 있는 직원 없음' });

        // 팀별 파일 + AI 추출 병렬 처리
        const uniqueOrgs = [...new Set(employees.map(e => e.org))];
        const teamDataMap = {};

        await Promise.all(uniqueOrgs.map(async org => {
            const content = await readHubFile(`sales/tasks/${org}.md`);
            teamDataMap[org] = await extractTeamTasks(content, isMonday, org);
        }));

        // 개인 파일 병렬 조회
        const personalMap = {};
        await Promise.all(employees.map(async emp => {
            personalMap[emp.name] = await readHubFile(`sales/tasks/personal/${emp.name}.md`);
        }));

        // 이메일 발송
        const dateLabel = nowKST.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
        const subjectPrefix = isMonday ? `[이번 주 업무] ${dateLabel}` : `[오늘의 업무] ${dateLabel}`;

        let sent = 0;
        await Promise.all(employees.map(async emp => {
            const teamData = teamDataMap[emp.org] || { warnings: [], tasks: [] };
            const personalContent = personalMap[emp.name];
            const html = buildEmailHtml(emp.name, emp.org, teamData, personalContent, isMonday);
            const subject = `${subjectPrefix} · ${emp.name}님`;
            const ok = await sendViaGAS(emp.email, subject, html);
            if (ok) sent++;
        }));

        res.status(200).json({ ok: true, sent, total: employees.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
