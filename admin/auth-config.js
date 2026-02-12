/**
 * Configuração do Painel Admin - Lovable Infinity
 * Autenticação via Firebase Auth + API de licenças via Vercel
 */

/** URLs dos endpoints de gestão de usuários do painel */
var CREATE_PANEL_USER_API_URL = "https://lovable-infinity-panel.vercel.app/api/createPanelUser";
var LIST_PANEL_USERS_API_URL = "https://lovable-infinity-panel.vercel.app/api/listPanelUsers";
var UPDATE_PANEL_USER_API_URL = "https://lovable-infinity-panel.vercel.app/api/updatePanelUser";
var DELETE_PANEL_USER_API_URL = "https://lovable-infinity-panel.vercel.app/api/deletePanelUser";
var PUBLISH_EXTENSION_RELEASE_API_URL = "https://lovable-infinity-panel.vercel.app/api/publishExtensionRelease";

/** Firebase config */
var FIREBASE_CONFIG = {
    apiKey: "AIzaSyA0ngBmNA0rx6413aJwYMbNDwt9nZKm5gg",
    authDomain: "lovable2-e6f7f.firebaseapp.com",
    databaseURL: "https://lovable2-e6f7f-default-rtdb.firebaseio.com",
    projectId: "lovable2-e6f7f",
    storageBucket: "lovable2-e6f7f.firebasestorage.app",
    messagingSenderId: "943057084101",
    appId: "1:943057084101:web:c3e1f940b7c5fa2cbc1aac"
};

/** Base da API de licenças (Vercel) */
var LICENSES_API_BASE = "https://lovable-infinity-panel.vercel.app";

var firebaseApp = null;
var firebaseAuth = null;
var _authCurrentUser = null;

/**
 * Inicializar Firebase Auth
 */
async function initializeAuth() {
    if (firebaseApp) return true;
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        console.error('Firebase JS SDK não carregado');
        return false;
    }
    try {
        firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
        firebaseAuth = firebase.auth();
        return true;
    } catch (e) {
        console.error('Erro ao inicializar Firebase:', e);
        return false;
    }
}

function getAuth() {
    if (!firebaseAuth) return null;
    return {
        onAuthStateChanged: function(callback) {
            firebaseAuth.onAuthStateChanged(function(user) {
                if (user) {
                    _authCurrentUser = user;
                    callback({
                        uid: user.uid,
                        email: user.email || '',
                        displayName: user.displayName || user.email || '',
                        getIdToken: function() { return user.getIdToken(); }
                    });
                } else {
                    _authCurrentUser = null;
                    callback(null);
                }
            });
        },
        signInWithEmailAndPassword: async function(email, password) {
            var result = await firebaseAuth.signInWithEmailAndPassword(email, password);
            _authCurrentUser = result.user;
            return result;
        },
        createUserWithEmailAndPassword: async function(email, password) {
            var result = await firebaseAuth.createUserWithEmailAndPassword(email, password);
            _authCurrentUser = result.user;
            return result;
        },
        signOut: async function() {
            await firebaseAuth.signOut();
            _authCurrentUser = null;
        }
    };
}

/**
 * Obter token de autenticação para chamadas à API
 */
window.getAdminAuthToken = async function() {
    if (_authCurrentUser) {
        try {
            return await _authCurrentUser.getIdToken(false);
        } catch (e) {
            console.warn('Erro ao obter token:', e);
            return null;
        }
    }
    // Tentar obter do auth diretamente
    if (firebaseAuth && firebaseAuth.currentUser) {
        _authCurrentUser = firebaseAuth.currentUser;
        return await _authCurrentUser.getIdToken(false);
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
