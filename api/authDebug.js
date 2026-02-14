/**
 * Diagnóstico de auth (só para debug). Retorna se env está ok, se token chegou e se a validação passou.
 * GET /api/authDebug — envia token em header ou ?access_token=...
 * Em produção: exige header X-Debug-Secret igual a AUTH_DEBUG_SECRET (configurar na Vercel).
 */
const { verifyWithJwks } = require('./_lib/verifyJwks');
const { verifyWithJwtSecret } = require('./_lib/verifyJwtSecret');

function json(res, status, data) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(status).end(JSON.stringify(data));
}

function allowDebug(req) {
    const secret = process.env.AUTH_DEBUG_SECRET;
    if (!secret) return false;
    const h = req.headers || {};
    const received = (h['x-debug-secret'] || h['X-Debug-Secret'] || '').trim();
    return received === secret;
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token, X-Debug-Secret');
        return res.status(204).end();
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido' });
    if (!allowDebug(req)) return json(res, 404, { error: 'Not Found' });

    const out = {
        envOk: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        supabaseUrlSet: !!process.env.SUPABASE_URL,
        serviceRoleKeySet: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        jwtSecretSet: !!(process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET),
        tokenReceived: false,
        verification: 'missing',
        verificationVia: null,
        userId: null,
        errorDetail: null
    };

    const h = req.headers || {};
    let token = (h.authorization || h.Authorization || h['x-auth-token'] || h['X-Auth-Token'] || '').trim();
    if (token.startsWith('Bearer ')) token = token.slice(7).trim();
    if (!token && req.query) {
        token = (req.query.access_token || req.query.token || '').trim();
    }
    if (!token) {
        return json(res, 200, out);
    }

    out.tokenReceived = true;
    out.verification = 'invalid';

    const byJwks = await verifyWithJwks(token);
    if (byJwks) {
        out.verification = 'ok';
        out.verificationVia = 'jwks';
        out.userId = byJwks.id;
        out.errorDetail = null;
        return json(res, 200, out);
    }
    const bySecret = verifyWithJwtSecret(token);
    if (bySecret) {
        out.verification = 'ok';
        out.verificationVia = 'SUPABASE_JWT_SECRET';
        out.userId = bySecret.id;
        out.errorDetail = null;
        return json(res, 200, out);
    }

    if (!out.envOk) {
        out.errorDetail = 'Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel. Para validar sem chamar o Auth, defina também SUPABASE_JWT_SECRET (Dashboard > API > JWT Secret).';
        return json(res, 200, out);
    }

    const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
        const authRes = await fetch(baseUrl + '/auth/v1/user', {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + token,
                'apikey': key,
                'Content-Type': 'application/json'
            }
        });
        const body = await authRes.json().catch(() => ({}));

        if (authRes.ok && body && body.id) {
            out.verification = 'ok';
            out.verificationVia = 'auth_server';
            out.userId = body.id;
            out.errorDetail = null;
            return json(res, 200, out);
        }

        out.errorDetail = body.msg || body.message || body.error_description || ('HTTP ' + authRes.status);
    } catch (err) {
        out.errorDetail = err.message || 'fetch_error';
    }

    out.errorDetail = (out.errorDetail || '') + (out.jwtSecretSet ? '' : ' — Adicione SUPABASE_JWT_SECRET na Vercel (Dashboard Supabase > Project Settings > API > JWT Secret) para validar o token localmente.');
    return json(res, 200, out);
};
