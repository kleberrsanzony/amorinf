/**
 * /api/panelUsers — CRUD de usuários do painel
 * POST = criar | GET = listar | PUT/PATCH = atualizar | DELETE = remover
 */
const {
    getAdminAuth, verifyMasterToken, parseBody,
    getPanelUser, setPanelUser, removePanelUser, listPanelUsersFromDb
} = require('./_lib/firebaseAdmin');

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();

    try {
        const authResult = await verifyMasterToken(req);
        if (!authResult.ok) return res.status(authResult.status).json({ error: 'Não autorizado.' });

        const auth = getAdminAuth();
        if (!auth) return res.status(503).json({ error: 'Serviço indisponível.' });

        // ===== GET: listar =====
        if (req.method === 'GET') {
            const listResult = await auth.listUsers(1000);
            const authUsers = listResult.users || [];
            const dbUsers = await listPanelUsersFromDb();
            const dbMap = {};
            dbUsers.forEach(u => { if (u.uid) dbMap[u.uid] = u; });

            const users = authUsers.map(userRecord => {
                const dbData = dbMap[userRecord.uid] || {};
                const claims = userRecord.customClaims || {};
                return {
                    uid: userRecord.uid, email: userRecord.email || '',
                    displayName: userRecord.displayName || dbData.displayName || '',
                    disabled: userRecord.disabled || false,
                    validUntil: claims.validUntil !== undefined ? claims.validUntil : (dbData.validUntil !== undefined ? dbData.validUntil : -1),
                    createdAt: dbData.createdAt || (userRecord.metadata?.creationTime ? new Date(userRecord.metadata.creationTime).getTime() : null),
                    lastSignIn: userRecord.metadata?.lastSignInTime || null,
                    emailVerified: userRecord.emailVerified || false,
                };
            });
            return res.status(200).json({ success: true, users });
        }

        // ===== POST: criar =====
        if (req.method === 'POST') {
            const body = parseBody(req);
            const email = (body.email != null ? String(body.email) : '').trim().toLowerCase();
            const password = body.password != null ? String(body.password) : '';
            const displayName = (body.displayName != null ? String(body.displayName) : '').trim();
            let validUntil = -1;
            if (body.validUntil !== undefined && body.validUntil !== null && body.validUntil !== '') {
                validUntil = Number(body.validUntil);
                if (Number.isNaN(validUntil)) validUntil = -1;
            }
            if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });
            if (!password || password.length < 6) return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });

            const userRecord = await auth.createUser({
                email, password, emailVerified: false, displayName: displayName || email,
            });
            const uid = userRecord.uid;
            await auth.setCustomUserClaims(uid, { validUntil, disabled: false });
            await setPanelUser(uid, { uid, email, displayName: displayName || email, validUntil, disabled: false, createdAt: Date.now() });
            return res.status(200).json({ success: true, message: 'Acesso criado.', uid });
        }

        // ===== PUT/PATCH: atualizar =====
        if (req.method === 'PUT' || req.method === 'PATCH') {
            const body = parseBody(req);
            const uid = (body.uid != null ? String(body.uid) : '').trim();
            if (!uid) return res.status(400).json({ error: 'uid obrigatório.' });

            const updates = {};
            if (body.displayName !== undefined) updates.displayName = String(body.displayName).trim() || null;
            if (body.password !== undefined && body.password !== '') {
                if (body.password.length < 6) return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres.' });
                updates.password = body.password;
            }
            if (Object.keys(updates).length > 0) {
                const current = await auth.getUser(uid).catch(() => null);
                if (!current) return res.status(404).json({ error: 'Usuário não encontrado.' });
                await auth.updateUser(uid, updates);
            }

            const existingDb = await getPanelUser(uid);
            const dbData = existingDb ? { ...existingDb } : { uid, email: '', displayName: '', validUntil: -1, disabled: false, createdAt: Date.now() };
            if (body.validUntil !== undefined) dbData.validUntil = body.validUntil === null || body.validUntil === '' ? -1 : Number(body.validUntil);
            if (body.disabled !== undefined) dbData.disabled = !!body.disabled;
            if (body.displayName !== undefined) dbData.displayName = String(body.displayName).trim() || dbData.email || '';
            await setPanelUser(uid, dbData);

            const userRecord = await auth.getUser(uid);
            const existingClaims = userRecord.customClaims || {};
            await auth.setCustomUserClaims(uid, { ...existingClaims, validUntil: dbData.validUntil == null ? -1 : dbData.validUntil, disabled: !!dbData.disabled });
            return res.status(200).json({ success: true, message: 'Usuário atualizado.' });
        }

        // ===== DELETE: remover =====
        if (req.method === 'DELETE') {
            const body = parseBody(req);
            const uid = (body.uid != null ? String(body.uid) : '').trim();
            if (!uid) return res.status(400).json({ error: 'uid obrigatório.' });
            await auth.deleteUser(uid);
            await removePanelUser(uid);
            return res.status(200).json({ success: true, message: 'Usuário removido.' });
        }

        return res.status(405).json({ error: 'Método não permitido.' });
    } catch (err) {
        console.error('[panelUsers] Erro:', err?.message || err);
        const code = err.code || '';
        if (code === 'auth/email-already-in-use' || code === 'auth/email-already-exists') {
            return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
        }
        if (code === 'auth/user-not-found') return res.status(404).json({ error: 'Usuário não encontrado.' });
        if (code === 'auth/invalid-email') return res.status(400).json({ error: 'E-mail inválido.' });
        return res.status(500).json({ error: 'Erro interno.' });
    }
};
