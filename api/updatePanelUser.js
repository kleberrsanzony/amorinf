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
        res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(204).end();
    }
    if (req.method !== 'PATCH') return json(res, 405, { error: 'Método não permitido' });

    const user = await verifyToken(req);
    if (!user) return json(res, 401, { error: 'Não autorizado.' });

    const { uid, email, displayName, disabled, validUntil, password } = req.body || {};
    if (!uid) return json(res, 400, { error: 'uid é obrigatório.' });

    try {
        const supabase = getSupabase();

        const updateData = {};

        // Atualizar email se fornecido
        if (email) {
            updateData.email = email.trim().toLowerCase();
        }

        // Atualizar metadata (displayName e validUntil)
        if (displayName !== undefined || validUntil !== undefined) {
            updateData.user_metadata = {};
            if (displayName !== undefined) updateData.user_metadata.display_name = displayName;
            if (validUntil !== undefined) updateData.user_metadata.valid_until = validUntil;
        }

        // Atualizar senha se fornecida
        if (password) {
            updateData.password = password;
        }

        // Desabilitar/habilitar usuário
        if (disabled !== undefined) {
            if (disabled) {
                // Ban indefinido para desabilitar
                updateData.ban_duration = '876600h'; // ~100 anos
            } else {
                updateData.ban_duration = 'none';
            }
        }

        const { data, error } = await supabase.auth.admin.updateUserById(uid, updateData);

        if (error) {
            console.error('[updatePanelUser]', error.message);
            return json(res, 500, { error: error.message || 'Erro ao atualizar usuário.' });
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
        console.error('[updatePanelUser]', err);
        return json(res, 500, { error: 'Erro interno.' });
    }
};
