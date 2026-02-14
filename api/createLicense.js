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
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token');
        return res.status(204).end();
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido' });

    const user = await verifyToken(req);
    if (!user) return json(res, 401, { error: 'Não autorizado. Faça login no painel.' });

    let body;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (_) {
        return json(res, 400, { error: 'Body JSON inválido' });
    }

    const key = (body.key || '').trim();
    if (!key) return json(res, 400, { error: 'Campo key obrigatório' });

    const userName = (body.userName || body.user_name || '').trim() || '';
    const userPhone = (body.userPhone || body.user_phone || '').trim() || '';
    const expiryDate = body.expiryDate || body.expiry_date || null;
    const lifetime = !!body.lifetime;
    const active = body.active !== false;
    const maxUses = body.maxUses != null ? parseInt(body.maxUses, 10) : null;
    const uses = body.uses != null ? parseInt(body.uses, 10) : 0;
    const ownerId = body.ownerId || body.owner_id || user.id || null;

    try {
        const supabase = getSupabase();

        // Tenta com todas as colunas (user_phone, owner_id)
        const fullRow = {
            key, user_name: userName, user_phone: userPhone,
            expiry_date: expiryDate, lifetime, active,
            max_uses: Number.isNaN(maxUses) ? null : maxUses,
            uses: Number.isNaN(uses) ? 0 : uses,
            owner_id: ownerId, activated: false,
        };
        let { data, error } = await supabase.from('licenses').insert(fullRow).select().single();

        // Fallback: se colunas extras não existem, inserir sem elas
        if (error && (error.message.includes('user_phone') || error.message.includes('owner_id'))) {
            const basicRow = { key, user_name: userName, expiry_date: expiryDate, lifetime, active,
                max_uses: Number.isNaN(maxUses) ? null : maxUses, uses: Number.isNaN(uses) ? 0 : uses, activated: false };
            ({ data, error } = await supabase.from('licenses').insert(basicRow).select().single());
        }

        if (error) {
            if (error.code === '23505') return json(res, 409, { error: 'Licença já existe' });
            console.error('[createLicense]', error.message);
            return json(res, 500, { error: 'Erro ao criar licença' });
        }
        return json(res, 201, { success: true, license: {
            key: data.key, userName: data.user_name, userPhone: data.user_phone || '',
            expiryDate: data.expiry_date, lifetime: data.lifetime, active: data.active,
            maxUses: data.max_uses, uses: data.uses, ownerId: data.owner_id || '',
            created: data.created_at,
        }});
    } catch (err) {
        console.error('[createLicense]', err);
        return json(res, 500, { error: 'Erro ao criar licença' });
    }
};
