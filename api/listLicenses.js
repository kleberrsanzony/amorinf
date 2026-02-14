const { verifyToken } = require('./_lib/verifyToken');
const { getSupabase } = require('./_lib/supabaseClient');

function json(res, status, data) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(status).end(JSON.stringify(data));
}

function toLicense(row) {
    if (!row || typeof row !== 'object') return null;
    return {
        key: row.key ?? '',
        userName: row.user_name ?? '',
        userPhone: row.user_phone ?? '',
        created: row.created_at ?? null,
        expiryDate: row.expiry_date ?? null,
        lifetime: !!row.lifetime,
        active: !!row.active,
        activated: !!row.activated,
        activatedDate: row.activated_date ?? null,
        maxUses: row.max_uses ?? null,
        uses: row.uses ?? 0,
        ownerId: row.owner_id ?? '',
        activatedDevices: row.activated_device_fingerprint ? [row.activated_device_fingerprint] : [],
    };
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token');
        return res.status(204).end();
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido' });

    let user;
    try {
        user = await verifyToken(req);
    } catch (err) {
        console.error('[listLicenses] verifyToken throw:', err.message);
        return json(res, 500, { error: 'Erro de autenticação.' });
    }
    if (!user) return json(res, 401, { error: 'Não autorizado. Faça login no painel.' });

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('[listLicenses] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos');
        return json(res, 503, { error: 'Serviço temporariamente indisponível.' });
    }

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
            console.error('[listLicenses] Supabase error:', error.code, error.message);
            return json(res, 500, { error: 'Erro ao listar licenças' });
        }
        const list = (rows || []).map(r => toLicense(r)).filter(Boolean);
        return json(res, 200, { licenses: list });
    } catch (err) {
        console.error('[listLicenses] catch:', err.message, err.stack || '');
        const isEnvError = err.message && String(err.message).includes('obrigatórios');
        return json(res, isEnvError ? 503 : 500, { error: isEnvError ? 'Serviço temporariamente indisponível.' : 'Erro ao listar licenças' });
    }
};
