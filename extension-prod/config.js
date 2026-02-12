/**
 * Configurações da Extensão Lovable Infinity
 * Sistema de Licenças Vinculadas ao Dispositivo (Device Fingerprint)
 */
// Console mantido (ofuscação da build já protege o código)

const CONFIG = {
    REQUIRE_LICENSE: true,
    CACHE_DURATION: 5 * 60 * 1000,

    // ============================================
    // SUPABASE EDGE FUNCTIONS (todos os endpoints)
    // ============================================
    SUPABASE_URL: 'https://svjglgrxqxqtonoobcdi.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2amdsZ3J4cXhxdG9ub29iY2RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNjUyMDMsImV4cCI6MjA4NTg0MTIwM30.6adWdnXXlrD_-6nrzdcviyKfVuBjWo57piuedOFdG0o',

    // Envio de mensagens (proxy N8N → Lovable)
    SEND_PROMPT_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/send-prompt',
    SEND_MESSAGE_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/send-prompt',
    // Melhorador de prompt + Transcrição de áudio (exige JWT)
    IMPROVE_PROMPT_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/enhance-prompt',
    TRANSCRIBE_AUDIO_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/enhance-prompt',
    // Licenciamento (Supabase Postgres)
    VALIDATE_LICENSE_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/validate-license',
    // Sessão JWT
    VERIFY_SESSION_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/verify-session',
    REFRESH_SESSION_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/refresh-session'
};

let licenseCache = {};
let cacheTimestamp = 0;

/**
 * Gerar fingerprint único do dispositivo
 */
async function generateDeviceFingerprint() {
    try {
        let fingerprint = '';
        
        try {
            const cpuInfo = await navigator.deviceMemory || 'unknown';
            fingerprint += 'cpu_' + cpuInfo + '_';
        } catch (e) {
            fingerprint += 'cpu_unknown_';
        }
        
        const userAgent = navigator.userAgent;
        fingerprint += 'ua_' + userAgent.substring(0, 100).replace(/[^a-zA-Z0-9]/g, '') + '_';
        
        const screen = window.screen;
        fingerprint += 'screen_' + screen.width + 'x' + screen.height + '_';
        
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        fingerprint += 'tz_' + timezone.replace(/[^a-zA-Z0-9]/g, '') + '_';
        
        const language = navigator.language;
        fingerprint += 'lang_' + language.replace(/[^a-zA-Z0-9]/g, '');
        
        const hash = await hashString(fingerprint);
        return hash;
    } catch (error) {
        return 'UNKNOWN_DEVICE_' + Date.now();
    }
}

/**
 * Gerar hash SHA-256 de uma string
 */
async function hashString(str) {
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex.substring(0, 32);
    } catch (error) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }
}

/**
 * Obter ou gerar ID do dispositivo
 */
async function getDeviceFingerprint() {
    try {
        const stored = await chrome.storage.local.get('deviceFingerprint');
        if (stored.deviceFingerprint) return stored.deviceFingerprint;
        const fingerprint = await generateDeviceFingerprint();
        await chrome.storage.local.set({ deviceFingerprint: fingerprint });
        return fingerprint;
    } catch (error) {
        return 'UNKNOWN_DEVICE';
    }
}

/**
 * Retorna headers base para chamadas às Edge Functions do Supabase
 * Inclui apikey para o gateway do Supabase
 */
function getSupabaseHeaders(extraHeaders = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (CONFIG.SUPABASE_ANON_KEY) {
        headers['apikey'] = CONFIG.SUPABASE_ANON_KEY;
    }
    return { ...headers, ...extraHeaders };
}

/**
 * Valida a chave de licença usando Supabase Edge Function
 */
