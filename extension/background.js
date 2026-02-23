// Background service worker - Lovable Infinity (baseado na lógica funcional do PROMPTXV2)
// Console mantido (ofuscação da build já protege)

// Importa utilitários e config (nomes de dev; no build o script substitui por c6.js e c1.js)
try { importScripts('zip-utils.js'); } catch(e) { console.warn('[Lovable Infinity] zip-utils.js não encontrado no service worker'); }
try { importScripts('config.js'); } catch(e) { console.warn('[Lovable Infinity] config.js não encontrado no service worker'); }

const LOVABLE_ORIGIN = 'https://lovable.dev';

// ============================================
// FUNÇÕES DE LIMPEZA DO BRANDING LOVABLE
// ============================================

/**
 * Remove referências ao Lovable de arquivos do projeto
 * @param {string} filename - Nome do arquivo
 * @param {string} content - Conteúdo do arquivo (texto)
 * @returns {string} - Conteúdo limpo
 */
function cleanLovableBranding(filename, content) {
    // index.html - limpa meta tags e títulos
    if (filename === 'index.html') {
        content = content
            // Título genérico
            .replace(/<title>Lovable App<\/title>/gi, '<title>My App</title>')
            .replace(/<title>.*Lovable.*<\/title>/gi, '<title>My App</title>')
            // Meta description
            .replace(/<meta\s+name="description"\s+content="Lovable Generated Project"\s*\/?>/gi, 
                '<meta name="description" content="My Application" />')
            // Meta author
            .replace(/<meta\s+name="author"\s+content="Lovable"\s*\/?>/gi, '')
            // Open Graph
            .replace(/<meta\s+property="og:title"\s+content="Lovable App"\s*\/?>/gi, 
                '<meta property="og:title" content="My App" />')
            .replace(/<meta\s+property="og:description"\s+content="Lovable Generated Project"\s*\/?>/gi, 
                '<meta property="og:description" content="My Application" />')
            .replace(/<meta\s+property="og:image"\s+content="https:\/\/lovable\.dev[^"]*"\s*\/?>/gi, '')
            // Twitter
            .replace(/<meta\s+name="twitter:site"\s+content="@Lovable"\s*\/?>/gi, '')
            .replace(/<meta\s+name="twitter:image"\s+content="https:\/\/lovable\.dev[^"]*"\s*\/?>/gi, '')
            // Limpa linhas vazias extras
            .replace(/\n\s*\n\s*\n/g, '\n\n');
    }
    
    // vite.config.ts - remove o lovable-tagger
    if (filename === 'vite.config.ts') {
        content = content
            // Remove import do lovable-tagger
            .replace(/import\s*{\s*componentTagger\s*}\s*from\s*["']lovable-tagger["'];\s*\n?/g, '')
            // Remove o plugin do array (várias formas possíveis)
            .replace(/,?\s*mode\s*===\s*["']development["']\s*&&\s*componentTagger\(\)/g, '')
            .replace(/mode\s*===\s*["']development["']\s*&&\s*componentTagger\(\)\s*,?/g, '')
            // Limpa array de plugins se ficou com vírgulas extras
            .replace(/\[\s*,/g, '[')
            .replace(/,\s*\]/g, ']')
            .replace(/,\s*,/g, ',');
    }
    
    // package.json - remove dependência do lovable-tagger
    if (filename === 'package.json') {
        try {
            const pkg = JSON.parse(content);
            // Remove das devDependencies
            if (pkg.devDependencies && pkg.devDependencies['lovable-tagger']) {
                delete pkg.devDependencies['lovable-tagger'];
            }
            // Remove das dependencies (caso esteja lá)
            if (pkg.dependencies && pkg.dependencies['lovable-tagger']) {
                delete pkg.dependencies['lovable-tagger'];
            }
            content = JSON.stringify(pkg, null, 2);
        } catch (e) {
            // Se falhar o parse, faz replace simples
            content = content.replace(/,?\s*"lovable-tagger":\s*"[^"]*"\s*,?/g, '');
        }
    }
    
    // README.md - substitui por um README genérico
    if (filename === 'README.md') {
        // Verifica se é o README padrão do Lovable
        if (content.includes('Welcome to your Lovable project') || content.includes('lovable.dev/projects')) {
            content = `# My Project

This project was bootstrapped with React + Vite + TypeScript.

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
\`\`\`

## Tech Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui components
`;
        }
    }
    
    return content;
}

/**
 * Esconde o badge do Lovable (#lovable-badge): em CSS adiciona a regra; em index.html injeta <style>.
 * Assim o download já vem sem marca e o PUT no Lovable (remover no site) também aplica.
 * @param {string} filename - Nome do arquivo (ex: src/index.css, index.html)
 * @param {string} content - Conteúdo do arquivo
 * @returns {string} - Conteúdo com a regra aplicada
 */
function commentOutBadgeInContent(filename, content) {
    if (typeof content !== 'string') return content;

    const badgeRule = '#lovable-badge { display: none !important; }';
    const styleTag = '<style id="lovable-infinity-hide-badge">' + badgeRule + '</style>';

    // 1) index.html: injeta <style> antes de </head> para garantir que o badge seja oculto ao publicar
    if (filename === 'index.html' || filename.endsWith('/index.html')) {
        if (content.includes('lovable-badge') && content.includes('display') && content.includes('none')) return content;
        if (content.includes('</head>')) {
            return content.replace('</head>', styleTag + '\n</head>');
        }
        if (content.includes('<head>')) {
            return content.replace('<head>', '<head>\n' + styleTag);
        }
        return content;
    }

    // 2) Qualquer .css: adiciona a regra no final se ainda não existir
    if (filename.endsWith('.css')) {
        if (content.includes('#lovable-badge')) return content;
        return content.trimEnd() + '\n\n/* Lovable Infinity: ocultar badge */\n' + badgeRule + '\n';
    }

    return content;
}

/**
 * Verifica se um arquivo deve ser completamente removido
 * @param {string} filename - Nome do arquivo
 * @returns {boolean} - true se deve ser removido
 */
function shouldRemoveFile(filename) {
    // Por enquanto, não removemos nenhum arquivo, apenas limpamos
    // Mas podemos adicionar arquivos específicos do Lovable aqui no futuro
    return false;
}

function isLovableTab(url) {
    if (!url) return false;
    try {
        const u = new URL(url);
        return u.origin === LOVABLE_ORIGIN;
    } catch (_) {
        return false;
    }
}

/** Habilita o side panel só em abas do Lovable; desabilita completamente nas demais. */
async function updateSidePanelForTab(tabId, url) {
    if (tabId == null) return;
    try {
        const enabled = isLovableTab(url);
        // Define enabled: false para impedir completamente a abertura fora do Lovable
        await chrome.sidePanel.setOptions({ tabId, path: 'popup.html', enabled });
    } catch (err) {
        // Ignora erros silenciosamente (aba pode ter sido fechada, etc.)
    }
}

// Side panel: abre ao clicar no ícone. Popup.js cuida da restrição visual.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Função auxiliar para injetar o content script se necessário
async function ensureContentScriptInjected(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { action: "ping" });
        return true;
    } catch (e) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ["content.js"]
            });
            return true;
        } catch (err) {
            return false;
        }
    }
}

