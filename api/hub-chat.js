const { GoogleGenerativeAI } = require('@google/generative-ai');

const GH_OWNER = 'learnbook1103-design';
const GH_REPO = 'dow_manage';
const GH_BRANCH = 'main';
const MODELS = ['gemini-2.5-flash', 'gemini-3.1-flash-lite-preview', 'gemini-2.0-flash', 'gemini-1.5-flash'];

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

async function loadSystemPrompt(userName, userOrg, userRank) {
    const today = new Date().toISOString().slice(0, 10);
    const week = getWeekRange();
    // Supabase org 값의 공백을 제거해 파일명과 일치시킴 (예: "2차전지 영업팀" → "2차전지영업팀")
    const pipelineOrg = (userOrg || '').replace(/\s+/g, '');
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

## 데이터 구조 — 필독
업무 데이터는 세 가지로 분리되어 있습니다. **개인 업무 파일이 기본 출발점**입니다.

**1. 개인 업무 (sales/tasks/personal/이름.md) ← 기본값**
- 사용자가 직접 관리하는 본인의 업무 목록
- "내 업무", "오늘 뭐 해야 해", "내 현황", "할 일" 등 → **항상 이 파일부터** 읽으세요
- 파일 경로: sales/tasks/personal/${userName}.md
- 파일이 없으면 사용자에게 "개인 업무 파일이 없습니다. 만들까요?" 라고 먼저 물어보세요
  (만들 때는 sales/tasks/personal/_template.md를 읽어 형식 복사)
- ERP 연동 시 member_idx 기준으로 자동 매핑 예정

**2. 팀별 과제 (sales/tasks/팀명.md)**
- 팀 단위 프로젝트, 소싱, BD, 운영 업무
- 컬럼: 유형(소싱·BD·내부) | 담당자 | 업무내용 | 진행율 | 현황 | 다음 액션
- 담당자 컬럼: 담당 사원 이름 (미지정이면 "—")
- "우리 팀 현황", "팀 과제", "전체 미결업무" 등 팀 단위 질문 → 이 파일을 사용
- 현재 사용자 부서 기준 파일: sales/tasks/${pipelineOrg || '해당팀'}.md
- 파일명 목록: 해외영업팀, 국내외관리영업팀, 2차전지영업팀, 반도체영업팀, 밸브파크팀, 엔지니어링팀, 생산기술팀

**3. 고객사별 영업 딜 (companies/customers/[고객사명]/deals.md)**
- 특정 고객사와 진행 중인 수주 기회
- 컬럼: 건명 | 영업단계(리드→수주확정→출고완료) | 담당자 | 다음 액션 | 메모
- 담당자 컬럼: 담당 영업사원 이름
- "HPRAY 딜", "Tema Oil 영업 현황" → 이 파일을 사용
- 영업단계: 리드 | 견적요청 | 견적발송 | 협의중 | 수주확정 | 생산/납기 | 출고완료 | 종료 | 보류

## 주간 리포트 규칙
- 저장 경로: sales/weekly-reports/${week.start}/팀명.md
- 예: 이번 주 해외영업팀 리포트 → sales/weekly-reports/${week.start}/해외영업팀.md
- 전사 통합 리포트 요청 시에만 → sales/weekly-reports/${week.start}/전사.md
- **조회 요청 시**: 먼저 해당 경로 파일을 읽어서 바로 보여주세요. 파일이 없을 때만 "이번 주 리포트가 없습니다. 지금 작성할까요?"라고 물어보세요
- **작성 요청 시**: 반드시 아래 순서로 진행하세요
  1. sales/weekly-reports/_templates/팀명.md 를 먼저 읽어 해당 팀 포맷 확인
  2. 개인 업무(personal/이름.md) → 팀 과제(tasks) → 고객사 딜(deals) 순서로 데이터 참조
  3. 템플릿 구조를 유지하며 초안 작성 (지난주 실적 + 이번주 계획 모두 포함)
  4. 생산기술팀은 표 형식으로 출력 (최종본은 사원이 pptx에 붙여넣기)
- 템플릿 파일명: 해외영업팀 / 국내외관리영업팀 / 반도체영업팀 / 엔지니어링팀 / 2차전지영업팀 / 밸브파크팀 / 생산기술팀

## ERP 경계 규칙
다우밸브는 자체 ERP 시스템을 사용합니다. 아래 데이터는 Hub에 없으며 ERP에서 확인해야 합니다:
- 수주 금액·수량, 세금계산서, 매출, 발주, 재고, 입출고
- 이 정보를 물어보면 파일을 찾지 말고 "해당 정보는 ERP에서 확인하세요"라고 안내하세요
- Hub은 ERP 앞단(리드→협의중)과 지식·미팅·팀 과제를 담당합니다

## 파이프라인 업무 수정 규칙
"다음 액션 완료" 또는 "완료 처리" 요청 시 반드시 아래 세 필드를 모두 수정하세요:
1. **현황** — 완료된 액션 내용을 현황에 반영 (예: "〇〇 완료")
2. **다음 액션** — 완료된 항목 삭제. 새 액션이 있으면 기재, 없으면 "—"
3. **진행율** — 사용자가 명시했으면 그대로 반영. 명시하지 않았으면 저장 전에 반드시 "완료 처리 후 진행율을 몇 %로 변경할까요?" 라고 질문할 것

절대 금지:
- "다음 액션" 텍스트 뒤에 "(완료)" 문자열만 추가한 채 저장
- 진행율을 변경하지 않고 저장 (사용자가 명시적으로 유지를 요청한 경우 제외)

## 거래처 명칭 규칙
- 회사명이 언급되면 write 전에 반드시 companies/_index.md를 먼저 읽어 정확한 명칭과 경로를 확인하세요
- 입력값이 기존 명칭과 유사하지만 다를 경우 write 없이 사용자에게 먼저 확인하세요
- "추가" 키워드가 있을 때만 신규 항목을 생성하고 _index.md에도 반영하세요

## 미팅·inbox 처리 규칙
inbox/ 경로의 파일 처리 요청 시 반드시 아래 순서로 진행하세요:
1. **파일 읽기** — 요청된 inbox 파일을 읽어 내용 파악
2. **거래처 확인** — 파일 내 거래처명을 companies/_index.md와 대조해 정확한 경로 확인
3. **deals.md 읽기** — companies/customers/[거래처명]/deals.md를 읽어 현재 단계 확인
4. **단계 변경 판단** — 아래 규칙을 엄격히 적용:
   - 영업 단계 순서: 리드 → 견적요청 → 견적발송 → 협의중 → 수주확정 → 생산/납기 → 출고완료 → 종료
   - **역행 금지**: 현재 단계보다 이전 단계로는 절대 변경하지 않는다. 역행이 감지되면 단계는 유지하고 "⚠️ 역행 감지 — [현재단계] 유지" 경고만 표시
   - **동일 단계**: 현재와 같은 단계이면 단계 컬럼은 수정하지 않는다
   - **전진만 허용**: 현재보다 앞 단계로 이동하는 경우에만 단계를 업데이트
5. **다음 액션 반영** — deals.md의 해당 건 "다음 액션" 칸 업데이트 (단계 변경 여부와 무관하게 항상 최신 액션으로 갱신)
6. **처리 결과 요약** — 변경된 항목과 변경하지 않은 이유를 사용자에게 명확히 알려주세요

주의:
- deals.md에 해당 건이 없으면 사용자에게 확인 후 신규 건으로 추가
- 단계도 액션도 기존과 동일하면 파일을 수정하지 않고 "변경 없음"으로 처리\n\n`;

    try {
        const claudeMd = await githubRead('CLAUDE.md');
        if (claudeMd) base += `## 회사 컨텍스트\n${claudeMd}`;
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

    const secret = process.env.HUB_API_SECRET;
    if (secret && req.headers['x-hub-token'] !== secret) return res.status(401).json({ error: '인증 오류' });

    const { messages, userName, userOrg, userRank } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'messages 필요' });
    const author = userName || '직원';

    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수 없음' });
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    let systemPrompt;
    try { systemPrompt = await loadSystemPrompt(author, userOrg, userRank); }
    catch (e) { return res.status(500).json({ error: '시스템 프롬프트 로딩 실패: ' + e.message }); }
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
