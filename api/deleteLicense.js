const { verifyToken } = require('./_lib/verifyToken');
const { getSupabase } = require('./_lib/supabaseClient');

function json(res, status, data) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(status).end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(204).end();
    }
    if (req.method !== 'DELETE') return json(res, 405, { error: 'Método não permitido' });

    const user = await verifyToken(req);
    if (!user) return json(res, 401, { error: 'Não autorizado. Faça login no painel.' });

    const q = req.query || {};
    let licenseKey = (q.key || '').trim();
    if (!licenseKey && req.body) {
        try {
            const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            licenseKey = (b.key || '').trim();
        } catch (_) {}
    }
    if (!licenseKey) return json(res, 400, { error: 'Parâmetro key obrigatório' });

    try {
        const supabase = getSupabase();
        const { error } = await supabase.from('licenses').delete().eq('key', licenseKey);
        if (error) {
            console.error('[deleteLicense]', error.message);
            return json(res, 500, { error: 'Erro ao deletar licença' });
        }
        return json(res, 200, { success: true });
    } catch (err) {
        console.error('[deleteLicense]', err);
        return json(res, 500, { error: 'Erro ao deletar licença' });
    }
};