// Interceptor de Token + Git SHA via webRequest (Manifest V3)
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const authHeader = details.requestHeaders.find(
            (header) => header.name.toLowerCase() === 'authorization'
        );
        if (authHeader && authHeader.value) {
            const token = authHeader.value.replace('Bearer ', '').trim();
            if (token.length > 20) {
                chrome.storage.local.set({ lovable_token: token });
                chrome.tabs.query({ url: "https://lovable.dev/*" }, (tabs) => {
                    tabs.forEach(t => {
                        chrome.tabs.sendMessage(t.id, { action: "tokenFound", token: token }).catch(() => { });
                    });
                });
            }
        }
        // Captura o X-Client-Git-SHA para uso no envio direto à API
        const gitShaHeader = details.requestHeaders.find(
            (header) => header.name.toLowerCase() === 'x-client-git-sha'
        );
        if (gitShaHeader && gitShaHeader.value) {
            chrome.storage.local.set({ lovable_git_sha: gitShaHeader.value });
        }
    },
    { urls: ["https://api.lovable.dev/*"] },
    ["requestHeaders", "extraHeaders"]
);

// Captura ai_message_id de POST /chat + payload completo de /chat e /report_error
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        // Só captura de abas reais (tabId > 0 exclui requisições da extensão)
        if (details.tabId <= 0 || details.method !== 'POST') return;
        if (!details.requestBody || !details.requestBody.raw || details.requestBody.raw.length === 0) return;

        try {
            const decoder = new TextDecoder();
            const bodyStr = decoder.decode(details.requestBody.raw[0].bytes);
            const body = JSON.parse(bodyStr);

            // === INTERCEPTA POST /chat ===
            if (details.url.includes('/chat')) {
                // Salva ai_message_id como antes
                if (body.ai_message_id && typeof body.ai_message_id === 'string' && body.ai_message_id.startsWith('aimsg_')) {
                    chrome.storage.local.set({ lovable_last_aimsg: body.ai_message_id });
                }
                // Salva payload completo do chat para análise
                const chatEntry = {
                    timestamp: Date.now(),
                    url: details.url,
                    body: body
                };
                chrome.storage.local.get({ lovable_chat_payloads: [] }, (stored) => {
                    const arr = stored.lovable_chat_payloads || [];
                    arr.push(chatEntry);
                    // Mantém só os últimos 20
                    if (arr.length > 20) arr.splice(0, arr.length - 20);
                    chrome.storage.local.set({ lovable_chat_payloads: arr });
                });
                console.log('[Lovable Infinity] POST /chat capturado:', JSON.stringify(body).substring(0, 300));
            }

            // === INTERCEPTA POST /report_error ===
            if (details.url.includes('/report_error')) {
                const errorEntry = {
                    timestamp: Date.now(),
                    url: details.url,
                    body: body
                };
                chrome.storage.local.get({ lovable_report_errors: [] }, (stored) => {
                    const arr = stored.lovable_report_errors || [];
                    arr.push(errorEntry);
                    if (arr.length > 20) arr.splice(0, arr.length - 20);
                    chrome.storage.local.set({ lovable_report_errors: arr });
                });
                console.log('[Lovable Infinity] POST /report_error capturado:', JSON.stringify(body).substring(0, 500));
            }
        } catch (e) { }
    },
    { urls: ["https://api.lovable.dev/*"] },
    ["requestBody"]
);

