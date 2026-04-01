/**
 * Configuração do Painel Admin - Lovable Infinity
 * Autenticação 100% Supabase Auth (sem Firebase). Sessão é a persistida pelo Supabase (localStorage).
 * API de licenças via Vercel; token enviado em Authorization e X-Auth-Token.
 */

/** Base da API: mesma origem do painel para evitar 401 por cross-origin (token sempre enviado) */
var API_BASE = (typeof window !== 'undefined' && window.location && window.location.origin)
    ? window.location.origin
    : "https://lovable-infinity-panel.vercel.app";

/** URLs dos endpoints de gestão de usuários do painel */
var CREATE_PANEL_USER_API_URL = API_BASE + "/api/createPanelUser";
var LIST_PANEL_USERS_API_URL = API_BASE + "/api/listPanelUsers";
var UPDATE_PANEL_USER_API_URL = API_BASE + "/api/updatePanelUser";
var DELETE_PANEL_USER_API_URL = API_BASE + "/api/deletePanelUser";
var CLEANUP_ORPHANED_LICENSES_API_URL = API_BASE + "/api/cleanupOrphanedLicenses";

/** Supabase config */
var SUPABASE_URL = "https://svjglgrxqxqtonoobcdi.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2amdsZ3J4cXhxdG9ub29iY2RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNjUyMDMsImV4cCI6MjA4NTg0MTIwM30.6adWdnXXlrD_-6nrzdcviyKfVuBjWo57piuedOFdG0o";

/** Base da API de licenças (mesma origem = mesmo token/session) */
var LICENSES_API_BASE = API_BASE;

var supabaseClient = null;
var currentSession = null;
/** Cooldown para refresh: evita 429 (Too Many Requests) e auto-logout */
var lastRefreshAt = 0;
var REFRESH_COOLDOWN_MS = 60000;

/**
 * Inicializar Supabase Auth
 */
async function initializeAuth() {
    if (supabaseClient) return true;
    if (typeof supabase === 'undefined' || !supabase.createClient) {
        console.error('Supabase JS não carregado');
        return false;
    }
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
}

function isRefreshTokenError(err) {
    var msg = (err && err.message) ? String(err.message) : '';
    return msg.indexOf('Refresh Token') !== -1 || msg.indexOf('refresh_token') !== -1 || msg.indexOf('Invalid Refresh Token') !== -1;
}

function getAuth() {
    if (!supabaseClient) return null;
    return {
        onAuthStateChanged: function(callback) {
            // Fonte da verdade: sessão persistida no Supabase (localStorage)
            function applySession(session) {
                currentSession = session;
                if (session && session.user) {
                    callback(_wrapUser(session.user, session.access_token));
                } else {
                    callback(null);
                }
            }
            function clearInvalidSession() {
                currentSession = null;
                if (supabaseClient) supabaseClient.auth.signOut().catch(function() {});
                callback(null);
            }
            supabaseClient.auth.getSession()
                .then(function(result) {
                    applySession(result.data.session);
                })
                .catch(function(err) {
                    if (isRefreshTokenError(err)) {
                        clearInvalidSession();
                    } else {
                        applySession(null);
                    }
                });
            supabaseClient.auth.onAuthStateChange(function(event, session) {
                if (session) {
                    applySession(session);
                    return;
                }
                // session=null: pode ser logout real ou falha de refresh. Consultar storage.
                supabaseClient.auth.getSession()
                    .then(function(result) {
                        var stored = result.data.session;
                        if (stored && stored.user) {
                            currentSession = stored;
                            callback(_wrapUser(stored.user, stored.access_token));
                        } else {
                            currentSession = null;
                            callback(null);
                        }
                    })
                    .catch(function(err) {
                        if (isRefreshTokenError(err)) clearInvalidSession();
                        else callback(null);
                    });
            });
        },
        signInWithEmailAndPassword: async function(email, password) {
            var result = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
            if (result.error) {
                var err = new Error(result.error.message);
                err.code = result.error.status === 400 ? 'auth/invalid-credential' : 'auth/unknown';
                throw err;
            }
            currentSession = result.data.session;
            return result.data;
        },
        createUserWithEmailAndPassword: async function(email, password) {
            var result = await supabaseClient.auth.signUp({ email: email, password: password });
            if (result.error) {
                var err = new Error(result.error.message);
                err.code = 'auth/signup-failed';
                throw err;
            }
            currentSession = result.data.session;
            return result.data;
        },
        signOut: async function() {
            await supabaseClient.auth.signOut();
            currentSession = null;
        }
    };
}

/** Retorna objeto usuário com uid, email, displayName e getIdToken() (JWT). */
function _wrapUser(user, accessToken) {
    return {
        uid: user.id,
        email: user.email || '',
        displayName: (user.user_metadata && user.user_metadata.display_name) || (user.user_metadata && user.user_metadata.full_name) || user.email || '',
        getIdToken: function() { return Promise.resolve(accessToken); }
    };
}

/**
 * Obter token de autenticação para chamadas à API.
 * Logo após login, currentSession já está preenchido; usa-o primeiro para evitar race com getSession().
 * Depois usa getSession() (persistido) como fonte da verdade.
 */
