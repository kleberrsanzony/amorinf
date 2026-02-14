const fs = require('fs');
const path = require('path');

function json(res, status, data) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(status).end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token');
        return res.status(204).end();
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido' });

    try {
        // Tentar ler version.json incluído via vercel.json includeFiles
        const versionPath = path.join(__dirname, '..', 'admin', 'version.json');
        const raw = fs.readFileSync(versionPath, 'utf-8');
        const data = JSON.parse(raw);
        return json(res, 200, {
            version: data.version || null,
            publishedAt: data.date || data.publishedAt || null,
            filename: data.filename || null
        });
    } catch (err) {
        // Fallback: retornar vazio para não causar 404
        return json(res, 200, { version: null, publishedAt: null, filename: null });
    }
};
