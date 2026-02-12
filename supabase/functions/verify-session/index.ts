/**
 * Edge Function: verify-session
 * Verifica se a sessão JWT é válida e atualiza lastPing.
 * Equivalente ao api/verifySession.js
 */
import "@supabase/functions-js/edge-runtime.d.ts";
import { corsResponse, jsonResponse } from "../_shared/cors.ts";
import { requireSession } from "../_shared/jwt.ts";
import { getLicense, updateLicense } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ valid: false, message: "Método não permitido." }, 405);
  }

  // 1. Verificar JWT
  const auth = await requireSession(req);
  if (!auth.ok) {
    return jsonResponse({ valid: false, message: auth.message }, auth.status);
  }

  const { session } = auth;

  try {
    // 2. Verificar se a licença ainda é válida no Postgres
    const license = await getLicense(session.licenseKey);

    if (!license) {
      return jsonResponse({ valid: false, message: "Licença não encontrada." });
    }
    if (!license.active) {
      return jsonResponse({ valid: false, message: "Licença desativada." });
    }

    // Verificar expiração
    if (!license.lifetime && license.expiry_date) {
      const expiryDate = new Date(license.expiry_date);
      if (isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
        return jsonResponse({ valid: false, message: "Licença expirada." });
      }
    }

    // Verificar device fingerprint
    if (
      license.activated_device_fingerprint &&
      license.activated_device_fingerprint !== session.deviceFingerprint
    ) {
      return jsonResponse({
        valid: false,
        message: "Dispositivo não autorizado.",
      });
    }

    // 3. Atualizar ping da sessão ativa
    const nowIso = new Date().toISOString();
    await updateLicense(session.licenseKey, {
      active_session_device: session.deviceFingerprint,
      active_session_last_ping: nowIso,
    });

    // 4. Retornar sessão válida
    return jsonResponse({
      valid: true,
      message: "Sessão válida.",
      session: {
        licenseKey: session.licenseKey,
        expiresAt: session.expiresAt * 1000,
        protocolVersion: session.protocolVersion,
      },
      license: {
        expiryDate: license.expiry_date || null,
        lifetime: license.lifetime,
        userName: license.user_name || "",
      },
    });
  } catch (err) {
    console.error("[verify-session] Erro:", (err as Error).message);
    return jsonResponse(
      { valid: false, message: "Erro ao verificar sessão." },
      500
    );
  }
});
