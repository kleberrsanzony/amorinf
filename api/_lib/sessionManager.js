/**
 * Session Manager - Sistema de sessões JWT seguro
 * Gera tokens JWT assinados pelo servidor.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const SESSION_PROTOCOL_VERSION = 1;
const TOKEN_TTL = '24h';
const REFRESH_TTL = '7d';

function createSession(payload) {
  const sessionPayload = {
    lk: payload.licenseKey,
    df: payload.deviceFingerprint,
    un: payload.userName || '',
    pv: SESSION_PROTOCOL_VERSION,
    sid: crypto.randomBytes(16).toString('hex'),
    type: 'session'
  };

  const refreshPayload = {
    lk: payload.licenseKey,
    df: payload.deviceFingerprint,
    pv: SESSION_PROTOCOL_VERSION,
    sid: sessionPayload.sid,
    type: 'refresh'
  };

  const sessionToken = jwt.sign(sessionPayload, JWT_SECRET, { expiresIn: TOKEN_TTL });
  const refreshToken = jwt.sign(refreshPayload, JWT_SECRET, { expiresIn: REFRESH_TTL });
  const decoded = jwt.decode(sessionToken);

  return {
    sessionToken,
    refreshToken,
    expiresAt: decoded.exp * 1000,
    sessionId: sessionPayload.sid
  };
}

function verifySession(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.pv !== SESSION_PROTOCOL_VERSION) return null;
    if (decoded.type !== 'session') return null;
    return {
      licenseKey: decoded.lk,
      deviceFingerprint: decoded.df,
      userName: decoded.un,
      sessionId: decoded.sid,
      protocolVersion: decoded.pv,
      issuedAt: decoded.iat,
      expiresAt: decoded.exp
    };
  } catch (err) {
    return null;
  }
}

function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.pv !== SESSION_PROTOCOL_VERSION) return null;
    if (decoded.type !== 'refresh') return null;
    return {
      licenseKey: decoded.lk,
      deviceFingerprint: decoded.df,
      sessionId: decoded.sid,
      protocolVersion: decoded.pv,
      issuedAt: decoded.iat,
      expiresAt: decoded.exp
    };
  } catch (err) {
    return null;
  }
}

function extractSessionToken(req) {
  const authHeader = (req.headers.authorization || req.headers.Authorization || '').trim();
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return null;
}

function requireSession(req) {
  const token = extractSessionToken(req);
  if (!token) return { ok: false, status: 401, message: 'Token de sessão ausente. Faça login novamente.' };
  const session = verifySession(token);
  if (!session) return { ok: false, status: 401, message: 'Sessão expirada ou inválida. Faça login novamente.' };
  return { ok: true, session };
}

module.exports = {
  createSession,
  verifySession,
  verifyRefreshToken,
  extractSessionToken,
  requireSession,
  SESSION_PROTOCOL_VERSION,
  JWT_SECRET
};
