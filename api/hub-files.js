const fs = require('fs');
const path = require('path');

const HUB_PATH = path.resolve(__dirname, '../hub-data');

module.exports = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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

    ['sales', 'team', 'ontology', 'inbox', 'companies'].forEach(d =>
        scan(path.join(HUB_PATH, d), d)
    );

    res.status(200).json(result);
};
