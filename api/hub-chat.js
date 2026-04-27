const { GoogleGenerativeAI } = require('@google/generative-ai');

const GH_OWNER = 'learnbook1103-design';
const GH_REPO = 'dow_manage';
const GH_BRANCH = 'main';
const MODELS = ['gemini-2.5-flash', 'gemini-3.1-flash-lite-preview'];

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

function ghHeaders() {
    return {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
}

async function githubRead(relPath) {
    const apiPath = `hub-data/${relPath.replace(/\\/g, '/')}`;
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${apiPath}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return Buffer.from(data.content, 'base64').toString('utf-8');
}

async function githubList(relDir) {
    const apiPath = relDir ? `hub-data/${relDir.replace(/\\/g, '/')}` : 'hub-data';
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${apiPath}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (!res.ok) return null;
    return res.json();
}

async function githubWrite(relPath, content, userName, retries = 2) {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN 환경변수 없음');

    const apiPath = `hub-data/${relPath.replace(/\\/g, '/')}`;
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${apiPath}`;

    let sha;
    const getRes = await fetch(url, { headers: ghHeaders() });
    if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
    }

    const body = {
        message: `[hub] ${relPath} — ${userName}`,
        content: Buffer.from(content, 'utf-8').toString('base64'),
        branch: GH_BRANCH,
        author: { name: userName, email: 'hub@dowvalve.com' }
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(url, { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
    if (putRes.status === 409 && retries > 0) {
        // SHA 충돌(동시 수정) → SHA 갱신 후 재시도
        return githubWrite(relPath, content, userName, retries - 1);
    }
    if (!putRes.ok) {
        const err = await putRes.json();
        throw new Error(`GitHub API 오류: ${err.message}`);
    }
    return `저장 완료: ${relPath} (GitHub 커밋됨)`;
}

async function execTool(name, args, userName) {
    if (name === 'read_file') {
        const content = await githubRead(args.path);
        return content !== null ? content : `[파일 없음: ${args.path}]`;
    }
    if (name === 'write_file') {
        return await githubWrite(args.path, args.content, userName);
    }
    if (name === 'list_files') {
        const items = await githubList(args.directory || '');
        if (!items) return '[디렉토리 없음]';
        return items
            .filter(i => !i.name.startsWith('.') && i.name !== 'node_modules')
            .map(i => (i.type === 'dir' ? '📁 ' : '📄 ') + i.name)
            .join('\n');
    }
    return '[알 수 없는 도구]';
}

function getWeekRange() {
    const today = new Date();
    const day = today.getDay(); // 0=일, 1=월 ... 6=토
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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { messages, userName, userOrg, userRank } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'messages 필요' });
    const author = userName || '직원';

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
                    const toolResult = await execTool(name, args, author);
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

    return res.status(500).json({ error: 'AI 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해 주세요.' });
};
