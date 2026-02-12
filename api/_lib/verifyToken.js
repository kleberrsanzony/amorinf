/**
 * Verifica token de autenticação Supabase Auth.
 * O painel admin usa Supabase Auth; o token JWT é enviado no header Authorization.
 * Retorna { id, email } ou null se inválido.
 */
const { getSupabase } = require('./supabaseClient');

async function verifyToken(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    try {
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data || !data.user) return null;
        return { id: data.user.id, email: data.user.email || null };
    } catch (err) {
        console.error('[verifyToken] Erro:', err.message);
        return null;
    }
}

module.exports = { verifyToken };
