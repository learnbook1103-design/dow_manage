const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `당신은 다우밸브 근태관리 시스템의 AI 어시스턴트입니다.
직원들이 근태 보완 사유를 작성하거나 근태 관련 궁금한 점을 해결할 수 있도록 돕습니다.

주요 역할:
- 출근/퇴근 기록 없음, 지각, 조기퇴근 등에 대한 보완 사유 작성 도움
- 외근, 출장, 연차, 병가 등 근태 종류 설명
- 사유 작성 예시 제공

답변 규칙:
- 간결하고 실용적으로 답변합니다 (3~5문장 이내)
- 사유 작성 예시는 바로 복사해서 쓸 수 있도록 작성합니다
- 한국어로 답변합니다`;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { messages } = req.body;
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'messages 필드가 필요합니다' });
        }

        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages
        });

        res.status(200).json({ content: response.content[0].text });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
