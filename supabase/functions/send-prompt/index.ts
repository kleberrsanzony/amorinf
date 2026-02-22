// Supabase Edge Function: send-prompt
// PROXY FUNIL — Recebe de nossos clientes, repassa para PromptX (1 licença fixa)
//
// INTEGRA COM SISTEMA EXISTENTE:
// - Tabela `licenses` (já existe — chave, ativa, expiração, uses/max_uses)
// - SessionToken JWT do nosso `validate-license` (já funcional)
// - Tabela `session_cache` (NOVA — cache da sessão PromptX)
// - Tabela `usage_logs` (NOVA — log de uso do proxy)
//
// Fluxo:
// 1. Cliente envia: {message, projectId, token, mode?, files?}
//    com Authorization: Bearer <sessionToken> (nosso JWT, gerado pelo validate-license)
// 2. Decodifica JWT → extrai licenseKey do cliente
// 3. Valida licença na tabela `licenses` existente (active, expiry, uses)
// 4. Obtém ou reusa sessionToken do PromptX (cache no DB session_cache)
// 5. Forward para PromptX secure-gateway (proxy_webhook)
// 6. Incrementa `uses` na tabela `licenses` + registra em `usage_logs`
// 7. Retorna resultado

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// === CORS ===
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// === CONSTANTES ===
// Credenciais PromptX vêm dos Secrets do Supabase (nunca no client).
// Licença única do funil: TDH8-3XO7-P9MC-PY3Y (uma licença PromptX 3.1 → múltiplas licenças nossas).
// PROMPTX_DEVICE_ID = valor de getDeviceId() do PromptX 3.1 na máquina onde a licença foi ativada (formato HWID_CPU_GPU).
const PROMPTX_GATEWAY_URL = Deno.env.get("PROMPTX_GATEWAY_URL") || "";
const PROMPTX_ANON_KEY = Deno.env.get("PROMPTX_ANON_KEY") || "";
const PROMPTX_LICENSE_KEY = Deno.env.get("PROMPTX_LICENSE_KEY") || "";
const PROMPTX_DEVICE_ID = Deno.env.get("PROMPTX_DEVICE_ID") || "";

// Supabase interno (service_role para acessar tabelas)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// JWT Secret para verificar nossos tokens (mesmo usado pelo validate-license)
const JWT_SECRET = Deno.env.get("JWT_SECRET") || Deno.env.get("SUPABASE_JWT_SECRET") || "";

// Duração do cache da sessão PromptX (45 minutos — margem de segurança)
const SESSION_CACHE_DURATION_MS = 45 * 60 * 1000;

// === UTILIDADES ===

/** Decodifica payload de um JWT sem verificar assinatura */
function decodeJwtPayload(token: string): Record<string, unknown> {
    try {
        const parts = token.split(".");
        if (parts.length >= 2) {
            const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
            return JSON.parse(atob(b64));
        }
    } catch (_) { /* ignore */ }
    return {};
}

/** Verifica JWT com HMAC-SHA256 */
async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;

        const [headerB64, payloadB64, signatureB64] = parts;

        // Importar chave
        const encoder = new TextEncoder();
        const keyData = encoder.encode(secret);
        const key = await crypto.subtle.importKey(
            "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
        );

        // Verificar assinatura
        const data = encoder.encode(`${headerB64}.${payloadB64}`);
        const signature = Uint8Array.from(
            atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")),
            c => c.charCodeAt(0)
        );

        const valid = await crypto.subtle.verify("HMAC", key, signature, data);
        if (!valid) return null;

        // Decodificar payload
        const payload = JSON.parse(
            atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))
        );

        // Verificar expiração
        if (payload.exp && payload.exp * 1000 < Date.now()) return null;

        return payload;
    } catch (_) {
        return null;
    }
}

