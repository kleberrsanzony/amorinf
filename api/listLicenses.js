const { verifyToken } = require('./_lib/verifyToken');
const { getSupabase } = require('./_lib/supabaseClient');

function json(res, status, data) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(status).end(JSON.stringify(data));
}

function toLicense(row) {
    return {
        key: row.key, userName: row.user_name || '', userPhone: row.user_phone || '',
        created: row.created_at, expiryDate: row.expiry_date, lifetime: row.lifetime,
        active: row.active, activated: row.activated, activatedDate: row.activated_date,
        maxUses: row.max_uses, uses: row.uses, ownerId: row.owner_id || '',
        activatedDevices: row.activated_device_fingerprint ? [row.activated_device_fingerprint] : [],
    };
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
    const ownerId = q.ownerId || q.owner_id || null;

    try {
        const supabase = getSupabase();
        let query = supabase.from('licenses').select('*').order('created_at', { ascending: false });
        if (ownerId) {
            try { query = query.eq('owner_id', ownerId); } catch (_) {}
        }
        const { data: rows, error } = await query;
        if (error) {
            console.error('[listLicenses]', error.message);
            return json(res, 500, { error: 'Erro ao listar licenças' });
        }
        return json(res, 200, { licenses: (rows || []).map(toLicense) });
    } catch (err) {
        console.error('[listLicenses]', err);
        return json(res, 500, { error: 'Erro ao listar licenças' });
    }
};
