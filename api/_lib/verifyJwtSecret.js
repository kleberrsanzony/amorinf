/**
 * Verifica JWT do Supabase com o JWT Secret do projeto (Dashboard > API > JWT Secret).
 * Assim a validação não depende da chamada ao Auth server e usa exatamente o mesmo secret que assina o token.
 */
const jwt = require('jsonwebtoken');

function verifyWithJwtSecret(token) {
    const secret = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET;
    if (!secret || !token) return null;
    const url = process.env.SUPABASE_URL || '';
    const expectedIssuer = url.replace(/\/$/, '') + '/auth/v1';
    try {
        const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
        if (decoded.iss && decoded.iss !== expectedIssuer) return null;
        if (!decoded.sub) return null;
        return { id: decoded.sub, email: decoded.email || null };
    } catch (e) {
        return null;
    }
}

module.exports = { verifyWithJwtSecret };
