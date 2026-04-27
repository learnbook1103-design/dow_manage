const GH_OWNER = 'learnbook1103-design';
const GH_REPO = 'dow_manage';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const relPath = req.query.path || '';
    if (!relPath || relPath.includes('..')) return res.status(400).json({ error: '잘못된 경로' });

    const apiPath = `hub-data/${relPath.replace(/\\/g, '/')}`;
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${apiPath}`;

    try {
        const ghRes = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        if (!ghRes.ok) return res.status(404).json({ error: '파일 없음' });
        const data = await ghRes.json();
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        res.status(200).json({ content });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
