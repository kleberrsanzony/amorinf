/**
 * Session Manager - JWT para Supabase Edge Functions (Deno runtime)
 * Equivalente ao sessionManager.js do Vercel, usando Web Crypto API nativa.
 */

// Versão do protocolo de sessão - incrementar invalida TODAS as sessões
const SESSION_PROTOCOL_VERSION = 1;

// Tempo de vida dos tokens (em segundos)
const SESSION_TTL = 24 * 60 * 60; // 24 horas
const REFRESH_TTL = 7 * 24 * 60 * 60; // 7 dias

function getJwtSecret(): string {
  const secret = Deno.env.get("JWT_SECRET");
  if (!secret) throw new Error("JWT_SECRET não configurado");
  return secret;
}

// ============================================
// Funções utilitárias de JWT usando Web Crypto
// ============================================

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getSigningKey(): Promise<CryptoKey> {
  const secret = getJwtSecret();
  const encoder = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signJwt(
  payload: Record<string, unknown>,
  ttlSeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };

  const header = { alg: "HS256", typ: "JWT" };
  const encoder = new TextEncoder();

  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(
    encoder.encode(JSON.stringify(fullPayload))
  );

  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await getSigningKey();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signingInput)
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${signatureB64}`;
}

async function verifyJwt(
  token: string
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;

    const key = await getSigningKey();
    const encoder = new TextEncoder();
    const signature = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(signingInput)
    );

    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64))
    );

    // Verificar expiração
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

// ============================================
// Funções de Sessão (API pública)
// ============================================

interface CreateSessionInput {
  licenseKey: string;
  deviceFingerprint: string;
  userName?: string;
}

interface SessionResult {
  sessionToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionId: string;
}

export async function createSession(
  input: CreateSessionInput
): Promise<SessionResult> {
  // Gerar session ID aleatório
  const sidBytes = new Uint8Array(16);
  crypto.getRandomValues(sidBytes);
  const sid = Array.from(sidBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const sessionPayload = {
    lk: input.licenseKey,
    df: input.deviceFingerprint,
    un: input.userName || "",
    pv: SESSION_PROTOCOL_VERSION,
    sid,
    type: "session",
  };

  const refreshPayload = {
    lk: input.licenseKey,
    df: input.deviceFingerprint,
    pv: SESSION_PROTOCOL_VERSION,
    sid,
    type: "refresh",
  };

  const sessionToken = await signJwt(sessionPayload, SESSION_TTL);
  const refreshToken = await signJwt(refreshPayload, REFRESH_TTL);

  const now = Math.floor(Date.now() / 1000);
  return {
    sessionToken,
    refreshToken,
    expiresAt: (now + SESSION_TTL) * 1000,
    sessionId: sid,
  };
}

interface DecodedSession {
  licenseKey: string;
  deviceFingerprint: string;
  userName: string;
  sessionId: string;
  protocolVersion: number;
  issuedAt: number;
  expiresAt: number;
}

export async function verifySession(
  token: string
): Promise<DecodedSession | null> {
  const decoded = await verifyJwt(token);
  if (!decoded) return null;

  if (decoded.pv !== SESSION_PROTOCOL_VERSION) return null;
  if (decoded.type !== "session") return null;

  return {
    licenseKey: decoded.lk as string,
    deviceFingerprint: decoded.df as string,
    userName: (decoded.un as string) || "",
    sessionId: decoded.sid as string,
    protocolVersion: decoded.pv as number,
    issuedAt: decoded.iat as number,
    expiresAt: decoded.exp as number,
  };
}

interface DecodedRefresh {
  licenseKey: string;
  deviceFingerprint: string;
  sessionId: string;
  protocolVersion: number;
  issuedAt: number;
  expiresAt: number;
}

export async function verifyRefreshToken(
  token: string
): Promise<DecodedRefresh | null> {
  const decoded = await verifyJwt(token);
  if (!decoded) return null;

  if (decoded.pv !== SESSION_PROTOCOL_VERSION) return null;
  if (decoded.type !== "refresh") return null;

  return {
    licenseKey: decoded.lk as string,
    deviceFingerprint: decoded.df as string,
    sessionId: decoded.sid as string,
    protocolVersion: decoded.pv as number,
    issuedAt: decoded.iat as number,
    expiresAt: decoded.exp as number,
  };
}

/**
 * Extrai e verifica token de sessão do header Authorization
 */
export async function requireSession(
  req: Request
): Promise<
  | { ok: true; session: DecodedSession }
  | { ok: false; status: number; message: string }
> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) {
    return {
      ok: false,
      status: 401,
      message: "Token de sessão ausente. Faça login novamente.",
    };
  }

  const session = await verifySession(token);
  if (!session) {
    return {
      ok: false,
      status: 401,
      message: "Sessão expirada ou inválida. Faça login novamente.",
    };
  }

  return { ok: true, session };
}
