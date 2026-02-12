/**
 * Edge Function: refresh-session
 * Renova o token de sessão usando o refresh token.
 * Equivalente ao api/refreshSession.js
 */
import "@supabase/functions-js/edge-runtime.d.ts";
import { corsResponse, jsonResponse } from "../_shared/cors.ts";
import { verifyRefreshToken, createSession } from "../_shared/jwt.ts";
import { getLicense } from "../_shared/supabase.ts";

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

  const refreshToken = ((body.refreshToken as string) || "").trim();
  const deviceFingerprint = ((body.deviceFingerprint as string) || "").trim();

  if (!refreshToken) {
    return jsonResponse(
      { valid: false, message: "refreshToken obrigatório." },
      400
    );
  }

  // 1. Verificar refresh token
  const decoded = await verifyRefreshToken(refreshToken);
  if (!decoded) {
    return jsonResponse(
      {
        valid: false,
        message: "Refresh token expirado ou inválido. Faça login novamente.",
      },
      401
    );
  }

  // 2. Verificar device fingerprint
  if (deviceFingerprint && decoded.deviceFingerprint !== deviceFingerprint) {
    return jsonResponse(
      {
        valid: false,
        message: "Dispositivo não corresponde. Faça login novamente.",
      },
      401
    );
  }

  try {
    // 3. Verificar se a licença ainda é válida
    const license = await getLicense(decoded.licenseKey);

    if (!license || !license.active) {
      return jsonResponse({
        valid: false,
        message: "Licença inativa ou não encontrada.",
      });
    }

    if (!license.lifetime && license.expiry_date) {
      const expiryDate = new Date(license.expiry_date);
      if (isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
        return jsonResponse({ valid: false, message: "Licença expirada." });
      }
    }

    // 4. Gerar nova sessão
    const newSession = await createSession({
      licenseKey: decoded.licenseKey,
      deviceFingerprint: decoded.deviceFingerprint,
      userName: license.user_name || "",
    });

    return jsonResponse({
      valid: true,
      message: "Sessão renovada.",
      sessionToken: newSession.sessionToken,
      refreshToken: newSession.refreshToken,
      expiresAt: newSession.expiresAt,
    });
  } catch (err) {
    console.error("[refresh-session] Erro:", (err as Error).message);
    return jsonResponse(
      { valid: false, message: "Erro ao renovar sessão." },
      500
    );
  }
});
