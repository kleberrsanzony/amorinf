// Supabase Edge Function: validate-license
// Valida a licença do cliente e emite JWT de sessão (sessionToken).
// O send-prompt exige Authorization: Bearer <sessionToken> e extrai licenseKey do payload do JWT.
//
// POST body: { licenseKey, deviceFingerprint }
// Retorna: { valid, message?, sessionToken?, refreshToken?, expiresAt? }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const JWT_SECRET = Deno.env.get("JWT_SECRET") || Deno.env.get("SUPABASE_JWT_SECRET") || "";

// Sessão: 24h; refresh: 7 dias
const SESSION_EXPIRY_SEC = 24 * 60 * 60;
const REFRESH_EXPIRY_SEC = 7 * 24 * 60 * 60;

function b64UrlEncode(data: Uint8Array | string): string {
    const str = typeof data === "string" ? data : new TextDecoder().decode(data);
    const bin = typeof data === "string" ? new TextEncoder().encode(str) : data;
    let base64 = btoa(String.fromCharCode(...bin));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Gera JWT HMAC-SHA256 com payload dado e expiração em segundos */
async function signJwt(
    payload: Record<string, unknown>,
    secret: string,
    expSeconds: number
): Promise<string> {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = { ...payload, iat: now, exp: now + expSeconds };

    const encoder = new TextEncoder();
    const headerB64 = b64UrlEncode(JSON.stringify(header));
    const payloadB64 = b64UrlEncode(JSON.stringify(fullPayload));
    const message = `${headerB64}.${payloadB64}`;

    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
        "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const signature = await crypto.subtle.sign(
        "HMAC", key, encoder.encode(message)
    );
    const sigB64 = b64UrlEncode(new Uint8Array(signature));
    return `${message}.${sigB64}`;
}

function jsonResponse(data: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

interface LicenseRow {
    key: string;
    active: boolean;
    activated: boolean;
    expiry_date: string | null;
    lifetime: boolean;
    max_uses: number | null;
    uses: number;
}

async function validateLicense(
    supabase: ReturnType<typeof createClient>,
    licenseKey: string
): Promise<{ valid: boolean; license?: LicenseRow; error?: string }> {
    const { data: license, error } = await supabase
        .from("licenses")
        .select("key, active, activated, expiry_date, lifetime, max_uses, uses")
        .eq("key", licenseKey)
        .single();

    if (error || !license) {
        return { valid: false, error: "Licença não encontrada" };
    }
    if (!license.active) {
        return { valid: false, error: "Licença desativada" };
    }
    if (!license.lifetime && license.expiry_date) {
        if (new Date(license.expiry_date) < new Date()) {
            return { valid: false, error: "Licença expirada" };
        }
    }
    if (license.max_uses != null && license.max_uses > 0 && license.uses >= license.max_uses) {
        return { valid: false, error: "Limite de usos atingido" };
    }
    return { valid: true, license: license as LicenseRow };
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== "POST") {
        return jsonResponse({ valid: false, message: "Método não permitido" }, 405);
    }

    if (!JWT_SECRET) {
        console.error("[validate-license] JWT_SECRET não configurado");
        return jsonResponse({ valid: false, message: "Serviço não configurado." }, 503);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        const body = await req.json();
        const licenseKey = (body.licenseKey || body.license_key || "").trim();
        const deviceFingerprint = body.deviceFingerprint || body.device_fingerprint || "";

        if (!licenseKey) {
            return jsonResponse({ valid: false, message: "Chave de licença é obrigatória." }, 400);
        }

        const check = await validateLicense(supabase, licenseKey);
        if (!check.valid) {
            return jsonResponse({
                valid: false,
                message: check.error || "Licença inválida",
            }, 403);
        }

        // Atualizar last_access e sessão ativa (colunas opcionais conforme migrations)
        try {
            const updates: Record<string, unknown> = {
                last_access_date: new Date().toISOString(),
                active_session_last_ping: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            if (deviceFingerprint) updates.active_session_device = deviceFingerprint;
            if (deviceFingerprint) updates.activated_device_fingerprint = deviceFingerprint;
            await supabase.from("licenses").update(updates).eq("key", licenseKey);
        } catch (_) {
            // Colunas podem não existir em todas as migrations
        }

        // Emitir JWT com licenseKey no payload (exatamente o que send-prompt espera)
        const sessionPayload = {
            licenseKey: licenseKey,
            deviceFingerprint: deviceFingerprint || "",
        };
        const sessionToken = await signJwt(sessionPayload, JWT_SECRET, SESSION_EXPIRY_SEC);
        const refreshToken = await signJwt(
            { ...sessionPayload, refresh: true },
            JWT_SECRET,
            REFRESH_EXPIRY_SEC
        );
        const expiresAt = Date.now() + SESSION_EXPIRY_SEC * 1000;

        const license = check.license;
        const licensePayload = license ? {
            expiryDate: license.expiry_date ?? undefined,
            lifetime: license.lifetime === true,
        } : undefined;

        return jsonResponse({
            valid: true,
            message: "Licença válida",
            sessionToken,
            refreshToken,
            expiresAt,
            ...(licensePayload && { license: licensePayload }),
        });
    } catch (e) {
        console.error("[validate-license] Erro:", e);
        return jsonResponse({
            valid: false,
            message: `Erro interno: ${(e as Error).message}`,
        }, 500);
    }
});
