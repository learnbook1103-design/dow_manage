require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const HUB_PATH = path.resolve(__dirname, 'hub-data');
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-lite'];

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ── Tools ─────────────────────────────────────────────────────────────────────

const FUNCTION_DECLARATIONS = [
    {
        name: 'read_file',
        description: '허브의 파일을 읽습니다.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '허브 루트 기준 상대 경로 (예: sales/pipeline.md)' }
            },
            required: ['path']
        }
    },
    {
        name: 'write_file',
        description: '허브의 파일을 저장하거나 업데이트합니다.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '허브 루트 기준 상대 경로' },
                content: { type: 'string', description: '파일 전체 내용 (마크다운)' }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'list_files',
        description: '허브 내 디렉토리의 파일 목록을 조회합니다.',
        parameters: {
            type: 'object',
            properties: {
                directory: { type: 'string', description: '허브 루트 기준 상대 경로. 비우면 루트 목록.' }
            }
        }
    }
];

function safePath(rel) {
    const abs = path.resolve(HUB_PATH, rel || '');
    if (!abs.startsWith(HUB_PATH)) throw new Error('허브 외부 경로 접근 불가');
    return abs;
}

function execTool(name, args, userName) {
    if (name === 'read_file') {
        const p = safePath(args.path);
        if (!fs.existsSync(p)) return `[파일 없음: ${args.path}]`;
        return fs.readFileSync(p, 'utf-8');
    }
    if (name === 'write_file') {
        const p = safePath(args.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, args.content, 'utf-8');
        return `저장 완료: ${args.path} (로컬)`;
    }
    if (name === 'list_files') {
        const p = args.directory ? safePath(args.directory) : HUB_PATH;
        if (!fs.existsSync(p)) return '[디렉토리 없음]';
        return fs.readdirSync(p, { withFileTypes: true })
            .filter(d => !d.name.startsWith('.') && d.name !== 'node_modules')
            .map(d => (d.isDirectory() ? '📁 ' : '📄 ') + d.name)
            .join('\n');
    }
    return '[알 수 없는 도구]';
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function getWeekRange() {
    const today = new Date();
    const day = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    return {
        start: monday.toISOString().slice(0, 10),
        end: friday.toISOString().slice(0, 10)
    };
}

function loadSystemPrompt(userName, userOrg, userRank) {
    const today = new Date().toISOString().slice(0, 10);
    const week = getWeekRange();
    let base = `당신은 업무 AI 어시스턴트입니다.
자연어 요청을 받아 허브 파일을 읽고 쓰며 업무를 처리합니다.

## 현재 사용자
- 이름: ${userName}
- 부서: ${userOrg || '미확인'}
- 직급: ${userRank || '미확인'}
- 호칭: ${userName} 님

## 규칙
- 질문에 답하기 전 반드시 관련 파일을 먼저 읽으세요
- 파일 수정 시 기존 내용을 읽은 후 필요한 부분만 수정하세요
- 변경한 파일과 내용을 사용자에게 명확히 알려주세요
- 한국어로 간결하게 답변합니다
- 오늘 날짜: ${today}
- 이번 주 기간: ${week.start} ~ ${week.end} (월~금)

## 부서 기본값 규칙
- 사용자가 별도로 부서를 지정하지 않으면 항상 현재 사용자의 부서(${userOrg || '미확인'}) 기준으로 답변하세요
- "전체", "전 부서", "모든 팀" 등의 표현이 있을 때만 전체 데이터를 조회하세요

## 미결업무 파일 규칙
- 미결업무 조회·수정 시 sales/pipeline.md(전사 구버전)가 아닌 sales/pipeline/팀명.md을 사용하세요
- 현재 사용자 부서 기준 파일: sales/pipeline/${userOrg || '해당팀'}.md
- 전사 현황이 필요하면 sales/pipeline/ 폴더 내 전체 팀 파일을 순서대로 읽으세요
- 파일명 목록: 해외영업팀, 국내외관리영업팀, 2차전지영업팀, 반도체영업팀, 밸브파크팀, 엔지니어링팀, 생산기술팀

## 주간 리포트 저장 규칙
- 주간 리포트 저장 경로: sales/weekly-reports/${week.start}/팀명.md
- 예: 이번 주 해외영업팀 리포트 → sales/weekly-reports/${week.start}/해외영업팀.md
- 전사 통합 리포트 요청 시에만 → sales/weekly-reports/${week.start}/전사.md

## 거래처 명칭 규칙
- 회사명이 언급되면 write 전에 반드시 companies/_index.md를 먼저 읽어 정확한 명칭과 경로를 확인하세요
- 입력값이 기존 명칭과 유사하지만 다를 경우 write 없이 사용자에게 먼저 확인하세요
- "추가" 키워드가 있을 때만 신규 항목을 생성하고 _index.md에도 반영하세요\n\n`;

    try {
        const claudeMd = fs.readFileSync(path.join(HUB_PATH, 'CLAUDE.md'), 'utf-8');
        base += `## 회사 컨텍스트\n${claudeMd}`;
    } catch (e) { /* CLAUDE.md 없으면 기본값 */ }

    return base;
}

function toGeminiContents(messages) {
    return messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }));
}

// ── API: Chat ─────────────────────────────────────────────────────────────────

