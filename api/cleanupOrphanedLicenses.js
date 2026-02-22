/**
 * Remove licenças órfãs: owner_id que não existe mais no Auth (ex.: ex-sócios já apagados).
 * POST /api/cleanupOrphanedLicenses — requer autenticação.
 * Retorna { success, deletedCount }.
 */
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

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return json(res, 503, { error: 'Serviço temporariamente indisponível.' });
    }

    try {
        const supabase = getSupabase();

        // UIDs atuais do Auth (todos os usuários do painel)
        const { data: authData, error: authErr } = await supabase.auth.admin.listUsers();
        if (authErr) {
            console.error('[cleanupOrphanedLicenses] listUsers:', authErr.message);
            return json(res, 500, { error: 'Erro ao listar usuários.' });
        }
        const validOwnerIds = new Set((authData.users || []).map((u) => u.id));

        // Licenças cujo owner_id não está mais no Auth (órfãs)
        const { data: allLicenses, error: listErr } = await supabase
            .from('licenses')
            .select('key, owner_id')
            .not('owner_id', 'is', null);
        if (listErr) {
            console.error('[cleanupOrphanedLicenses] select:', listErr.message);
            return json(res, 500, { error: 'Erro ao listar licenças.' });
        }

        const orphaned = (allLicenses || []).filter(
            (row) => row.owner_id && row.owner_id.trim() !== '' && !validOwnerIds.has(row.owner_id)
        );
        const keysToDelete = orphaned.map((r) => r.key);
        if (keysToDelete.length === 0) {
            return json(res, 200, { success: true, deletedCount: 0, message: 'Nenhuma licença órfã.' });
        }

        const { error: delErr } = await supabase.from('licenses').delete().in('key', keysToDelete);
        if (delErr) {
            console.error('[cleanupOrphanedLicenses] delete:', delErr.message);
            return json(res, 500, { error: 'Erro ao remover licenças órfãs.' });
        }

        return json(res, 200, { success: true, deletedCount: keysToDelete.length });
    } catch (err) {
        console.error('[cleanupOrphanedLicenses]', err);
        return json(res, 500, { error: 'Erro interno.' });
    }
};
