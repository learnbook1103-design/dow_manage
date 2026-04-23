const fs = require('fs');
const path = require('path');

const HUB_PATH = path.resolve(__dirname, '../hub-data');
const GEMINI_MODEL = 'gemini-2.5-flash';
const GH_OWNER = 'learnbook1103-design';
const GH_REPO = 'dow_manage';
const GH_BRANCH = 'main';

async function githubWrite(relPath, content, userName) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN 환경변수 없음');

    const apiPath = `hub-data/${relPath.replace(/\\/g, '/')}`;
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${apiPath}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
    };

    let sha;
    const getRes = await fetch(url, { headers });
    if (getRes.ok) sha = (await getRes.json()).sha;

    const body = {
        message: `[hub] ${relPath} — ${userName}`,
        content: Buffer.from(content, 'utf-8').toString('base64'),
        branch: GH_BRANCH,
        author: { name: userName, email: 'hub@dowvalve.com' }
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!putRes.ok) throw new Error(`GitHub API 오류: ${(await putRes.json()).message}`);
    return relPath;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, audioBase64, mimeType, company, userName, content: saveContent, filePath: saveFilePath } = req.body;

    // 저장 액션
    if (action === 'save') {
        if (!saveContent || !saveFilePath) return res.status(400).json({ error: 'content, filePath 필요' });
        try {
            await githubWrite(saveFilePath, saveContent, userName || '직원');
            return res.status(200).json({ ok: true, filePath: saveFilePath });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    if (!audioBase64 || !mimeType || !company) {
        return res.status(400).json({ error: '오디오 파일, MIME 타입, 거래처명이 필요합니다.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수 없음' });

    const today = new Date().toISOString().slice(0, 10);
    const author = userName || '직원';

    const prompt = `이 녹음 파일을 분석해서 미팅 기록을 작성해줘. 아래 형식의 마크다운으로 작성해.

# 미팅 기록 — ${company}
날짜: ${today}
작성자: ${author}

## 전체 녹취록
(음성을 최대한 정확하게 텍스트로 변환)

## 미팅 요약
- **주요 논의사항:**
- **결정사항:**
- **다음 액션 (담당자 / 기한):**
`;

    const body = {
        contents: [{
            role: 'user',
            parts: [
                { inline_data: { mime_type: mimeType, data: audioBase64 } },
                { text: prompt }
            ]
        }]
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!geminiRes.ok) {
        const err = await geminiRes.text();
        return res.status(geminiRes.status).json({ error: err });
    }

    const data = await geminiRes.json();
    const meetingContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!meetingContent) return res.status(500).json({ error: 'Gemini 응답 없음' });

    const filePath = `inbox/${today}-${company}-meeting.md`;
    return res.status(200).json({ content: meetingContent, filePath });
};
