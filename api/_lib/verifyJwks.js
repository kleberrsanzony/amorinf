/**
 * Verifica JWT do Supabase usando a chave pública do projeto (JWKS).
 * O projeto svjglgrxqxqtonoobcdi usa ES256; o JWT Secret (HS256) não funciona.
 */
const { jwtVerify, createRemoteJWKSet } = require('jose');

let jwksCache = null;

function getJwks() {
    if (jwksCache) return jwksCache;
    try {
        const url = process.env.SUPABASE_URL || '';
        if (!url) return null;
        const base = url.replace(/\/$/, '');
        const jwksUrl = base + '/auth/v1/.well-known/jwks.json';
        jwksCache = createRemoteJWKSet(new URL(jwksUrl));
        return jwksCache;
    } catch (e) {
        return null;
    }
}

async function verifyWithJwks(token) {
    const jwks = getJwks();
    if (!jwks || !token) return null;
    const url = process.env.SUPABASE_URL || '';
    const expectedIssuer = url.replace(/\/$/, '') + '/auth/v1';
    try {
        const { payload } = await jwtVerify(token, jwks, {
            issuer: expectedIssuer,
            algorithms: ['ES256', 'RS256']
        });
        if (!payload.sub) return null;
        return { id: payload.sub, email: payload.email || null };
    } catch (e) {
        return null;
    }
}

module.exports = { verifyWithJwks };
