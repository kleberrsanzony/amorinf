/**
 * Verifica token de autenticação Supabase Auth.
 * 1) JWKS (ES256/RS256) — projeto usa chave assimétrica; valida com .well-known/jwks.json.
 * 2) JWT Secret (HS256) — fallback para projetos legados.
 * 3) getUser + GET /auth/v1/user.
 */
const { getSupabase } = require('./supabaseClient');
const { verifyWithJwks } = require('./verifyJwks');
const { verifyWithJwtSecret } = require('./verifyJwtSecret');

async function verifyViaAuthServer(token) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    const base = url.replace(/\/$/, '');
    const res = await fetch(base + '/auth/v1/user', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token, 'apikey': key, 'Content-Type': 'application/json' }
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || !body.id) return null;
    return { id: body.id, email: body.email || null };
}

async function verifyToken(req) {
    try {
        const h = req.headers || {};
        let authHeader = h.authorization || h.Authorization || h['x-auth-token'] || h['X-Auth-Token'] || '';
        if (!authHeader.startsWith('Bearer ')) {
            if (authHeader) authHeader = 'Bearer ' + authHeader.trim();
            else authHeader = '';
        }
        let token = null;
        if (authHeader) token = authHeader.slice(7).trim();
        if (!token && req.method === 'GET' && req.query) {
            const q = req.query;
            token = (q.token || q.access_token || '').trim();
        }
        if (!token) return null;

        try {
            const byJwks = await verifyWithJwks(token);
            if (byJwks) return byJwks;
        } catch (e) {
            console.error('[verifyToken] JWKS:', e.message);
        }
        const bySecret = verifyWithJwtSecret(token);
        if (bySecret) return bySecret;

        try {
            const supabase = getSupabase();
            const { data, error } = await supabase.auth.getUser(token);
            if (!error && data && data.user) return { id: data.user.id, email: data.user.email || null };
            const fallback = await verifyViaAuthServer(token);
            if (fallback) return fallback;
            return null;
        } catch (err) {
            console.error('[verifyToken] fallback:', err.message);
            try {
                const fallback = await verifyViaAuthServer(token);
                if (fallback) return fallback;
            } catch (e) {}
            return null;
        }
    } catch (outer) {
        console.error('[verifyToken] outer:', outer.message);
        return null;
    }
}

module.exports = { verifyToken };