window.getAdminAuthToken = async function() {
    if (!supabaseClient) return null;
    if (currentSession && currentSession.access_token) {
        var expiresAt = currentSession.expires_at;
        var now = Date.now();
        var needRefresh = expiresAt && (now / 1000 > expiresAt - 90);
        if (needRefresh && now - lastRefreshAt > REFRESH_COOLDOWN_MS) {
            lastRefreshAt = now;
            try {
                var refresh = await supabaseClient.auth.refreshSession();
                if (refresh.data.session) {
                    currentSession = refresh.data.session;
                    return currentSession.access_token;
                }
            } catch (e) {
                if (isRefreshTokenError(e)) {
                    currentSession = null;
                    supabaseClient.auth.signOut().catch(function() {});
                }
            }
        }
        return currentSession.access_token;
    }
    var result;
    try {
        result = await supabaseClient.auth.getSession();
    } catch (e) {
        if (isRefreshTokenError(e)) {
            currentSession = null;
            supabaseClient.auth.signOut().catch(function() {});
        }
        return null;
    }
    var session = result.data.session;
    if (!session || !session.access_token) return null;
    currentSession = session;
    var now = Date.now();
    var expiresAt = session.expires_at;
    var needRefresh = expiresAt && (now / 1000 > expiresAt - 90);
    if (needRefresh && now - lastRefreshAt > REFRESH_COOLDOWN_MS) {
        lastRefreshAt = now;
        try {
            var ref = await supabaseClient.auth.refreshSession();
            if (ref.data.session) {
                currentSession = ref.data.session;
                return currentSession.access_token;
            }
        } catch (e) {
            if (isRefreshTokenError(e)) {
                currentSession = null;
                supabaseClient.auth.signOut().catch(function() {});
            }
        }
    }
    return session.access_token;
};

// ============================================
// Funções de licenças (chamam a API Vercel)
// ============================================

async function licensesApiRequest(path, options) {
    var token = null;
    try { token = await window.getAdminAuthToken(); } catch (e) {}
    var url = (LICENSES_API_BASE || '') + path;
    var headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
        headers['X-Auth-Token'] = 'Bearer ' + token;
    }
    var method = (options && options.method) || 'GET';
    if (token && method === 'GET') {
        var sep = path.indexOf('?') >= 0 ? '&' : '?';
        url = url + sep + 'access_token=' + encodeURIComponent(token);
    }
    var res = await fetch(url, { ...options, headers: { ...headers, ...(options && options.headers) } });
    var data = null;
    var text = await res.text();
    if (text) try { data = JSON.parse(text); } catch (e) { data = { error: text }; }
    return { ok: res.ok, status: res.status, data: data };
}

async function testApiConnection() {
    try {
        var r = await licensesApiRequest('/api/listLicenses');
        if (r.status === 401) return { success: true, message: 'API acessível. Faça login.' };
        if (r.ok) return { success: true, message: 'Conexão com API OK' };
        return { success: false, message: r.data && r.data.error ? r.data.error : 'Erro de conexão.' };
    } catch (error) {
        return { success: false, message: 'Erro de conexão.' };
    }
}

async function saveLicenseToCloud(license) {
    try {
        var r = await licensesApiRequest('/api/createLicense', {
            method: 'POST',
            body: JSON.stringify({
                key: license.key, userName: license.userName || '', userPhone: license.userPhone || '',
                expiryDate: license.expiryDate, lifetime: license.lifetime === true,
                active: license.active, maxUses: license.maxUses || null,
                uses: license.uses || 0, ownerId: license.ownerId || null
            })
        });
        // Só retorna true quando a licença foi criada (201). 409 = chave já existe → ignorada na importação.
        return r.status === 201;
    } catch (error) { return false; }
}

async function getLicenseFromCloud(key) {
    try {
        var r = await licensesApiRequest('/api/getLicense?key=' + encodeURIComponent(key));
        if (r.ok && r.data && r.data.license) return r.data.license;
        return null;
    } catch (error) { return null; }
}

async function getAllLicensesFromCloud(ownerId) {
    try {
        var path = '/api/listLicenses';
        if (ownerId) path += '?ownerId=' + encodeURIComponent(ownerId);
        var r = await licensesApiRequest(path);
        if (r.ok && r.data && Array.isArray(r.data.licenses)) return r.data.licenses;
        return [];
    } catch (error) { return []; }
}

async function updateLicenseInCloud(key, updates) {
    try {
        var r = await licensesApiRequest('/api/updateLicense', {
            method: 'PUT',
            body: JSON.stringify({ key: key, ...updates })
        });
        return r.ok;
    } catch (error) { return false; }
}

async function deleteLicenseFromCloud(key) {
    try {
        var r = await licensesApiRequest('/api/deleteLicense?key=' + encodeURIComponent(key), { method: 'DELETE' });
        return r.ok;
    } catch (error) { return false; }
}

async function migrateUnassignedLicensesToOwner(ownerId) {
    return { migrated: 0 };
}

async function syncLicensesWithCloud() {
    try {
        var localLicenses = await licenseManager.getAllLicenses();
        var saved = 0;
        for (var j = 0; j < localLicenses.length; j++) {
            var result = await saveLicenseToCloud(localLicenses[j]);
            if (result) saved++;
        }
        return { success: true, message: 'Sincronizadas ' + saved + ' licenças' };
    } catch (error) { return { success: false, message: 'Erro ao sincronizar.' }; }
}

