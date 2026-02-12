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
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization');
        return res.status(204).end();
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido' });

    const user = await verifyToken(req);
    if (!user) return json(res, 401, { error: 'Não autorizado. Faça login no painel.' });

    const q = req.query || {};
    const key = (q.key || '').trim();
    if (!key) return json(res, 400, { error: 'Parâmetro key obrigatório' });

    try {
        const supabase = getSupabase();
        const { data: row, error } = await supabase.from('licenses').select('*').eq('key', key).single();
        if (error || !row) return json(res, 404, { error: 'Licença não encontrada' });
        return json(res, 200, { license: {
            key: row.key, userName: row.user_name || '', userPhone: row.user_phone || '',
            created: row.created_at, expiryDate: row.expiry_date, lifetime: row.lifetime,
            active: row.active, activated: row.activated, activatedDate: row.activated_date,
            maxUses: row.max_uses, uses: row.uses, ownerId: row.owner_id || '',
            activatedDevices: row.activated_device_fingerprint ? [row.activated_device_fingerprint] : [],
        }});
    } catch (err) {
        console.error('[getLicense]', err);
        return json(res, 500, { error: 'Erro ao buscar licença' });
    }
};
