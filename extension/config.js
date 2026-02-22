/**
 * Configurações da Extensão Lovable Infinity
 * Sistema de Licenças com Sessão Única (Device Fingerprint)
 */
// Console mantido (ofuscação da build já protege o código)

const CONFIG = {
    REQUIRE_LICENSE: true,
    CACHE_DURATION: 5 * 60 * 1000,

    // ============================================
    // SUPABASE (nossa branch — extensão fala só com Supabase)
    // ============================================
    SUPABASE_URL: 'https://svjglgrxqxqtonoobcdi.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2amdsZ3J4cXhxdG9ub29iY2RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNjUyMDMsImV4cCI6MjA4NTg0MTIwM30.6adWdnXXlrD_-6nrzdcviyKfVuBjWo57piuedOFdG0o',

    // Painel/API (origem do painel; extensão não chama esses endpoints)
    API_BASE: 'https://lovable-infinity-panel.vercel.app',

    // Edge Functions Supabase (envio, licença, sessão, melhorador)
    SEND_PROMPT_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/send-prompt',
    SEND_MESSAGE_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/send-prompt',
    VALIDATE_LICENSE_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/validate-license',
    VERIFY_SESSION_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/verify-session',
    REFRESH_SESSION_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/refresh-session',
    // enhance-prompt: 1) melhorar texto (POST { text }) 2) transcrever áudio (POST { action: 'transcribe', audio: base64, format })
    IMPROVE_PROMPT_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/enhance-prompt',
    TRANSCRIBE_AUDIO_ENDPOINT: 'https://svjglgrxqxqtonoobcdi.supabase.co/functions/v1/enhance-prompt'
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
 * DeviceId no formato PromptX 3.1 (HWID_CPU_GPU) para usar em PROMPTX_DEVICE_ID.
 * Use esta máquina para ativar a licença PromptX e depois copie o valor para .env.
 */
async function getPromptxStyleDeviceId() {
    let cpu = 'Generic CPU';
    let gpu = 'GPU-Generic';
    try {
        if (typeof chrome !== 'undefined' && chrome.system && chrome.system.cpu && chrome.system.cpu.getInfo) {
            const info = await Promise.race([
                chrome.system.cpu.getInfo(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 750))
            ]);
            if (info && info.modelName) cpu = String(info.modelName).trim();
        }
    } catch (_) {}
    try {
        const canvas = typeof document !== 'undefined' && document.createElement('canvas');
        if (canvas) {
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                if (debugInfo) gpu = (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || gpu).trim();
            }
        }
    } catch (_) {}
    const raw = 'HWID_' + cpu + '_' + gpu;
    return raw.replace(/\s+/g, '').toUpperCase();
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
 * Headers para Edge Functions Supabase (apikey obrigatório)
 */
function getSupabaseHeaders(extraHeaders = {}) {
    const h = {
        'Content-Type': 'application/json',
        'apikey': (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_ANON_KEY) ? CONFIG.SUPABASE_ANON_KEY : '',
        ...extraHeaders
    };
    if (!h['Authorization'] && h.apikey) h['Authorization'] = 'Bearer ' + h.apikey;
    return h;
}

/** @deprecated use getSupabaseHeaders para chamadas à extensão (Supabase) */
function getApiHeaders(extraHeaders = {}) {
    return getSupabaseHeaders(extraHeaders);
}

/**
 * Valida a chave de licença via Supabase Edge Function validate-license
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
            headers: getApiHeaders(),
            body: JSON.stringify({
                licenseKey: cleanKey,
                deviceFingerprint: deviceFingerprint
            })
        });

        const result = await response.json();

        return {
            valid: result.valid,
            message: result.message,
            license: result.license || null,
            userData: result.userData || null,
            sessionToken: result.sessionToken || null,
            refreshToken: result.refreshToken || null,
            sessionExpiresAt: result.expiresAt || null
        };

    } catch (error) {
        return { valid: false, message: 'Erro de conexão. Verifique sua internet e tente novamente.' };
    }
}

async function verifyIntegrity() {
    // Tenta ambos os nomes: dev = config.js, build = c1.js (evita ERR_FILE_NOT_FOUND)
    const scriptNames = ['config.js', 'c1.js'];
    try {
        let code = null;
        for (const name of scriptNames) {
            try {
                const response = await fetch(chrome.runtime.getURL(name));
                if (response && response.ok) {
                    code = await response.text();
                    break;
                }
            } catch (_) {
                continue;
            }
        }
        if (!code) return true; // não bloquear se não conseguir carregar
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
            headers: getApiHeaders({
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
            headers: getApiHeaders(),
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
