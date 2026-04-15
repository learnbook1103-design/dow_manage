const fs = require('fs');
const path = require('path');

const HUB_PATH = path.resolve(__dirname, '../hub-data');

function safePath(rel) {
    const abs = path.resolve(HUB_PATH, rel || '');
    if (!abs.startsWith(HUB_PATH)) throw new Error('허브 외부 경로 접근 불가');
    return abs;
}

module.exports = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const p = safePath(req.query.path);
        if (!fs.existsSync(p)) return res.status(404).json({ error: '파일 없음' });
        res.status(200).json({ content: fs.readFileSync(p, 'utf-8') });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
};
