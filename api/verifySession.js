/**
 * POST /api/verifySession — Verifica sessão JWT + licença no Firebase RTDB
 * Lógica de sessão única (sem vínculo de dispositivo)
 */
const { getLicense, updateLicense } = require('./_lib/firebaseAdmin');
const { requireSession } = require('./_lib/sessionManager');

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

  // 1. Verificar JWT
  const auth = requireSession(req);
  if (!auth.ok) return json(res, auth.status, { valid: false, message: auth.message });

  const { session } = auth;

  try {
    // 2. Verificar licença no Firebase RTDB
    const license = await getLicense(session.licenseKey);

    if (!license) return json(res, 200, { valid: false, message: 'Licença não encontrada.' });
    if (!license.active) return json(res, 200, { valid: false, message: 'Licença desativada.' });

    // Verificar expiração
    if (!license.lifetime && license.expiryDate) {
      const expiryDate = new Date(license.expiryDate);
      if (isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
        return json(res, 200, { valid: false, message: 'Licença expirada.' });
      }
    }

    // Uma sessão por vez: verificar se esta sessão ainda é a ativa
    if (
      license.activeSessionDevice &&
      license.activeSessionDevice !== session.deviceFingerprint
    ) {
      return json(res, 200, {
        valid: false,
        message: 'Outra sessão está ativa com esta licença. Faça login novamente.',
      });
    }

    // 3. Atualizar ping da sessão ativa
    const nowIso = new Date().toISOString();
    await updateLicense(session.licenseKey, {
      activeSessionDevice: session.deviceFingerprint,
      activeSessionLastPing: nowIso,
    });

    // 4. Retornar sessão válida
    return json(res, 200, {
      valid: true,
      message: 'Sessão válida.',
      session: {
        licenseKey: session.licenseKey,
        expiresAt: session.expiresAt * 1000,
        protocolVersion: session.protocolVersion,
      },
      license: {
        expiryDate: license.expiryDate || null,
        lifetime: license.lifetime,
        userName: license.userName || '',
      },
    });
  } catch (err) {
    console.error('[verifySession] Erro:', err.message || err);
    return json(res, 500, { valid: false, message: 'Erro ao verificar sessão.' });
  }
};