// Manipulador de mensagens
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ping") {
        sendResponse("pong");
        return;
    }

    // === DEBUG: Ler payloads capturados ===
    if (request.action === "getInterceptedData") {
        chrome.storage.local.get(['lovable_chat_payloads', 'lovable_report_errors'], (data) => {
            sendResponse({
                chatPayloads: data.lovable_chat_payloads || [],
                reportErrors: data.lovable_report_errors || []
            });
        });
        return true;
    }

    // === DEBUG: Limpar payloads capturados ===
    if (request.action === "clearInterceptedData") {
        chrome.storage.local.set({ lovable_chat_payloads: [], lovable_report_errors: [] });
        sendResponse({ ok: true });
        return;
    }

    // Popup/side panel pede o token que o background capturou (storage)
    if (request.action === "getToken") {
        chrome.storage.local.get(['lovable_token'], (data) => {
            const token = data.lovable_token || null;
            sendResponse({ token });
        });
        return true;
    }

    // Retorna o último ai_message_id capturado
    if (request.action === "getLastAiMsgId") {
        chrome.storage.local.get(['lovable_last_aimsg'], (data) => {
            sendResponse({ ai_message_id: data.lovable_last_aimsg || null });
        });
        return true;
    }

    // Ocultar marca d'água do preview: injeta CSS que esconde #lovable-badge em todos os frames
    if (request.action === "setWatermarkHidden") {
        const hide = request.hide === true;
        chrome.storage.local.set({ hideLovableWatermark: hide });
        const tabId = sender.tab?.id || request.tabId;
        if (tabId) {
            chrome.scripting.executeScript({
                target: { tabId, allFrames: true },
                func: (hide) => {
                    const id = 'lovable-infinity-hide-badge';
                    let el = document.getElementById(id);
                    if (hide) {
                        if (!el) {
                            el = document.createElement('style');
                            el.id = id;
                            el.textContent = '#lovable-badge { display: none !important; }';
                            (document.head || document.documentElement).appendChild(el);
                        }
                    } else {
                        if (el) el.remove();
                    }
                },
                args: [hide]
            }).then(() => sendResponse({ success: true })).catch((e) => sendResponse({ success: false, error: e.message }));
        } else {
            sendResponse({ success: true });
        }
        return true;
    }

    // Aplicar preferência de marca d'água na aba atual (chamado ao carregar a página)
    if (request.action === "applyWatermarkPreference") {
        const tabId = sender.tab?.id || request.tabId;
        chrome.storage.local.get(['hideLovableWatermark'], (data) => {
            const hide = data.hideLovableWatermark === true;
            if (!tabId || !hide) {
                sendResponse({ success: true });
                return;
            }
            chrome.scripting.executeScript({
                target: { tabId, allFrames: true },
                func: (hide) => {
                    const id = 'lovable-infinity-hide-badge';
                    let el = document.getElementById(id);
                    if (hide) {
                        if (!el) {
                            el = document.createElement('style');
                            el.id = id;
                            el.textContent = '#lovable-badge { display: none !important; }';
                            (document.head || document.documentElement).appendChild(el);
                        }
                    } else {
                        if (el) el.remove();
                    }
                },
                args: [hide]
            }).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: true }));
        });
        return true;
    }

    if (request.action === "sendWebhook") {
        fetch(request.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(request.payload)
        })
            .then(async (response) => {
                const text = await response.text();
                let json = {};
                try { json = JSON.parse(text); } catch (e) { }

                if (response.ok) {
                    sendResponse({ success: true, data: json, text: text });
                } else {
                    const errorMsg = json.message || response.statusText || "Erro desconhecido";
                    sendResponse({
                        success: false,
                        error: `Erro ${response.status}: ${errorMsg}`
                    });
                }
            })
            .catch((error) => {
                sendResponse({ success: false, error: "Falha na conexão: " + error.message });
            });

        return true;
    }

    if (request.action === "sendWebhookWithFile") {
        (async () => {
            try {
                let body;
                let headers = {};
                // Suporta múltiplos arquivos (request.files) e legado (request.file)
                const files = request.files || (request.file ? [request.file] : null);
                if (files && files.length > 0) {
                    const formData = new FormData();
                    for (let i = 0; i < files.length; i++) {
                        const f = files[i];
                        const res = await fetch(f.data);
                        const blob = await res.blob();
                        // Primeiro arquivo usa 'file', adicionais usam 'file_N'
                        const fieldName = i === 0 ? 'file' : `file_${i + 1}`;
                        formData.append(fieldName, blob, f.name);
                    }
                    for (const key in request.payload) {
                        formData.append(key, request.payload[key]);
                    }
                    body = formData;
                } else {
                    headers["Content-Type"] = "application/json";
                    body = JSON.stringify(request.payload);
                }
                const response = await fetch(request.url, {
                    method: "POST",
                    headers: headers,
                    body: body
                });
                const text = await response.text();
                let json = {};
                try { json = JSON.parse(text); } catch (e) { }
                if (response.ok) {
                    sendResponse({ success: true, data: json, text: text });
                } else {
                    sendResponse({ success: false, error: `Erro ${response.status}` });
                }
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    // Envio de mensagem via Supabase Edge Function send-message (direto → Lovable API)
    if (request.action === "sendLovableChat") {
        (async () => {
            try {
                const { projectId, token, message, files, mode } = request;
                if (!projectId || !token) {
                    sendResponse({ success: false, error: 'Dados incompletos para envio.' });
                    return;
                }
                if (!message && (!files || files.length === 0)) {
                    sendResponse({ success: false, error: 'Informe uma mensagem ou anexe arquivos.' });
                    return;
                }

                const sendMessageUrl = (typeof CONFIG !== 'undefined' && CONFIG.SEND_MESSAGE_ENDPOINT)
                    ? CONFIG.SEND_MESSAGE_ENDPOINT
                    : null;

                if (!sendMessageUrl) {
                    sendResponse({ success: false, error: 'Endpoint de envio não configurado.' });
                    return;
                }

                // Buscar sessionToken, licenseKey, ai_message_id e git_sha
                const stored = await chrome.storage.local.get(['sessionToken', 'licenseKey', 'lovable_last_aimsg', 'lovable_git_sha']);

                if (!stored.sessionToken && !stored.licenseKey) {
                    sendResponse({ success: false, error: 'Sessão expirada. Faça login novamente.' });
                    return;
                }

                const payload = {
                    message: message,
                    projectId: projectId,
                    token: token,
                    mode: mode || 'error',
                    ai_message_id: stored.lovable_last_aimsg || undefined,
                    git_sha: stored.lovable_git_sha || undefined,
                    files: (files && files.length > 0) ? files : undefined
                };
                const licenseKey = request.licenseKey || stored.licenseKey;
                if (licenseKey) payload.licenseKey = licenseKey;
                const deviceFingerprint = request.deviceFingerprint || stored.deviceFingerprint;
                if (deviceFingerprint) payload.deviceFingerprint = deviceFingerprint;

                const headers = {
                    'Content-Type': 'application/json'
                };
                if (stored.sessionToken) {
                    headers['Authorization'] = 'Bearer ' + stored.sessionToken;
                }
                const supabaseAnonKey = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_ANON_KEY) ? CONFIG.SUPABASE_ANON_KEY : '';
                if (supabaseAnonKey) headers['apikey'] = supabaseAnonKey;

                const response = await fetch(sendMessageUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (result.success) {
                    // Atualizar ai_message_id se veio novo na resposta
                    if (result.ai_message_id) {
                        chrome.storage.local.set({ lovable_last_aimsg: result.ai_message_id });
                    }
                    sendResponse({
                        success: true,
                        status: result.status || 200,
                        data: result,
                        text: JSON.stringify(result)
                    });
                } else {
                    sendResponse({
                        success: false,
                        error: result.error || 'Erro no envio da mensagem'
                    });
                }
            } catch (error) {
                sendResponse({ success: false, error: 'Falha na conexão: ' + error.message });
            }
        })();
        return true;
    }

    if (request.action === "toggleChatMode") {
        const { projectId, token, enabled } = request;
        fetch(`https://api.lovable.dev/projects/${projectId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ chat_mode_enabled: enabled })
        })
            .then(async (response) => {
                const text = await response.text();
                if (response.ok) {
                    sendResponse({ success: true, text });
                } else {
                    sendResponse({ success: false, error: `Erro Lovable ${response.status}` });
                }
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    // Remover marca d'água no Lovable — fluxo idêntico ao PromptX 3.1: GET files/raw + POST edit-code.
    if (request.action === "removeWatermarkInLovable") {
        let projectId = (request.projectId || '').trim();
        let token = (request.token || '').trim();
        (async () => {
            let responded = false;
            const safeSend = (obj) => {
                if (responded) return;
                responded = true;
                clearTimeout(guard);
                sendResponse(obj);
            };
            const guard = setTimeout(function () {
                safeSend({ success: false, error: 'Não foi possível remover a marca d\'água.' });
            }, 25000);
            try {
                // Usar sempre o projeto da aba ativa (evita projeto errado ao trocar de aba)
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (activeTab && activeTab.url && activeTab.url.includes('lovable.dev')) {
                    const match = activeTab.url.match(/projects\/([a-zA-Z0-9-]+)/);
                    if (match && match[1]) projectId = match[1];
                }
                if (!token) {
                    const stored = await chrome.storage.local.get(['lovable_token']);
                    token = (stored.lovable_token || '').trim();
                }
                if (!projectId || !token) {
                    safeSend({ success: false, error: 'Projeto ou token ausente. Abra a aba do projeto no Lovable e tente de novo.' });
                    return;
                }
                const authHeaders = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'Content-Type': 'application/json' };
                const badgeRule = '\n\n#lovable-badge {\n  display: none !important;\n}\n';
                const editUrl = `https://api.lovable.dev/projects/${projectId}/edit-code`;
                let lastError = '';
                const preferredPaths = [
                    'src/index.css',
                    'index.css',
                    'app/globals.css',
                    'src/globals.css',
                    'src/styles/global.css',
                    'src/App.css',
                    'src/styles.css'
                ];
                const editWithContent = async (cssPath, cssText) => {
                    if (cssText.includes('#lovable-badge') && cssText.includes('display') && cssText.includes('none')) {
                        return { ok: true, already: true };
                    }
                    const newContent = cssText.trimEnd() + badgeRule;
                    const editBody = { changes: [{ path: cssPath, content: newContent }], uploads: [], commit_message: 'Hide Lovable badge', file_edit_type: 'CodeEdit' };
                    const editCtrl = new AbortController();
                    const editT = setTimeout(function () { editCtrl.abort(); }, 12000);
                    try {
                        const editRes = await fetch(editUrl, { method: 'POST', headers: authHeaders, body: JSON.stringify(editBody), signal: editCtrl.signal });
                        clearTimeout(editT);
                        if (editRes.ok) {
                            return { ok: true };
                        }
                        const text = await editRes.text().catch(() => '');
                        lastError = `edit-code ${editRes.status}${text ? ' - ' + text : ''}`;
                        return { ok: false };
                    } catch (editErr) {
                        clearTimeout(editT);
                        if (editErr.name === 'AbortError') {
                            lastError = 'edit-code timeout';
                        } else {
                            lastError = editErr.message || 'edit-code error';
                        }
                        return { ok: false };
                    }
                };
                const tryRawPath = async (cssPath) => {
                    const rawUrl = `https://api.lovable.dev/projects/${projectId}/files/raw?path=${encodeURIComponent(cssPath)}`;
                    const rawCtrl = new AbortController();
                    const rawT = setTimeout(function () { rawCtrl.abort(); }, 12000);
                    try {
                        const rawRes = await fetch(rawUrl, { method: 'GET', headers: authHeaders, signal: rawCtrl.signal });
                        clearTimeout(rawT);
                        if (!rawRes.ok) return { ok: false };
                        const cssText = await rawRes.text();
                        return await editWithContent(cssPath, cssText);
                    } catch (rawErr) {
                        clearTimeout(rawT);
                        if (rawErr.name === 'AbortError') {
                            lastError = 'files/raw timeout';
                        }
                        return { ok: false };
                    }
                };
                let sourceFiles = null;
                try {
                    const srcRes = await fetch(`https://api.lovable.dev/projects/${projectId}/source-code`, { method: 'GET', headers: authHeaders });
                    if (srcRes.ok) {
                        const srcData = await srcRes.json();
                        if (srcData.files && Array.isArray(srcData.files)) {
                            sourceFiles = srcData.files;
                        }
                    } else {
                        lastError = `source-code ${srcRes.status}`;
                    }
                } catch (e) {
                    lastError = e.message || 'source-code error';
                }
                if (sourceFiles) {
                    const normalized = sourceFiles
                        .filter(f => f && f.name && f.name.toLowerCase().endsWith('.css'))
                        .map(f => ({ name: f.name, contents: f.contents, sizeExceeded: f.sizeExceeded }));
                    const byName = (name) => normalized.find(f => f.name === name);
                    const ordered = [];
                    for (const p of preferredPaths) {
                        const found = byName(p);
                        if (found) ordered.push(found);
                    }
                    const indexLike = normalized.find(f => f.name.endsWith('/index.css') || f.name === 'index.css');
                    if (indexLike && !ordered.some(f => f.name === indexLike.name)) ordered.push(indexLike);
                    for (const f of normalized) {
                        if (!ordered.some(o => o.name === f.name)) ordered.push(f);
                    }
                    for (const f of ordered) {
                        if (f.sizeExceeded || f.contents == null) {
                            const rawAttempt = await tryRawPath(f.name);
                            if (rawAttempt.ok) {
                                safeSend({ success: true, message: 'Marca d\'água removida.' });
                                return;
                            }
                            continue;
                        }
                        const text = typeof f.contents === 'string' ? f.contents : '';
                        const editAttempt = await editWithContent(f.name, text);
                        if (editAttempt.ok) {
                            safeSend({ success: true, message: 'Marca d\'água removida.' });
                            return;
                        }
                    }
                } else {
                    for (const cssPath of preferredPaths) {
                        const rawAttempt = await tryRawPath(cssPath);
                        if (rawAttempt.ok) {
                            safeSend({ success: true, message: 'Marca d\'água removida.' });
                            return;
                        }
                    }
                }
                safeSend({ success: false, error: lastError ? `Não foi possível remover a marca d'água. (${lastError})` : 'Não foi possível remover a marca d\'água.' });
            } catch (e) {
                if (!responded) safeSend({ success: false, error: 'Não foi possível remover a marca d\'água.' });
            }
        })();
        return true;
    }

    // Download de projeto - busca código-fonte via API do Lovable e gera ZIP
    if (request.action === "downloadProject") {
        const projectId = (request.projectId || '').trim();
        const token = (request.token || '').trim();

        if (!projectId || !token) {
            sendResponse({ success: false, error: 'Projeto ou token ausente.' });
            return false;
        }

        (async () => {
            try {
                // Chama a API do Lovable para obter o código-fonte
                const apiUrl = `https://api.lovable.dev/projects/${projectId}/source-code`;
                const response = await fetch(apiUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    if (response.status === 401) {
                        sendResponse({ success: false, error: 'Token expirado. Recarregue a página do Lovable.' });
                        return;
                    }
                    if (response.status === 403) {
                        sendResponse({ success: false, error: 'Sem permissão para acessar este projeto.' });
                        return;
                    }
                    if (response.status === 404) {
                        sendResponse({ success: false, error: 'Projeto não encontrado.' });
                        return;
                    }
                    sendResponse({ success: false, error: `Erro da API: ${response.status}` });
                    return;
                }

                const data = await response.json();
                
                if (!data.files || !Array.isArray(data.files)) {
                    sendResponse({ success: false, error: 'Resposta da API inválida.' });
                    return;
                }

                // Prepara os arquivos para o ZIP (com limpeza do branding Lovable e comentário do badge)
                const zipFiles = [];
                let skippedFiles = 0;
                let cleanedFiles = 0;

                for (const file of data.files) {
                    // Pula arquivos que excederam o tamanho
                    if (file.sizeExceeded) {
                        skippedFiles++;
                        continue;
                    }

                    // Pula arquivos sem conteúdo
                    if (file.contents === null || file.contents === undefined) {
                        continue;
                    }

                    // Verifica se o arquivo deve ser removido
                    if (shouldRemoveFile(file.name)) {
                        continue;
                    }

                    let content;
                    if (file.binary) {
                        // Decodifica base64 para binário (não limpa binários)
                        const binaryString = atob(file.contents);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        content = bytes;
                    } else {
                        // Texto: aplica limpeza do branding Lovable
                        let textContent = file.contents;
                        const originalLength = textContent.length;
                        
                        // Aplica limpeza baseada no nome do arquivo
                        textContent = cleanLovableBranding(file.name, textContent);
                        // Comenta tudo referente ao badge (não remove)
                        textContent = commentOutBadgeInContent(file.name, textContent);
                        
                        if (textContent.length !== originalLength) {
                            cleanedFiles++;
                        }
                        
                        content = new TextEncoder().encode(textContent);
                    }

                    zipFiles.push({
                        name: file.name,
                        content: content
                    });
                }

                if (zipFiles.length === 0) {
                    sendResponse({ success: false, error: 'Nenhum arquivo encontrado no projeto.' });
                    return;
                }

                // Cria o ZIP
                const zipData = await ZipUtils.createZip(zipFiles);
                
                // Converte para base64 data URL (URL.createObjectURL não funciona em Service Worker)
                let binary = '';
                for (let i = 0; i < zipData.length; i++) {
                    binary += String.fromCharCode(zipData[i]);
                }
                const base64 = btoa(binary);
                const dataUrl = `data:application/zip;base64,${base64}`;
                
                // Nome do arquivo com timestamp único (YYYYMMDD-HHmmss)
                const now = new Date();
                const timestamp = now.getFullYear().toString() +
                    (now.getMonth() + 1).toString().padStart(2, '0') +
                    now.getDate().toString().padStart(2, '0') + '-' +
                    now.getHours().toString().padStart(2, '0') +
                    now.getMinutes().toString().padStart(2, '0') +
                    now.getSeconds().toString().padStart(2, '0');
                const filename = `lovable-project-${projectId.slice(0, 8)}-${timestamp}.zip`;

                // Inicia o download
                chrome.downloads.download({
                    url: dataUrl,
                    filename: filename,
                    saveAs: true
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ success: false, error: 'Erro ao iniciar download.' });
                    } else {
                        sendResponse({ success: true, message: 'Download iniciado!' });
                    }
                });

            } catch (error) {
                sendResponse({ success: false, error: 'Erro ao baixar projeto: ' + (error.message || 'desconhecido') });
            }
        })();

        return true; // Indica resposta assíncrona
    }

    // Captura screenshot do preview do Lovable
    if (request.action === "capturePreviewScreenshot") {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab || !tab.id) {
                    sendResponse({ success: false, error: 'Nenhuma aba ativa encontrada.' });
                    return;
                }

                // Injeta content script se necessário
                await ensureContentScriptInjected(tab.id);

                // Pede ao content script para identificar o preview
                const previewInfo = await chrome.tabs.sendMessage(tab.id, { action: "capturePreview" });

                if (!previewInfo.success) {
                    sendResponse({ success: false, error: previewInfo.error || 'Não foi possível identificar o preview.' });
                    return;
                }

                if (previewInfo.needsCapture && previewInfo.bounds) {
                    // Captura a aba visível (null = janela atual)
                    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
                    
                    // Cria um canvas offscreen para recortar a área do preview
                    const response = await fetch(dataUrl);
                    const blob = await response.blob();
                    const imageBitmap = await createImageBitmap(blob);
                    
                    const { x, y, width, height } = previewInfo.bounds;
                    const devicePixelRatio = request.devicePixelRatio || 1;
                    
                    const canvas = new OffscreenCanvas(
                        Math.round(width * devicePixelRatio),
                        Math.round(height * devicePixelRatio)
                    );
                    const ctx = canvas.getContext('2d');
                    
                    ctx.drawImage(
                        imageBitmap,
                        Math.round(x * devicePixelRatio),
                        Math.round(y * devicePixelRatio),
                        Math.round(width * devicePixelRatio),
                        Math.round(height * devicePixelRatio),
                        0,
                        0,
                        canvas.width,
                        canvas.height
                    );
                    
                    const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        sendResponse({ success: true, dataUrl: reader.result });
                    };
                    reader.onerror = () => {
                        sendResponse({ success: false, error: 'Erro ao processar imagem.' });
                    };
                    reader.readAsDataURL(croppedBlob);
                } else {
                    sendResponse({ success: false, error: 'Preview não encontrado.' });
                }
            } catch (error) {
                sendResponse({ success: false, error: error.message || 'Erro ao capturar screenshot.' });
            }
        })();
        return true;
    }
});

// Reaplicar ocultação da marca d'água quando uma aba do Lovable termina de carregar (preview/iframe pode carregar depois)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url || !tab.url.startsWith('https://lovable.dev/')) return;
    chrome.storage.local.get(['hideLovableWatermark'], (data) => {
        if (data.hideLovableWatermark !== true) return;
        chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: (hide) => {
                const id = 'lovable-infinity-hide-badge';
                let el = document.getElementById(id);
                if (hide && !el) {
                    el = document.createElement('style');
                    el.id = id;
                    el.textContent = '#lovable-badge { display: none !important; }';
                    (document.head || document.documentElement).appendChild(el);
                }
            },
            args: [true]
        }).catch(() => {});
    });
});