app.post('/api/hub-chat', async (req, res) => {
    const { messages, userName, userOrg, userRank } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'messages 필요' });
    const author = userName || '직원';

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수 없음 (.env 파일 확인)' });

    const genAI = new GoogleGenerativeAI(apiKey);
    const systemPrompt = loadSystemPrompt(author, userOrg, userRank);
    const contents = toGeminiContents(messages);
    const updatedFiles = [];
    const toolLog = [];

    let lastError;
    for (const modelName of MODELS) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
                systemInstruction: systemPrompt
            });

            let iterations = 0;
            while (iterations++ < 12) {
                const result = await model.generateContent({ contents });
                const candidate = result.response.candidates[0];
                const parts = candidate.content.parts;
                const functionCalls = parts.filter(p => p.functionCall);

                if (functionCalls.length === 0) {
                    const text = parts.filter(p => p.text).map(p => p.text).join('');
                    return res.status(200).json({ content: text, updatedFiles, toolLog });
                }

                contents.push({ role: 'model', parts });
                const toolResponseParts = [];
                for (const part of functionCalls) {
                    const { name, args } = part.functionCall;
                    const filePath = args.path || args.directory || '';
                    toolLog.push({ name, path: filePath });
                    const toolResult = execTool(name, args, author);
                    if (name === 'write_file') updatedFiles.push(filePath);
                    toolResponseParts.push({
                        functionResponse: { name, response: { output: toolResult } }
                    });
                }
                contents.push({ role: 'user', parts: toolResponseParts });
            }

            return res.status(500).json({ error: '최대 반복 횟수 초과' });
        } catch (err) {
            if (err.message?.includes('429') || err.message?.includes('503')) {
                lastError = err;
                continue;
            }
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
    }

    return res.status(500).json({ error: lastError?.message || '모든 모델 사용 불가' });
});

// ── API: STT ──────────────────────────────────────────────────────────────────

app.post('/api/hub-stt', async (req, res) => {
    const { action, audioBase64, mimeType, company, userName, content: saveContent, filePath: saveFilePath } = req.body;

    if (action === 'save') {
        if (!saveContent || !saveFilePath) return res.status(400).json({ error: 'content, filePath 필요' });
        try {
            const p = safePath(saveFilePath);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, saveContent, 'utf-8');
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

    let lastErr;
    for (const modelName of MODELS) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const geminiRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (geminiRes.status === 429 || geminiRes.status === 503) {
            lastErr = await geminiRes.text();
            continue;
        }

        if (!geminiRes.ok) {
            const err = await geminiRes.text();
            return res.status(geminiRes.status).json({ error: err });
        }

        const data = await geminiRes.json();
        const meetingContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!meetingContent) return res.status(500).json({ error: 'Gemini 응답 없음' });

        const filePath = `inbox/${today}-${company}-meeting.md`;
        return res.status(200).json({ content: meetingContent, filePath });
    }

    return res.status(429).json({ error: lastErr || '모든 모델 사용 불가' });
});

// ── API: File Tree ────────────────────────────────────────────────────────────

app.get('/api/hub-files', (req, res) => {
    const result = {};
    const scan = (dir, prefix) => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') return;
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                scan(path.join(dir, entry.name), rel);
            } else if (entry.name.endsWith('.md')) {
                const section = prefix || 'root';
                if (!result[section]) result[section] = [];
                result[section].push({ name: entry.name.replace('.md', ''), path: rel });
            }
        });
    };
    ['sales', 'team', 'ontology', 'inbox', 'companies', 'operations', 'project'].forEach(d =>
        scan(path.join(HUB_PATH, d), d)
    );
    res.json(result);
});

// ── API: Read Single File ─────────────────────────────────────────────────────

app.get('/api/hub-file', (req, res) => {
    try {
        const p = safePath(req.query.path);
        if (!fs.existsSync(p)) return res.status(404).json({ error: '파일 없음' });
        res.json({ content: fs.readFileSync(p, 'utf-8') });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ── Approval API ─────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://grxslikvzxafmxuepusy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyeHNsaWt2enhhZm14dWVwdXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDI4MzAsImV4cCI6MjA4ODY3ODgzMH0.F2Kz13S44mPdt4RelEIGzGP7qfZBbNRm-HAaKxJZdjc';
const GAS_APPROVAL_URL = 'https://script.google.com/macros/s/AKfycbw9ilToZxa0TbUJcOSisgYXVL-g-S5jy8eptzaHLcgAu53GmYdtZ5AXsxmoKxphBLTomA/exec';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function syncToGas(payload) {
    try {
        await fetch(GAS_APPROVAL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn('GAS 동기화 실패 (무시):', e.message);
    }
}

app.post('/api/approval/submit', async (req, res) => {
    const { type, applicant, data, amount } = req.body;
    if (!type || !applicant || !data) return res.status(400).json({ error: '필수 항목 누락' });
    const { data: row, error } = await sb.from('approvals').insert({ type, applicant, data, amount: amount || 0 }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    await syncToGas({ action: 'submit', id: row.id, type, applicant, amount: amount || 0, data });
    res.json({ ok: true, id: row.id });
});

app.get('/api/approval/list', async (req, res) => {
    const { status, applicant } = req.query;
    let query = sb.from('approvals').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (applicant) query = query.eq('applicant', applicant);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/approval/decide', async (req, res) => {
    const { id, status, note, decided_by } = req.body;
    if (!id || !status || !decided_by) return res.status(400).json({ error: '필수 항목 누락' });
    const { error } = await sb.from('approvals').update({ status, note: note || '', decided_by, decided_at: new Date().toISOString() }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    await syncToGas({ action: 'decide', id, status, note: note || '', decided_by });
    res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`\n✅  DOW 인트라넷 실행 중 → http://localhost:${PORT}\n`);
    if (!process.env.GEMINI_API_KEY) {
        console.warn('⚠️  GEMINI_API_KEY 환경변수가 설정되지 않았습니다. (.env 파일 확인)');
    }
});
