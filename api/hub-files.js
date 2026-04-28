const GH_OWNER = 'learnbook1103-design';
const GH_REPO = 'dow_manage';
const GH_BRANCH = 'main';

const TOP_DIRS = ['sales', 'team', 'ontology', 'inbox', 'companies', 'operations', 'project'];

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const secret = process.env.HUB_API_SECRET;
    if (secret && req.headers['x-hub-token'] !== secret) return res.status(401).json({ error: '인증 오류' });

    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`;

    try {
        const ghRes = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        if (!ghRes.ok) throw new Error('GitHub API 오류');
        const { tree } = await ghRes.json();

        const result = {};

        (tree || []).forEach(item => {
            if (item.type !== 'blob') return;
            if (!item.path.startsWith('hub-data/')) return;
            if (!item.path.endsWith('.md')) return;

            const rel = item.path.slice('hub-data/'.length); // e.g. "sales/pipeline/해외영업팀.md"
            const parts = rel.split('/');
            if (!TOP_DIRS.includes(parts[0])) return;

            // section = 파일의 부모 디렉토리 경로
            const section = parts.length > 1 ? parts.slice(0, -1).join('/') : parts[0];
            const name = parts[parts.length - 1].replace('.md', '');

            if (!result[section]) result[section] = [];
            result[section].push({ name, path: rel });
        });

        res.status(200).json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
