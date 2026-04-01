import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

const JWT_SECRET = Deno.env.get("JWT_SECRET") || Deno.env.get("SUPABASE_JWT_SECRET") || ""
const SESSION_EXPIRY_SEC = 24 * 60 * 60
const REFRESH_EXPIRY_SEC = 7 * 24 * 60 * 60

function b64UrlEncode(data: Uint8Array | string): string {
  const str = typeof data === "string" ? data : new TextDecoder().decode(data)
  const bin = typeof data === "string" ? new TextEncoder().encode(str) : data
  const base64 = btoa(String.fromCharCode(...bin))
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function signJwt(payload: Record<string, unknown>, secret: string, expSeconds: number): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = { ...payload, iat: now, exp: now + expSeconds }

  const encoder = new TextEncoder()
  const headerB64 = b64UrlEncode(JSON.stringify(header))
  const payloadB64 = b64UrlEncode(JSON.stringify(fullPayload))
  const message = `${headerB64}.${payloadB64}`

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message))
  const sigB64 = b64UrlEncode(new Uint8Array(signature))
  return `${message}.${sigB64}`
}

async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts
    const encoder = new TextEncoder()

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    )

    const data = encoder.encode(`${headerB64}.${payloadB64}`)
    const signature = Uint8Array.from(
      atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    )

    const valid = await crypto.subtle.verify("HMAC", key, signature, data)
    if (!valid) return null

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")))

    if (payload.exp && payload.exp * 1000 < Date.now()) return null

    return payload
  } catch (_) {
    return null
  }
}

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ valid: false, message: "Método não permitido" }, 405)
  }

  if (!JWT_SECRET) {
    console.error("[refresh-session] JWT_SECRET não configurado")
    return jsonResponse({ valid: false, message: "Serviço não configurado." }, 503)
  }

  try {
    const body = await req.json()
    const refreshToken = (body.refreshToken || "").trim()
    const deviceFingerprint = (body.deviceFingerprint || "").trim()

    if (!refreshToken) {
      return jsonResponse({ valid: false, message: "refreshToken é obrigatório." }, 400)
    }

    const payload = await verifyJwt(refreshToken, JWT_SECRET)
    if (!payload || payload.refresh !== true) {
      return jsonResponse({ valid: false, message: "Refresh token inválido ou expirado." }, 401)
    }

    if (deviceFingerprint && payload.deviceFingerprint && payload.deviceFingerprint !== deviceFingerprint) {
      return jsonResponse({ valid: false, message: "Dispositivo não autorizado para este refresh token." }, 403)
    }

    if (!payload.licenseKey || typeof payload.licenseKey !== "string") {
      return jsonResponse({ valid: false, message: "Refresh token sem licença válida." }, 401)
    }

    const sessionPayload = {
      licenseKey: payload.licenseKey,
      deviceFingerprint: (payload.deviceFingerprint as string) || deviceFingerprint,
    }

    const newSessionToken = await signJwt(sessionPayload, JWT_SECRET, SESSION_EXPIRY_SEC)
    const newRefreshToken = await signJwt({ ...sessionPayload, refresh: true }, JWT_SECRET, REFRESH_EXPIRY_SEC)
    const expiresAt = Date.now() + SESSION_EXPIRY_SEC * 1000

    return jsonResponse({
      valid: true,
      sessionToken: newSessionToken,
      refreshToken: newRefreshToken,
      expiresAt,
    })
  } catch (e) {
    console.error("[refresh-session] Erro:", e)
    return jsonResponse({ valid: false, message: `Erro interno: ${(e as Error).message}` }, 500)
  }
})
