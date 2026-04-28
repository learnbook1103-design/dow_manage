const GH_OWNER = 'learnbook1103-design';
const GH_REPO = 'dow_manage';
const GH_BRANCH = 'main';

const TOP_DIRS = ['sales', 'team', 'ontology', 'inbox', 'companies', 'project'];

function insertItem(root, parts, path) {
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]]) node[parts[i]] = {};
        node = node[parts[i]];
    }
    if (!node._files) node._files = [];
    node._files.push({ name: parts[parts.length - 1].replace('.md', ''), path });
}

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

        const root = {};

        (tree || []).forEach(item => {
            if (item.type !== 'blob') return;
            if (!item.path.startsWith('hub-data/')) return;
            if (!item.path.endsWith('.md')) return;

            const rel = item.path.slice('hub-data/'.length);
            const parts = rel.split('/');
            if (!TOP_DIRS.includes(parts[0])) return;

            insertItem(root, parts, rel);
        });

        res.status(200).json(root);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
