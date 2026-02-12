/**
 * Configuração do Painel Admin - Lovable Infinity
 * Autenticação via Supabase Auth + API de licenças via Vercel
 */

/** URLs dos endpoints de gestão de usuários do painel */
var CREATE_PANEL_USER_API_URL = "https://lovable-infinity-panel.vercel.app/api/createPanelUser";
var LIST_PANEL_USERS_API_URL = "https://lovable-infinity-panel.vercel.app/api/listPanelUsers";
var UPDATE_PANEL_USER_API_URL = "https://lovable-infinity-panel.vercel.app/api/updatePanelUser";
var DELETE_PANEL_USER_API_URL = "https://lovable-infinity-panel.vercel.app/api/deletePanelUser";
var PUBLISH_EXTENSION_RELEASE_API_URL = "https://lovable-infinity-panel.vercel.app/api/publishExtensionRelease";

/** Supabase config */
var SUPABASE_URL = "https://svjglgrxqxqtonoobcdi.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2amdsZ3J4cXhxdG9ub29iY2RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNjUyMDMsImV4cCI6MjA4NTg0MTIwM30.6adWdnXXlrD_-6nrzdcviyKfVuBjWo57piuedOFdG0o";

/** Base da API de licenças (Vercel) */
var LICENSES_API_BASE = "https://lovable-infinity-panel.vercel.app";

var supabaseClient = null;
var currentSession = null;

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

function getAuth() {
    if (!supabaseClient) return null;
    return {
        onAuthStateChanged: function(callback) {
            supabaseClient.auth.getSession().then(function(result) {
                currentSession = result.data.session;
                if (currentSession && currentSession.user) {
                    callback(_wrapUser(currentSession.user, currentSession.access_token));
                } else {
                    callback(null);
                }
            });
            supabaseClient.auth.onAuthStateChange(function(event, session) {
                currentSession = session;
                if (session && session.user) {
                    callback(_wrapUser(session.user, session.access_token));
                } else {
                    callback(null);
                }
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

function _wrapUser(user, accessToken) {
    return {
        uid: user.id,
        email: user.email || '',
        displayName: (user.user_metadata && user.user_metadata.full_name) || user.email || '',
        getIdToken: function() { return Promise.resolve(accessToken); }
    };
}

/**
 * Obter token de autenticação para chamadas à API
 */
window.getAdminAuthToken = async function() {
    if (currentSession && currentSession.access_token) {
        var expiresAt = currentSession.expires_at;
        if (expiresAt && Date.now() / 1000 > expiresAt - 60) {
            var result = await supabaseClient.auth.refreshSession();
            if (result.data.session) currentSession = result.data.session;
        }
        return currentSession.access_token;
    }
    var result = await supabaseClient.auth.getSession();
    if (result.data.session) {
        currentSession = result.data.session;
        return currentSession.access_token;
    }
    return null;
};

// ============================================
// Funções de licenças (chamam a API Vercel)
// ============================================

async function licensesApiRequest(path, options) {
    var token = null;
    try { token = await window.getAdminAuthToken(); } catch (e) {}
    var url = (LICENSES_API_BASE || '') + path;
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
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
        return r.ok || (r.status === 409);
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

