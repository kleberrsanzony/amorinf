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
    if (!user) return json(res, 401, { error: 'Não autorizado.' });

    const { email, password, displayName } = req.body || {};
    if (!email || !password) return json(res, 400, { error: 'Email e senha são obrigatórios.' });
    if (password.length < 6) return json(res, 400, { error: 'A senha deve ter no mínimo 6 caracteres.' });

    try {
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.admin.createUser({
            email: email.trim().toLowerCase(),
            password: password,
            email_confirm: true,
            user_metadata: {
                display_name: (displayName || '').trim(),
                valid_until: null
            }
        });

        if (error) {
            console.error('[createPanelUser]', error.message);
            if (error.message.includes('already') || error.message.includes('exists')) {
                return json(res, 409, { error: 'Este email já está cadastrado.' });
            }
            return json(res, 500, { error: error.message || 'Erro ao criar usuário.' });
        }

        return json(res, 200, {
            success: true,
            user: {
                uid: data.user.id,
                email: data.user.email,
                displayName: (data.user.user_metadata && data.user.user_metadata.display_name) || ''
            }
        });
    } catch (err) {
        console.error('[createPanelUser]', err);
        return json(res, 500, { error: 'Erro interno.' });
    }
};
