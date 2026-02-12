/**
 * POST /api/validateLicense — Valida licença e cria sessão JWT
 * Firebase RTDB — campos camelCase
 * Lógica de sessão única (sem vínculo de dispositivo)
 */
const { getLicense, updateLicense, parseBody } = require('./_lib/firebaseAdmin');
const { createSession } = require('./_lib/sessionManager');

const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos

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

  const body = parseBody(req);
  const licenseKey = (body.licenseKey || '').trim();
  const deviceFingerprint = (body.deviceFingerprint || '').trim();

  if (!licenseKey || !deviceFingerprint) {
    return json(res, 400, { valid: false, message: 'licenseKey e deviceFingerprint obrigatórios.' });
  }

  try {
    const license = await getLicense(licenseKey);

    if (!license) return json(res, 200, { valid: false, message: 'Licença não encontrada' });
    if (!license.active) return json(res, 200, { valid: false, message: 'Licença inativa' });

    // Verificar expiração
    if (!license.lifetime) {
      if (license.expiryDate) {
        const expiryDate = new Date(license.expiryDate);
        if (isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
          return json(res, 200, { valid: false, message: 'Licença expirada' });
        }
      }
    }

    // Verificar limite de usos
    if (license.maxUses != null && license.uses >= license.maxUses) {
      return json(res, 200, { valid: false, message: 'Limite de usos atingido' });
    }

    // Uma sessão por vez: se já existe sessão ativa em outro device, bloquear
    if (
      license.activeSessionDevice &&
      license.activeSessionDevice !== deviceFingerprint &&
      license.activeSessionLastPing
    ) {
      const lastPing = new Date(license.activeSessionLastPing).getTime();
      if (!isNaN(lastPing) && Date.now() - lastPing < SESSION_TIMEOUT_MS) {
        return json(res, 200, {
          valid: false,
          message: 'Esta licença já está em uso em outra sessão. Faça logout no outro lugar ou espere a sessão expirar.',
        });
      }
    }

    const nowIso = new Date().toISOString();

    // Gerar JWT de sessão
    const jwtSession = createSession({
      licenseKey,
      deviceFingerprint,
      userName: license.userName || '',
    });

    // Construir userData para a extensão
    const userData = {};
    if (license.expiryDate) userData.expiryDate = license.expiryDate;
    if (license.lifetime) userData.lifetime = true;

    // Construir license object no formato que a extensão espera
    const licenseData = {
      key: license.key,
      active: license.active,
      lifetime: license.lifetime,
      expiryDate: license.expiryDate,
      userName: license.userName,
      uses: license.uses,
      maxUses: license.maxUses,
    };

    // Registrar sessão ativa
    const isFirstUse = !license.activatedDate;
    const newUses = isFirstUse ? (license.uses || 0) + 1 : (license.uses || 0);
    await updateLicense(licenseKey, {
      activeSessionDevice: deviceFingerprint,
      activeSessionLastPing: nowIso,
      lastAccessDate: nowIso,
      ...(isFirstUse && {
        activatedDate: nowIso,
        uses: newUses,
        activated: true,
      }),
    });

    return json(res, 200, {
      valid: true,
      message: isFirstUse ? 'Licença ativada. Apenas uma sessão pode estar ativa por vez.' : 'Login realizado. Sessão ativa atualizada.',
      sessionToken: jwtSession.sessionToken,
      refreshToken: jwtSession.refreshToken,
      expiresAt: jwtSession.expiresAt,
      license: { ...licenseData, ...(isFirstUse && { uses: newUses, activated: true }) },
      userData,
    });
  } catch (err) {
    console.error('[validateLicense] Erro:', err.message || err);
    return json(res, 500, { valid: false, message: 'Erro ao validar licença.' });
  }
};