/** Resposta JSON padronizada */
function jsonResponse(data: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

/** Resposta de erro padronizada */
function errorResponse(message: string, status = 400) {
    return jsonResponse({ success: false, error: message }, status);
}

// === GERENCIAMENTO DE SESSÃO PROMPTX ===

type PromptxSessionResult = { token: string; expiresAt: string } | { error: string };

/**
 * Obtém sessão PromptX válida do cache ou cria nova.
 * Quando deviceId vem do body (fingerprint da máquina), não usa cache e valida com esse deviceId.
 */
async function getOrCreatePromptxSession(
    supabase: ReturnType<typeof createClient>,
    deviceId?: string
): Promise<PromptxSessionResult> {
    const useDeviceFromRequest = deviceId && deviceId.length > 0;
    if (useDeviceFromRequest) {
        console.log("[send-prompt] Usando deviceId da máquina do cliente (sem cache)");
        return await createNewPromptxSession(supabase, deviceId);
    }
    const now = new Date().toISOString();
    const { data: cached } = await supabase
        .from("session_cache")
        .select("session_token, expires_at")
        .eq("license_key", PROMPTX_LICENSE_KEY)
        .eq("is_valid", true)
        .gt("expires_at", now)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

    if (cached?.session_token) {
        console.log("[send-prompt] Sessão PromptX encontrada no cache");
        return { token: cached.session_token, expiresAt: cached.expires_at };
    }
    console.log("[send-prompt] Criando nova sessão PromptX...");
    return await createNewPromptxSession(supabase, PROMPTX_DEVICE_ID);
}

/**
 * Cria nova sessão no PromptX via ação 'validate' do secure-gateway.
 * deviceId: fingerprint da máquina (do body) ou PROMPTX_DEVICE_ID dos secrets.
 */
async function createNewPromptxSession(
    supabase: ReturnType<typeof createClient>,
    deviceId?: string
): Promise<PromptxSessionResult> {
    const effectiveDeviceId = (deviceId && deviceId.length > 0) ? deviceId : PROMPTX_DEVICE_ID;
    if (!effectiveDeviceId) {
        console.error("[send-prompt] Nenhum deviceId disponível (envie deviceFingerprint no body ou configure PROMPTX_DEVICE_ID)");
        return { error: "Configure PROMPTX_DEVICE_ID nos secrets ou envie deviceFingerprint no body." };
    }
    try {
        const response = await fetch(PROMPTX_GATEWAY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": PROMPTX_ANON_KEY,
                "Authorization": `Bearer ${PROMPTX_ANON_KEY}`,
            },
            body: JSON.stringify({
                action: "validate",
                licenseKey: PROMPTX_LICENSE_KEY,
                deviceId: effectiveDeviceId,
            }),
        });

        const result = await response.json().catch(() => ({}));
        console.log("[send-prompt] Validate response:", response.status, JSON.stringify(result).substring(0, 200));

        const msg = (result as { message?: string; error?: string }).message || (result as { message?: string; error?: string }).error || "";
        if (!response.ok) {
            console.error("[send-prompt] Gateway respondeu com erro:", msg || response.status);
            const lower = (msg || "").toLowerCase();
            if (lower.includes("outro computador") || lower.includes("já está em uso") || lower.includes("already in use") || lower.includes("another computer")) {
                return { error: "A licença PromptX está vinculada a outro computador. Nos secrets do Supabase, PROMPTX_DEVICE_ID deve ser exatamente o deviceId da máquina onde a licença foi ativada (a mesma que o PromptX 3.1 reconhece)." };
            }
            return { error: msg ? `Gateway PromptX: ${msg}` : `Gateway respondeu com HTTP ${response.status}. Verifique PROMPTX_GATEWAY_URL e PROMPTX_ANON_KEY.` };
        }
        if (!(result as { valid?: boolean }).valid) {
            console.error("[send-prompt] Falha ao validar licença PromptX:", msg);
            return { error: msg ? `Validate recusou: ${msg}. Confira PROMPTX_DEVICE_ID (device da máquina onde a licença foi ativada).` : "Validate recusou. Confira PROMPTX_LICENSE_KEY e PROMPTX_DEVICE_ID nos secrets." };
        }

        const sessionToken = (result as { sessionToken?: string }).sessionToken;
        if (!sessionToken) {
            console.error("[send-prompt] Validate retornou sem sessionToken");
            return { error: "Gateway não retornou sessionToken. Verifique se o secure-gateway do PromptX suporta action 'validate'." };
        }

        // Calcular expiração (45 min a partir de agora)
        const expiresAt = new Date(Date.now() + SESSION_CACHE_DURATION_MS).toISOString();

        // Invalidar sessões antigas
        await supabase
            .from("session_cache")
            .update({ is_valid: false })
            .eq("license_key", PROMPTX_LICENSE_KEY);

        // Salvar nova sessão no cache
        await supabase
            .from("session_cache")
            .insert({
                license_key: PROMPTX_LICENSE_KEY,
                session_token: sessionToken,
                expires_at: expiresAt,
                is_valid: true,
            });

        console.log("[send-prompt] Nova sessão PromptX cacheada, expira em:", expiresAt);
        return { token: sessionToken, expiresAt };
    } catch (error) {
        const msg = (error as Error).message || String(error);
        console.error("[send-prompt] Erro ao criar sessão PromptX:", error);
        return { error: `Erro de conexão com o gateway: ${msg}. Verifique PROMPTX_GATEWAY_URL e rede.` };
    }
}

