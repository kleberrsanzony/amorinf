/**
 * /api/licenses — CRUD de licenças no Firebase RTDB
 * POST = criar | GET = listar/buscar | PUT = atualizar | DELETE = remover
 */
const { verifyToken, getDatabase, parseBody } = require('./_lib/firebaseAdmin');

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res, status, data) {
    res.setHeader('Content-Type', 'application/json');
    cors(res);
    res.status(status).end(JSON.stringify(data));
}

function toLicense(row) {
    return {
        key: row.key, userName: row.userName || '', userPhone: row.userPhone || '',
        created: row.created, expiryDate: row.expiryDate, lifetime: row.lifetime,
        active: row.active, activated: row.activated, activatedDate: row.activatedDate,
        maxUses: row.maxUses, uses: row.uses, ownerId: row.ownerId || '',
        activatedDevices: row.activatedDevices || [],
    };
}

module.exports = async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();

    const user = await verifyToken(req);
    if (!user) return json(res, 401, { error: 'Não autorizado.' });

    const db = getDatabase();
    if (!db) return json(res, 503, { error: 'Serviço indisponível' });

    const q = req.query || {};

    try {
        // ===== GET: listar ou buscar por key =====
        if (req.method === 'GET') {
            const key = (q.key || '').trim();
            if (key) {
                const snap = await db.ref('licenses').child(key).once('value');
                const row = snap.val();
                if (!row) return json(res, 404, { error: 'Licença não encontrada' });
                return json(res, 200, { license: toLicense(row) });
            }
            // Listar
            const ownerId = q.ownerId || q.owner_id || null;
            const snap = await db.ref('licenses').once('value');
            const val = snap.val();
            if (!val || typeof val !== 'object') return json(res, 200, { licenses: [] });
            let licenses = Object.values(val).filter(l => l && l.key);
            if (ownerId) licenses = licenses.filter(l => l.ownerId === ownerId);
            licenses.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
            return json(res, 200, { licenses: licenses.map(toLicense) });
        }

        // ===== POST: criar =====
        if (req.method === 'POST') {
            const body = parseBody(req);
            const key = (body.key || '').trim();
            if (!key) return json(res, 400, { error: 'key obrigatória' });

            const existing = await db.ref('licenses').child(key).once('value');
            if (existing.val()) return json(res, 409, { error: 'Licença já existe' });

            const data = {
                key, userName: body.userName || '', userPhone: body.userPhone || '',
                created: new Date().toISOString(), expiryDate: body.expiryDate || null,
                lifetime: body.lifetime === true, active: body.active !== false,
                activated: false, activatedDate: null, maxUses: body.maxUses || null,
                uses: body.uses || 0, activatedDevices: [], ownerId: body.ownerId || user.id || '',
                timestamp: new Date().toISOString()
            };
            await db.ref('licenses').child(key).set(data);
            return json(res, 200, { success: true, license: data });
        }

        // ===== PUT: atualizar =====
        if (req.method === 'PUT') {
            const body = parseBody(req);
            const key = (body.key || '').trim();
            if (!key) return json(res, 400, { error: 'key obrigatória' });

            const snap = await db.ref('licenses').child(key).once('value');
            if (!snap.val()) return json(res, 404, { error: 'Licença não encontrada' });

            const updates = {};
            if (body.userName !== undefined) updates.userName = body.userName;
            if (body.userPhone !== undefined) updates.userPhone = body.userPhone;
            if (body.active !== undefined) updates.active = body.active;
            if (body.lifetime !== undefined) updates.lifetime = body.lifetime;
            if (body.expiryDate !== undefined) updates.expiryDate = body.expiryDate;
            if (body.maxUses !== undefined) updates.maxUses = body.maxUses;
            if (body.uses !== undefined) updates.uses = body.uses;
            updates.timestamp = new Date().toISOString();
            await db.ref('licenses').child(key).update(updates);
            return json(res, 200, { success: true });
        }

        // ===== DELETE: remover =====
        if (req.method === 'DELETE') {
            const key = (q.key || '').trim();
            if (!key) return json(res, 400, { error: 'key obrigatória' });
            await db.ref('licenses').child(key).remove();
            return json(res, 200, { success: true });
        }

        return json(res, 405, { error: 'Método não permitido' });
    } catch (err) {
        console.error('[licenses]', err);
        return json(res, 500, { error: 'Erro interno' });
    }
};
