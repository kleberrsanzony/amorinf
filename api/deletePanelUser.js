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
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token');
        return res.status(204).end();
    }
    if (req.method !== 'DELETE') return json(res, 405, { error: 'Método não permitido' });

    const user = await verifyToken(req);
    if (!user) return json(res, 401, { error: 'Não autorizado.' });

    const { uid } = req.body || {};
    if (!uid) return json(res, 400, { error: 'uid é obrigatório.' });

    // Não permitir que o usuário apague a si mesmo
    if (uid === user.id) {
        return json(res, 400, { error: 'Você não pode apagar sua própria conta.' });
    }

    try {
        const supabase = getSupabase();

        // 1. Remover todas as licenças cujo owner_id é este sócio (limpeza automática)
        const { data: licensesToDelete, error: listErr } = await supabase
            .from('licenses')
            .select('key')
            .eq('owner_id', uid);
        if (!listErr && licensesToDelete && licensesToDelete.length > 0) {
            const keys = licensesToDelete.map((r) => r.key);
            const { error: delLicErr } = await supabase.from('licenses').delete().in('key', keys);
            if (delLicErr) {
                console.error('[deletePanelUser] Erro ao remover licenças do sócio:', delLicErr.message);
                return json(res, 500, { error: 'Erro ao remover licenças do sócio. Tente novamente.' });
            }
        }

        // 2. Remover o usuário (sócio) do Auth
        const { error } = await supabase.auth.admin.deleteUser(uid);

        if (error) {
            console.error('[deletePanelUser]', error.message);
            return json(res, 500, { error: error.message || 'Erro ao remover usuário.' });
        }

        return json(res, 200, { success: true });
    } catch (err) {
        console.error('[deletePanelUser]', err);
        return json(res, 500, { error: 'Erro interno.' });
    }
};
