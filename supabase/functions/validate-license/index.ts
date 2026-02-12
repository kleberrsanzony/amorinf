/**
 * Edge Function: validate-license
 * Valida licença e cria sessão JWT.
 * Equivalente ao api/validateLicense.js
 */
import "@supabase/functions-js/edge-runtime.d.ts";
import { corsResponse, jsonResponse } from "../_shared/cors.ts";
import { createSession } from "../_shared/jwt.ts";
import { getLicense, updateLicense } from "../_shared/supabase.ts";

const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ valid: false, message: "Método não permitido." }, 405);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ valid: false, message: "Body JSON inválido." }, 400);
  }

  const licenseKey = ((body.licenseKey as string) || "").trim();
  const deviceFingerprint = ((body.deviceFingerprint as string) || "").trim();

  if (!licenseKey || !deviceFingerprint) {
    return jsonResponse(
      { valid: false, message: "licenseKey e deviceFingerprint obrigatórios." },
      400
    );
  }

  try {
    const license = await getLicense(licenseKey);

    if (!license) {
      return jsonResponse({ valid: false, message: "Licença não encontrada" });
    }
    if (!license.active) {
      return jsonResponse({ valid: false, message: "Licença inativa" });
    }

    // Verificar expiração
    if (!license.lifetime) {
      if (license.expiry_date) {
        const expiryDate = new Date(license.expiry_date);
        if (isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
          return jsonResponse({ valid: false, message: "Licença expirada" });
        }
      }
    }

    // Verificar limite de usos
    if (
      license.max_uses != null &&
      license.uses >= license.max_uses
    ) {
      return jsonResponse({
        valid: false,
        message: "Limite de usos atingido",
      });
    }

    // Verificar sessão ativa em outro dispositivo
    if (
      license.active_session_device &&
      license.active_session_device !== deviceFingerprint &&
      license.active_session_last_ping
    ) {
      const lastPing = new Date(license.active_session_last_ping).getTime();
      if (!isNaN(lastPing) && Date.now() - lastPing < SESSION_TIMEOUT_MS) {
        return jsonResponse({
          valid: false,
          message:
            "Esta licença está em uso em outro dispositivo no momento. Tente novamente mais tarde.",
        });
      }
    }

    // Verificar device binding
    if (
      license.activated_device_fingerprint &&
      license.activated_device_fingerprint !== deviceFingerprint
    ) {
      return jsonResponse({
        valid: false,
        message:
          "Esta licença já foi ativada em outro computador. Uma licença só pode ser usada em um dispositivo por vez.",
      });
    }

    const nowIso = new Date().toISOString();

    // Gerar JWT de sessão
    const jwtSession = await createSession({
      licenseKey,
      deviceFingerprint,
      userName: license.user_name || "",
    });

    // Construir userData para a extensão
    const userData: Record<string, unknown> = {};
    if (license.expiry_date) userData.expiryDate = license.expiry_date;
    if (license.lifetime) userData.lifetime = true;

    // Construir license object no formato que a extensão espera
    const licenseData: Record<string, unknown> = {
      key: license.key,
      active: license.active,
      lifetime: license.lifetime,
      expiryDate: license.expiry_date,
      userName: license.user_name,
      uses: license.uses,
      maxUses: license.max_uses,
    };

    if (license.activated_device_fingerprint === deviceFingerprint) {
      // Já ativado neste dispositivo - atualizar sessão
      await updateLicense(licenseKey, {
        active_session_device: deviceFingerprint,
        active_session_last_ping: nowIso,
        last_access_date: nowIso,
      });

      return jsonResponse({
        valid: true,
        message: "Licença ativada neste dispositivo. Acesso permanente.",
        sessionToken: jwtSession.sessionToken,
        refreshToken: jwtSession.refreshToken,
        expiresAt: jwtSession.expiresAt,
        license: licenseData,
        userData,
      });
    }

    // Primeira ativação - vincular dispositivo
    const newUses = (license.uses || 0) + 1;
    await updateLicense(licenseKey, {
      activated_device_fingerprint: deviceFingerprint,
      activated_date: nowIso,
      uses: newUses,
      last_access_date: nowIso,
      active_session_device: deviceFingerprint,
      active_session_last_ping: nowIso,
      activated: true,
    });

    return jsonResponse({
      valid: true,
      message: "Licença ativada e vinculada a este dispositivo!",
      sessionToken: jwtSession.sessionToken,
      refreshToken: jwtSession.refreshToken,
      expiresAt: jwtSession.expiresAt,
      license: { ...licenseData, uses: newUses, activated: true },
      userData,
    });
  } catch (err) {
    console.error("[validate-license] Erro:", (err as Error).message);
    return jsonResponse(
      { valid: false, message: "Erro ao validar licença." },
      500
    );
  }
});