async function validateKeySecure(key) {
    if (!CONFIG.REQUIRE_LICENSE) {
        return { valid: true, message: 'Acesso liberado (verificação desabilitada)' };
    }

    const cleanKey = key.trim();
    const deviceFingerprint = await getDeviceFingerprint();

    try {
        const response = await fetch(CONFIG.VALIDATE_LICENSE_ENDPOINT, {
            method: 'POST',
            headers: getSupabaseHeaders(),
            body: JSON.stringify({
                licenseKey: cleanKey,
                deviceFingerprint: deviceFingerprint
            })
        });

        const result = await response.json();

        // A API já retorna no formato { valid, message, license?, userData?, sessionToken?, refreshToken?, expiresAt? }
        return {
            valid: result.valid,
            message: result.message,
            license: result.license || null,
            userData: result.userData || null,
            // JWT tokens (se o servidor retornar)
            sessionToken: result.sessionToken || null,
            refreshToken: result.refreshToken || null,
            sessionExpiresAt: result.expiresAt || null
        };

    } catch (error) {
        return { valid: false, message: 'Erro de conexão. Verifique sua internet e tente novamente.' };
    }
}

async function verifyIntegrity() {
    try {
        const response = await fetch(chrome.runtime.getURL('config.js'));
        const code = await response.text();
        const hash = await hashString(code);
        
        const stored = await chrome.storage.local.get('codeHash');
        if (stored.codeHash && stored.codeHash !== hash) {
            return false;
        }
        
        await chrome.storage.local.set({ codeHash: hash });
        return true;
    } catch (error) {
        return true;
    }
}

async function isAuthenticated() {
    try {
        const storage = await chrome.storage.local.get(['isAuthenticated', 'licenseKey']);
        return storage.isAuthenticated === true && storage.licenseKey;
    } catch (error) {
        return false;
    }
}

async function getStoredLicenseKey() {
    try {
        const storage = await chrome.storage.local.get('licenseKey');
        return storage.licenseKey || null;
    } catch (error) {
        return null;
    }
}

async function clearAuthentication() {
    try {
        await chrome.storage.local.remove(['licenseKey', 'isAuthenticated', 'authTimestamp', 'userData', 'deviceFingerprint']);
    } catch (error) {}
}

async function initializeConfig() {
    await verifyIntegrity();
    return await isAuthenticated();
}

// ============================================
// SESSÃO JWT (camada de segurança extra)
// Se falhar, a extensão continua funcionando normalmente.
// ============================================

/**
 * Verifica a sessão JWT com o servidor
 */
async function verifySessionWithServer() {
    try {
        const stored = await chrome.storage.local.get(['sessionToken']);
        if (!stored.sessionToken) return { valid: false, message: 'Sem sessão JWT.' };

        const response = await fetch(CONFIG.VERIFY_SESSION_ENDPOINT, {
            method: 'POST',
            headers: getSupabaseHeaders({
                'Authorization': 'Bearer ' + stored.sessionToken
            })
        });

        const result = await response.json();
        return result;
    } catch (error) {
        return { valid: false, message: 'Erro de conexão.' };
    }
}

/**
 * Tenta renovar a sessão usando o refresh token
 */
async function tryRefreshSession() {
    try {
        const stored = await chrome.storage.local.get(['refreshToken', 'deviceFingerprint']);
        if (!stored.refreshToken) return false;

        const response = await fetch(CONFIG.REFRESH_SESSION_ENDPOINT, {
            method: 'POST',
            headers: getSupabaseHeaders(),
            body: JSON.stringify({
                refreshToken: stored.refreshToken,
                deviceFingerprint: stored.deviceFingerprint || ''
            })
        });

        const result = await response.json();
        if (result.valid && result.sessionToken) {
            await chrome.storage.local.set({
                sessionToken: result.sessionToken,
                refreshToken: result.refreshToken,
                sessionExpiresAt: result.expiresAt
            });
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

/**
 * Obter token de sessão atual (verifica expiração e tenta renovar)
 */
async function getSessionToken() {
    const stored = await chrome.storage.local.get(['sessionToken', 'sessionExpiresAt']);
    if (!stored.sessionToken) return null;

    const now = Date.now();
    if (stored.sessionExpiresAt && (stored.sessionExpiresAt - now) < 5 * 60 * 1000) {
        const refreshed = await tryRefreshSession();
        if (refreshed) {
            const updated = await chrome.storage.local.get(['sessionToken']);
            return updated.sessionToken;
        }
        return null;
    }

    return stored.sessionToken;
}