// === FORWARD PARA PROMPTX ===

/**
 * Envia mensagem via proxy_webhook do secure-gateway do PromptX.
 */
async function forwardToPromptx(
    sessionToken: string,
    deviceId: string,
    payload: {
        message: string;
        projectId: string;
        token: string; // Firebase token do cliente Lovable
        files?: unknown[];
    }
): Promise<{ success: boolean; status: number; data?: unknown; error?: string }> {
    const effectiveDeviceId = (deviceId && deviceId.length > 0) ? deviceId : PROMPTX_DEVICE_ID;
    try {
        const body = {
            action: "proxy_webhook",
            licenseKey: PROMPTX_LICENSE_KEY,
            deviceId: effectiveDeviceId,
            sessionToken: sessionToken,
            payload: {
                message: payload.message,
                projectId: payload.projectId,
                token: payload.token,
                source: "RESELLER-EXT",
                files: payload.files || [],
            },
        };

        console.log("[send-prompt] Enviando para PromptX proxy_webhook...");

        const response = await fetch(PROMPTX_GATEWAY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": PROMPTX_ANON_KEY,
                "Authorization": `Bearer ${PROMPTX_ANON_KEY}`,
            },
            body: JSON.stringify(body),
        });

        const responseText = await response.text();
        let responseData: Record<string, unknown> = {};
        try {
            responseData = JSON.parse(responseText);
        } catch (_) {
            responseData = { raw: responseText };
        }

        console.log("[send-prompt] PromptX response:", response.status, responseText.substring(0, 300));

        return {
            success: response.ok,
            status: response.status,
            data: responseData,
            error: response.ok ? undefined : (responseData.error as string || responseData.message as string || `HTTP ${response.status}`),
        };
    } catch (error) {
        console.error("[send-prompt] Erro ao encaminhar para PromptX:", error);
        return {
            success: false,
            status: 500,
            error: `Erro de conexão com gateway: ${(error as Error).message}`,
        };
    }
}

// === VALIDAÇÃO DA LICENÇA DO NOSSO CLIENTE ===

interface LicenseRow {
    key: string;
    active: boolean;
    activated: boolean;
    expiry_date: string | null;
    lifetime: boolean;
    max_uses: number | null;
    uses: number;
    user_name: string | null;
}

/**
 * Valida a licença do nosso cliente na tabela `licenses` existente.
 * Verifica: active, expiração, max_uses vs uses.
 */
async function validateClientLicense(
    supabase: ReturnType<typeof createClient>,
    licenseKey: string
): Promise<{ valid: boolean; license?: LicenseRow; error?: string }> {
    const { data: license, error } = await supabase
        .from("licenses")
        .select("key, active, activated, expiry_date, lifetime, max_uses, uses, user_name")
        .eq("key", licenseKey)
        .single();

    if (error || !license) {
        return { valid: false, error: "Licença não encontrada" };
    }

    if (!license.active) {
        return { valid: false, error: "Licença desativada" };
    }

    // Verificar expiração (se não for lifetime)
    if (!license.lifetime && license.expiry_date) {
        const expiryDate = new Date(license.expiry_date);
        if (expiryDate < new Date()) {
            return { valid: false, error: "Licença expirada" };
        }
    }

    // Verificar limite de usos (se definido)
    if (license.max_uses !== null && license.max_uses > 0) {
        if (license.uses >= license.max_uses) {
            return { valid: false, error: "Limite de usos atingido" };
        }
    }

    return { valid: true, license: license as LicenseRow };
}

