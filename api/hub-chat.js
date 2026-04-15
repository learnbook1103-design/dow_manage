const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const HUB_PATH = path.resolve(__dirname, '../hub-data');

const TOOLS = [
    {
        name: 'read_file',
        description: '허브의 파일을 읽습니다.',
        input_schema: {
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
        input_schema: {
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
        input_schema: {
            type: 'object',
            properties: {
                directory: { type: 'string', description: '허브 루트 기준 상대 경로. 비우면 루트 목록.' }
            },
            required: []
        }
    }
];

function safePath(rel) {
    const abs = path.resolve(HUB_PATH, rel || '');
    if (!abs.startsWith(HUB_PATH)) throw new Error('허브 외부 경로 접근 불가');
    return abs;
}

function execTool(name, input) {
    if (name === 'read_file') {
        const p = safePath(input.path);
        if (!fs.existsSync(p)) return `[파일 없음: ${input.path}]`;
        return fs.readFileSync(p, 'utf-8');
    }
    if (name === 'write_file') {
        const p = safePath(input.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, input.content, 'utf-8');
        return `저장 완료: ${input.path}`;
    }
    if (name === 'list_files') {
        const p = input.directory ? safePath(input.directory) : HUB_PATH;
        if (!fs.existsSync(p)) return '[디렉토리 없음]';
        return fs.readdirSync(p, { withFileTypes: true })
            .filter(d => !d.name.startsWith('.') && d.name !== 'node_modules')
            .map(d => (d.isDirectory() ? '📁 ' : '📄 ') + d.name)
            .join('\n');
    }
    return '[알 수 없는 도구]';
}

function loadSystemPrompt() {
    const today = new Date().toISOString().slice(0, 10);
    let base = `당신은 업무 AI 어시스턴트입니다.
자연어 요청을 받아 허브 파일을 읽고 쓰며 업무를 처리합니다.

## 규칙
- 질문에 답하기 전 반드시 관련 파일을 먼저 읽으세요
- 파일 수정 시 기존 내용을 읽은 후 필요한 부분만 수정하세요
- 변경한 파일과 내용을 사용자에게 명확히 알려주세요
- 한국어로 간결하게 답변합니다
- 오늘 날짜: ${today}

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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { messages } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'messages 필요' });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const history = [...messages];
    const updatedFiles = [];
    const toolLog = [];
    let iterations = 0;

    try {
        while (iterations++ < 12) {
            const response = await client.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 4096,
                system: loadSystemPrompt(),
                tools: TOOLS,
                messages: history
            });

            if (response.stop_reason === 'end_turn') {
                const text = response.content.find(c => c.type === 'text')?.text || '';
                return res.status(200).json({ content: text, updatedFiles, toolLog });
            }

            if (response.stop_reason === 'tool_use') {
                history.push({ role: 'assistant', content: response.content });
                const results = [];

                for (const block of response.content) {
                    if (block.type !== 'tool_use') continue;
                    const filePath = block.input.path || block.input.directory || '';
                    toolLog.push({ name: block.name, path: filePath });
                    const result = execTool(block.name, block.input);
                    if (block.name === 'write_file') updatedFiles.push(filePath);
                    results.push({ type: 'tool_result', tool_use_id: block.id, content: result });
                }

                history.push({ role: 'user', content: results });
            } else {
                const text = response.content.find(c => c.type === 'text')?.text || '';
                return res.status(200).json({ content: text, updatedFiles, toolLog });
            }
        }
        res.status(500).json({ error: '최대 반복 횟수 초과' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
