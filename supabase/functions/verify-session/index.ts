import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

const JWT_SECRET = Deno.env.get("JWT_SECRET") || Deno.env.get("SUPABASE_JWT_SECRET") || ""

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ valid: false, message: "Método não permitido" }, 405)
  }

  if (!JWT_SECRET) {
    console.error("[verify-session] JWT_SECRET não configurado")
    return jsonResponse({ valid: false, message: "Serviço não configurado." }, 503)
  }

  const auth = req.headers.get("Authorization") || ""
  if (!auth.startsWith("Bearer ")) {
    return jsonResponse({ valid: false, message: "Authorization Bearer é obrigatório." }, 401)
  }

  const sessionToken = auth.slice("Bearer ".length).trim()
  if (!sessionToken) {
    return jsonResponse({ valid: false, message: "sessionToken ausente." }, 401)
  }

  const payload = await verifyJwt(sessionToken, JWT_SECRET)
  if (!payload) {
    return jsonResponse({ valid: false, message: "Sessão inválida ou expirada." }, 401)
  }

  if (payload.refresh === true) {
    return jsonResponse({ valid: false, message: "Token de refresh não é aceito aqui." }, 401)
  }

  return jsonResponse({
    valid: true,
    message: "Sessão válida",
    licenseKey: payload.licenseKey,
    deviceFingerprint: payload.deviceFingerprint || "",
    expiresAt: payload.exp ? Number(payload.exp) * 1000 : null,
  })
})