// === HANDLER PRINCIPAL ===

Deno.serve(async (req) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return errorResponse("Método não permitido", 405);
    }

    // Verificar configuração do PromptX (deviceId pode vir do body como deviceFingerprint)
    if (!PROMPTX_GATEWAY_URL || !PROMPTX_ANON_KEY || !PROMPTX_LICENSE_KEY) {
        console.error("[send-prompt] Secrets PromptX não configurados!");
        return errorResponse("Serviço não configurado. Contate o administrador.", 503);
    }

    // Criar client Supabase (service_role para acessar tabelas)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        // === 1. EXTRAIR E VALIDAR PAYLOAD ===
        const body = await req.json();
        const { message, projectId, token, mode, files, ai_message_id, git_sha, licenseKey: bodyLicenseKey } = body;
        // PromptX exige o deviceId no formato deles (ex.: HWID_...). Sempre usamos PROMPTX_DEVICE_ID para validate/proxy_webhook.
        const promptxDeviceId = PROMPTX_DEVICE_ID?.trim() || "";

        if (!projectId || !token) {
            return errorResponse("Dados incompletos: projectId e token são obrigatórios.");
        }

        if (!message && (!files || files.length === 0)) {
            return errorResponse("Informe uma mensagem ou anexe arquivos.");
        }

        // === 2. OBTER licenseKey: body.licenseKey tem prioridade (evita depender de JWT quebrado) ===
        const authHeader = req.headers.get("Authorization");
        let clientSessionToken = "";
        if (authHeader?.startsWith("Bearer ")) {
            clientSessionToken = authHeader.slice(7);
        }

        let clientLicenseKey = "";
        let licenseFromBody = false;

        if (bodyLicenseKey && typeof bodyLicenseKey === "string" && bodyLicenseKey.trim()) {
            clientLicenseKey = bodyLicenseKey.trim();
            licenseFromBody = true;
        }

        if (!clientLicenseKey && clientSessionToken) {
            if (JWT_SECRET) {
                const verified = await verifyJwt(clientSessionToken, JWT_SECRET);
                if (verified) {
                    clientLicenseKey = (verified.licenseKey || verified.license_key || verified.sub || "") as string;
                }
            }
            if (!clientLicenseKey) {
                const payload = decodeJwtPayload(clientSessionToken);
                clientLicenseKey = (payload.licenseKey || payload.license_key || payload.sub || "") as string;
                if (payload.exp && (payload.exp as number) * 1000 < Date.now()) {
                    return errorResponse("Sessão expirada. Faça login novamente.", 401);
                }
            }
        }

        if (!clientLicenseKey) {
            return errorResponse(
                clientSessionToken
                    ? "Não foi possível identificar sua licença. Faça login novamente ou envie a chave no corpo da requisição."
                    : "Sessão expirada. Faça login novamente ou informe a chave de licença no corpo da requisição.",
                401
            );
        }

        console.log(`[send-prompt] Request de cliente: ${clientLicenseKey}, projeto: ${projectId}, licenseFrom: ${licenseFromBody ? "body" : "jwt"}`);

        // === 3. VALIDAR LICENÇA DO CLIENTE NA TABELA `licenses` ===
        const licenseCheck = await validateClientLicense(supabase, clientLicenseKey);

        if (!licenseCheck.valid) {
            return errorResponse(licenseCheck.error || "Licença inválida", 403);
        }

        if (!promptxDeviceId) {
            return errorResponse("Serviço de envio indisponível: configure PROMPTX_DEVICE_ID nos secrets (deviceId da máquina onde a licença PromptX foi ativada).", 503);
        }

        // === 4. OBTER SESSÃO PROMPTX (sempre PROMPTX_DEVICE_ID; cache por license_key) ===
        let promptxSession = await getOrCreatePromptxSession(supabase);

        if (promptxSession && "error" in promptxSession) {
            return errorResponse("Serviço de envio indisponível. " + promptxSession.error, 503);
        }
        if (!promptxSession || !("token" in promptxSession)) {
            return errorResponse("Serviço de envio indisponível. Verifique PROMPTX_LICENSE_KEY, PROMPTX_GATEWAY_URL, PROMPTX_ANON_KEY e PROMPTX_DEVICE_ID nos secrets.", 503);
        }

        // === 5. FORWARD PARA PROMPTX ===
        let result = await forwardToPromptx(promptxSession.token, promptxDeviceId, {
            message: message || "",
            projectId,
            token, // Firebase token do Lovable (do cliente)
            files: files || [],
        });

        // Se a sessão expirou (401) ou erro de token/sessão, invalidar cache e renovar
        const sessionInvalid = !result.success && (
            result.status === 401 ||
            /token|sessão|session/i.test(result.error || "")
        );
        if (sessionInvalid) {
            console.log("[send-prompt] Sessão PromptX inválida ou expirada, invalidando cache e renovando...");
            await supabase
                .from("session_cache")
                .update({ is_valid: false })
                .eq("license_key", PROMPTX_LICENSE_KEY);
            const renewed = await createNewPromptxSession(supabase, promptxDeviceId);
            if (renewed && "token" in renewed) {
                promptxSession = renewed;
                result = await forwardToPromptx(promptxSession.token, promptxDeviceId, {
                    message: message || "",
                    projectId,
                    token,
                    files: files || [],
                });
            }
            if (!renewed || "error" in renewed) {
                return errorResponse("Serviço de envio indisponível. " + (renewed && "error" in renewed ? renewed.error : "Não foi possível renovar a sessão PromptX."), 503);
            }
        }

        // === 6. REGISTRAR USO ===
        try {
            // Incrementar contador de usos na tabela licenses existente
            if (result.success && licenseCheck.license) {
                await supabase
                    .from("licenses")
                    .update({ uses: (licenseCheck.license.uses || 0) + 1 })
                    .eq("key", clientLicenseKey);
            }

            // Registrar na tabela usage_logs (nova)
            await supabase.from("usage_logs").insert({
                client_license: clientLicenseKey,
                project_id: projectId,
                status: result.success ? "success" : "error",
                error_message: result.error || null,
            });
        } catch (logError) {
            // Logging não deve bloquear a resposta
            console.warn("[send-prompt] Erro ao registrar uso:", logError);
        }

        // === 7. RETORNAR RESULTADO ===
        if (result.success) {
            return jsonResponse({
                success: true,
                status: result.status,
                message: "Mensagem enviada com sucesso",
                data: result.data,
            });
        } else {
            // Erro do PromptX: prefixar para distinguir de erro nosso; logar para diagnóstico
            const promptxError = result.error || "Erro ao enviar mensagem";
            console.warn("[send-prompt] PromptX falhou:", result.status, promptxError);
            if (result.data && typeof result.data === "object") {
                const safe = { ...result.data } as Record<string, unknown>;
                delete safe.sessionToken;
                delete safe.token;
                if (Object.keys(safe).length > 0) {
                    console.warn("[send-prompt] PromptX response body (sanitized):", JSON.stringify(safe).substring(0, 200));
                }
            }

            let userMessage = "Serviço de envio: " + promptxError;
            let statusCode = result.status || 500;

            if (result.status === 403) {
                userMessage = "Serviço temporariamente indisponível. Tente novamente mais tarde.";
                statusCode = 503;
            } else if (result.status === 429) {
                userMessage = "Muitas requisições. Aguarde alguns segundos e tente novamente.";
                statusCode = 429;
            }

            return errorResponse(userMessage, statusCode);
        }
    } catch (error) {
        console.error("[send-prompt] Erro geral:", error);
        return errorResponse(`Erro interno: ${(error as Error).message}`, 500);
    }
});
