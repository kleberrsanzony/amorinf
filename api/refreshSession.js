/**
 * POST /api/refreshSession — Renova token de sessão via refresh token
 * Firebase RTDB — campos camelCase
 */
const { getLicense } = require('./_lib/firebaseAdmin');
const { verifyRefreshToken, createSession, parseBody } = require('./_lib/sessionManager');
const { parseBody: fbParseBody } = require('./_lib/firebaseAdmin');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json');
  cors(res);
  res.status(status).end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { valid: false, message: 'Método não permitido.' });

  const body = fbParseBody(req);
  const refreshToken = (body.refreshToken || '').trim();
  const deviceFingerprint = (body.deviceFingerprint || '').trim();

  if (!refreshToken) {
    return json(res, 400, { valid: false, message: 'refreshToken obrigatório.' });
  }

  // 1. Verificar refresh token
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    return json(res, 401, { valid: false, message: 'Refresh token expirado ou inválido. Faça login novamente.' });
  }

  try {
    // 2. Verificar licença
    const license = await getLicense(decoded.licenseKey);

    if (!license || !license.active) {
      return json(res, 200, { valid: false, message: 'Licença inativa ou não encontrada.' });
    }

    if (!license.lifetime && license.expiryDate) {
      const expiryDate = new Date(license.expiryDate);
      if (isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
        return json(res, 200, { valid: false, message: 'Licença expirada.' });
      }
    }

    // Uma sessão por vez: só renovar se esta sessão ainda é a ativa
    if (
      license.activeSessionDevice &&
      license.activeSessionDevice !== decoded.deviceFingerprint
    ) {
      return json(res, 401, {
        valid: false,
        message: 'Outra sessão está ativa com esta licença. Faça login novamente.',
      });
    }

    // 3. Gerar nova sessão
    const newSession = createSession({
      licenseKey: decoded.licenseKey,
      deviceFingerprint: decoded.deviceFingerprint,
      userName: license.userName || '',
    });

    return json(res, 200, {
      valid: true,
      message: 'Sessão renovada.',
      sessionToken: newSession.sessionToken,
      refreshToken: newSession.refreshToken,
      expiresAt: newSession.expiresAt,
    });
  } catch (err) {
    console.error('[refreshSession] Erro:', err.message || err);
    return json(res, 500, { valid: false, message: 'Erro ao renovar sessão.' });
  }
};
