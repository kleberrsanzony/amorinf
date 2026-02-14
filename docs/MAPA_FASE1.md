# Mapa da Fase 1 – Leitura completa do código

Documento gerado pela revisão geral. Referência rápida do que cada parte do projeto faz.

## 1.1 Raiz e configuração

| Arquivo | Conteúdo |
|---------|----------|
| **package.json** | name: lovable-infinity, version: 3.5.1. Scripts: `build` (scripts/build.js), `reset-master` (reset-and-create-master.js). Deps: @supabase/supabase-js, jsonwebtoken, jose. DevDeps: dotenv, archiver, javascript-obfuscator. engines: node >=14. |
| **vercel.json** | outputDirectory: admin. functions: api/extensionRelease.js com includeFiles admin/version.json. headers: /api/* → CORS (Origin *, Methods GET,POST,PUT,DELETE,OPTIONS, Headers Content-Type, Authorization, X-Auth-Token). Nota: PATCH necessário para updatePanelUser. |
| **.gitignore** | extension-prod/build, LOVABLE_INFINITY*.zip, admin/downloads, node_modules, .env, .env.*, supabase/.temp, .vercel, .firebase, etc. |
| **.env / .env.example** | Variáveis locais (não commitadas). Exemplo: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET. |

## 1.2 API Vercel (api/)

Todos os handlers: OPTIONS → CORS 204; token via verifyToken(req); resposta JSON via função json(res, status, data).

| Handler | Método | Supabase | Observação |
|---------|--------|----------|------------|
| listLicenses | GET | from('licenses').select('*').order('created_at').eq('owner_id', q) | toLicense: key, userName, userPhone, created, expiryDate, lifetime, active, activated, activatedDate, maxUses, uses, ownerId, activatedDevices. |
| createLicense | POST | from('licenses').insert(fullRow/basicRow) | fullRow inclui user_phone, owner_id; fallback sem essas colunas. |
| getLicense | GET | from('licenses').select().eq('key', key).single() | |
| updateLicense | PUT | from('licenses').update(updates).eq('key', key) | Fallback sem user_phone/owner_id se der erro. |
| deleteLicense | DELETE | from('licenses').delete().eq('key', key) | key por query ou body. |
| listPanelUsers | GET | auth.admin.listUsers() | Retorna users com uid, email, displayName, disabled, validUntil, createdAt. |
| createPanelUser | POST | auth.admin.createUser() | email, password, display_name, email_confirm: true. |
| updatePanelUser | PATCH | auth.admin.updateUserById(uid, updateData) | email, user_metadata, password, ban_duration. |
| deletePanelUser | DELETE | auth.admin.deleteUser(uid) | Não permite apagar a si mesmo. |
| extensionRelease | GET | Lê admin/version.json do filesystem | version, publishedAt, filename. |
| authDebug | GET | verifyWithJwks, verifyWithJwtSecret, fetch /auth/v1/user | Diagnóstico: envOk, tokenReceived, verification, userId. **Proteger em produção.** |

**_lib**: verifyToken (JWKS → JWT Secret → getUser → verifyViaAuthServer). verifyJwks (jose, createRemoteJWKSet, issuer ES256/RS256). verifyJwtSecret (jsonwebtoken HS256). supabaseClient (createClient com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY).

Colunas usadas em licenses (API + migrations): key, user_name, user_phone, expiry_date, lifetime, active, max_uses, uses, activated, created_at, updated_at, owner_id, activated_device_fingerprint, activated_date, last_access_date, active_session_device, active_session_last_ping.

## 1.3 Painel admin (admin/)

| Arquivo | Conteúdo |
|---------|----------|
| **index.html** | Login (login-form, login-email, login-password). Abas: tab-licenses, tab-admin (master only). Topbar: Criar licença, Sair. Barra extensão: extension-version, extension-updated-at, btn-download-extension. main-licenses: stats-grid, search-licenses, licenses-tbody, modais criar/editar/confirm/import-export/extension-release. main-admin: usuários do painel, criar usuário. |
| **auth-config.js** | API_BASE = window.location.origin. SUPABASE_URL, SUPABASE_ANON_KEY. initializeAuth(), getAuth() (onAuthStateChanged, signIn, signUp, signOut). getAdminAuthToken() (currentSession ou getSession, refresh com cooldown 60s). licensesApiRequest(path, options): token em Authorization, X-Auth-Token e em GET ?access_token=. saveLicenseToCloud, getLicenseFromCloud, getAllLicensesFromCloud, updateLicenseInCloud, deleteLicenseFromCloud. |
| **admin.js** | currentUser, allLicensesCache, licenseManager. loadMain: setOwnerId, loadLicenses, getStats, renderTable. loadPanelUsers (LIST_PANEL_USERS_API_URL). CRUD licenças (modais, submitCreateLicense, submitEditLicense, etc.). checkExtensionRelease (/api/extensionRelease + fallback /version.json). Aba Admin: só para master (MASTER_EMAILS). |
| **license-manager.js** | STORAGE_KEY master_lovable_licenses. init/loadLicenses: chrome.storage ou getAllLicensesFromCloud(ownerId). generateLicense (MLI-xxx-xxx-xxx), saveLicenses, validateLicense, activateLicense, editLicense, deleteLicense, getStats. Na web: saveLicenseToCloud, getLicenseFromCloud, updateLicenseInCloud, deleteLicenseFromCloud. |
| **voice-recorder.html** | Página para gravação de voz (HTTPS). |
| **version.json** | Gerado pelo build (version, date, filename). |
| **styles.css** | (link no index; se não existir, estilos inline no index.) |

## 1.4 Extensão (extension-prod/)

| Arquivo | Conteúdo |
|---------|----------|
| **manifest.json** | MV3. Permissions: activeTab, alarms, downloads, scripting, sidePanel, storage, system.cpu, tabs, webRequest. host_permissions: <all_urls>. background: background.js. side_panel: popup.html. content_scripts: lovable.dev → content.js. |
| **config.js** | SUPABASE_URL, SUPABASE_ANON_KEY. Endpoints: SEND_PROMPT_ENDPOINT, VALIDATE_LICENSE_ENDPOINT, IMPROVE_PROMPT_ENDPOINT, VERIFY_SESSION_ENDPOINT, REFRESH_SESSION_ENDPOINT. validateKeySecure(key) → validate-license. getSessionToken(), tryRefreshSession(), verifySessionWithServer(). |
| **auth.js** | Form auth-form, validateKey → validateKeySecure. On success: storage (licenseKey, isAuthenticated, sessionToken, refreshToken, etc.), redirect popup. |
| **background.js** | importScripts c3.js (build) ou zip-utils.js. cleanLovableBranding, shouldRemoveFile. Action sendMessage: obtém token/sessão, chama Supabase send-prompt (N8N). Sem chamadas à API Vercel (confirmado: nenhuma referência a vercel.app ou /api/ em extension-prod). |
| **popup.js** | UI mensagem, anexos, envio via background sendMessage → Supabase send-prompt. |
| **content.js** | Injetado em lovable.dev. |
| **auth.html, popup.html** | Telas de login e popup. |
| **voice-permission.js, zip-utils.js** | Utilitários. |

## 1.5 Supabase: migrations e schema

| Migração | Conteúdo |
|----------|----------|
| **20260212000000_create_licenses_table.sql** | CREATE TABLE licenses (key TEXT PK, active, lifetime, expiry_date, max_uses, uses, user_name, activated_device_fingerprint, activated_date, last_access_date, active_session_device, active_session_last_ping, activated, created_at, updated_at). Índice idx_licenses_device. Trigger updated_at. RLS enabled. |
| **20260213000000_add_user_phone_owner_id.sql** | ALTER licenses ADD user_phone, owner_id. CREATE INDEX idx_licenses_owner. |
| **20260210120000_security_rate_limit_nonces.sql** | rate_limit_log (license_key, created_at), used_nonces (nonce PK, used_at). |

Não há tabelas "clientes" ou "sócios" no repositório; apenas licenses e Auth users.

## 1.6 Supabase: Edge Functions

| Módulo | Conteúdo |
|--------|----------|
| **_shared/cors.ts** | CORS_HEADERS, corsResponse(), jsonResponse(), errorResponse(). |
| **_shared/jwt.ts** | JWT_SECRET, createSession (licenseKey, deviceFingerprint), verifyJwt, requireSession (Authorization Bearer). getLicense, updateLicense para last_access_date, active_session_*. |
| **_shared/supabase.ts** | getSupabaseClient(), getLicense(key), updateLicense(key, updates). Tabela licenses. |
| **validate-license** | POST body: licenseKey, deviceFingerprint. getLicense, valida active/lifetime/expiry/max_uses/sessão outro dispositivo. createSession, updateLicense (activated, activated_date, etc.). Retorna sessionToken, refreshToken, expiresAt. |
| **send-prompt** | requireSession. Body: message, projectId, token (Lovable), files. N8N_WEBHOOK_URL. Envio JSON ou FormData para N8N. |
| **send-message** | Fluxo com arquivos (webhook); ver docs/ENVIO_ARQUIVOS. |
| **enhance-prompt** | Melhorador de prompt + transcrição. |
| **verify-session** | Valida JWT de sessão, atualiza last_ping. |
| **refresh-session** | Refresh token → novo sessionToken. |
| **config.toml** | [functions.*] verify_jwt = true. Deploy produção: --no-verify-jwt. |

## 1.7 Scripts e docs

| Arquivo | Conteúdo |
|---------|----------|
| **scripts/build.js** | Incrementa versão, ofusca (c1–c6), injeta blindagem, gera ZIP, copia para admin/downloads, gera admin/version.json, executa vercel --prod. |
| **scripts/reset-and-create-master.js** | Limpa Auth users (exceto master), limpa licenses, cria usuário luan93dutra@gmail.com / 210293. Usa SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY. |
| **docs/ESTRUTURA_E_REGRAS_DO_PROJETO.md** | Arquitetura Vercel + Supabase, estrutura de pastas, regras de deploy e build. |
| **docs/ENVIO_ARQUIVOS (1).md** | Fluxo extensão → send-message (Edge Function) → N8N com FormData/JSON. |
