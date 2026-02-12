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
        res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(204).end();
    }
    if (req.method !== 'PUT') return json(res, 405, { error: 'Método não permitido' });

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

    const updates = {};
    if (body.userName !== undefined) updates.user_name = String(body.userName).trim();
    if (body.expiryDate !== undefined) updates.expiry_date = body.expiryDate;
    if (body.lifetime !== undefined) updates.lifetime = !!body.lifetime;
    if (body.active !== undefined) updates.active = !!body.active;
    if (body.maxUses !== undefined) updates.max_uses = body.maxUses == null ? null : parseInt(body.maxUses, 10);
    // Campos extras (podem não existir na tabela)
    if (body.userPhone !== undefined) updates.user_phone = String(body.userPhone).trim();
    if (body.ownerId !== undefined) updates.owner_id = body.ownerId || null;

    try {
        const supabase = getSupabase();
        let { error } = await supabase.from('licenses').update(updates).eq('key', key);
        // Se colunas extras causarem erro, tentar sem elas
        if (error && (error.message.includes('user_phone') || error.message.includes('owner_id'))) {
            delete updates.user_phone;
            delete updates.owner_id;
            ({ error } = await supabase.from('licenses').update(updates).eq('key', key));
        }
        if (error) {
            console.error('[updateLicense]', error.message);
            return json(res, 500, { error: 'Erro ao atualizar licença' });
        }
        return json(res, 200, { success: true });
    } catch (err) {
        console.error('[updateLicense]', err);
        return json(res, 500, { error: 'Erro ao atualizar licença' });
    }
};
