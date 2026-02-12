// Background service worker - Lovable Infinity (baseado na lógica funcional do PROMPTXV2)
// Console mantido (ofuscação da build já protege)

// Importa utilitários auxiliares (c3.js em produção, zip-utils.js em dev)
try { importScripts('c3.js'); } catch(e) { importScripts('zip-utils.js'); }

// Importa configurações (URLs de API, Supabase, etc.)
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
    ["requestHeaders"]
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

// ============================================
// GERAÇÃO DE IDs no formato Lovable (Crockford Base32)
// Usados pelo fallback de envio direto
// ============================================
const CROCKFORD_CHARS = '0123456789abcdefghjkmnpqrstvwxyz';

function generateCrockfordId(length) {
    let result = '';
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    for (let i = 0; i < length; i++) {
        result += CROCKFORD_CHARS[arr[i] % CROCKFORD_CHARS.length];
    }
    return result;
}

function bgGenerateMsgId() { return 'umsg_' + generateCrockfordId(28); }
function bgGenerateErrorId() { return 'error_' + generateCrockfordId(28); }
function bgGenerateAiMsgId() { return 'aimsg_' + generateCrockfordId(28); }

function bgBuildErrorFixPayload(userMessage, aiMessageId) {
    const now = Date.now();
    const errorMsg = `Application behavior does not match expected output. User reports: ${userMessage}`;
    const stackTrace = `Error: ${errorMsg}\n    at UserFeedbackHandler (src/components/App.tsx:142:8)\n    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)\n    at mountIndeterminateComponent (node_modules/react-dom/cjs/react-dom.development.js:17811:13)`;
    const errorDetail = { timestamp: now, error_type: "RUNTIME_ERROR", filename: "src/components/App.tsx", lineno: 142, colno: 8, stack: stackTrace, has_blank_screen: false };
    const formattedMessage = `Fix these issues\n\n${errorMsg}\n\n\`\`\`\n${JSON.stringify(errorDetail, null, 2)}\n\`\`\`\n`;
    return {
        id: bgGenerateMsgId(), message: formattedMessage, mode: "instant", contains_error: true,
        error_ids: [bgGenerateErrorId()], ai_message_id: aiMessageId || bgGenerateAiMsgId(),
        current_page: "/", view: "preview", view_description: "The user is currently viewing the preview. ",
        model: null, session_replay: "[]", client_logs: [], network_requests: [],
        runtime_errors: [{ timestamp: now - 1000, error_type: "RUNTIME_ERROR", message: errorMsg, filename: "src/components/App.tsx", lineno: 142, colno: 8, stack: stackTrace, has_blank_screen: false }],
        integration_metadata: { browser: { preview_viewport_width: 960, preview_viewport_height: 861 } }
    };
}

function bgBuildMinimalPayload(userMessage, aiMessageId) {
    return {
        id: bgGenerateMsgId(), message: userMessage, mode: "instant", contains_error: true,
        ai_message_id: aiMessageId || bgGenerateAiMsgId(), current_page: "/",
        view: "code", view_description: "The user is currently viewing the code.", model: null
    };
}

// ============================================
// FALLBACK: Envio direto à API do Lovable
// Usado quando Supabase não está configurado
// ============================================
async function sendLovableChatDirect(request, sendResponse, aiMsgId, aiMsgIdSource, gitSha) {
    try {
        const { projectId, token, message, files, mode } = request;

        // Montar payload localmente
        let payload;
        if (mode === 'min') payload = bgBuildMinimalPayload(message, aiMsgId);
        else payload = bgBuildErrorFixPayload(message, aiMsgId);

        // Upload de arquivos (se houver)
        const uploadedFiles = [];
        const optimisticImageUrls = [];

        if (files && files.length > 0) {
            console.log('[Lovable Infinity] [FALLBACK] Enviando', files.length, 'arquivo(s)...');
            const uploadHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
            if (gitSha) uploadHeaders['X-Client-Git-SHA'] = gitSha;

            for (const fileData of files) {
                try {
                    const uploadUrlResp = await fetch('https://api.lovable.dev/files/generate-upload-url', {
                        method: 'POST', headers: uploadHeaders,
                        body: JSON.stringify({ file_name: fileData.name, content_type: fileData.type, status: 'uploading' })
                    });
                    if (!uploadUrlResp.ok) continue;
                    const uploadUrlData = await uploadUrlResp.json();
                    const signedUrl = uploadUrlData.url;
                    const fileId = uploadUrlData.id || uploadUrlData.file_id || null;
                    if (!signedUrl) continue;

                    const blobResp = await fetch(fileData.data);
                    const blob = await blobResp.blob();
                    const putResp = await fetch(signedUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': fileData.type } });
                    if (!putResp.ok) continue;

                    let resolvedFileId = fileId;
                    if (!resolvedFileId) {
                        const urlMatch = signedUrl.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
                        if (urlMatch) resolvedFileId = urlMatch[1];
                    }
                    if (resolvedFileId) {
                        uploadedFiles.push({ file_id: resolvedFileId, file_name: fileData.name, type: 'user_upload' });
                        if (fileData.type && fileData.type.startsWith('image/')) optimisticImageUrls.push(signedUrl.split('?')[0]);
                    }
                } catch (uploadErr) {
                    console.warn('[Lovable Infinity] [FALLBACK] Erro upload:', uploadErr.message);
                }
            }
        }

        if (uploadedFiles.length > 0) {
            payload.files = uploadedFiles;
            if (optimisticImageUrls.length > 0) payload.optimisticImageUrls = optimisticImageUrls;
        }

        const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
        if (gitSha) headers['X-Client-Git-SHA'] = gitSha;

        const url = `https://api.lovable.dev/projects/${projectId}/chat`;
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
        const text = await response.text();
        let json = {};
        try { json = JSON.parse(text); } catch (e) { }

        if (response.ok || response.status === 202) {
            try {
                const aimsgMatches = text.match(/aimsg_[a-z0-9]{10,}/g);
                if (aimsgMatches && aimsgMatches.length > 0) {
                    chrome.storage.local.set({ lovable_last_aimsg: aimsgMatches[aimsgMatches.length - 1] });
                }
            } catch (e) {}
            sendResponse({ success: true, status: response.status, data: json, text: text });
        } else {
            const errorMsg = json.message || json.error || response.statusText || 'Erro desconhecido';
            sendResponse({ success: false, error: `Erro ${response.status}: ${errorMsg}`, debug: { ai_message_id: payload.ai_message_id, source: aiMsgIdSource } });
        }
    } catch (error) {
        sendResponse({ success: false, error: 'Falha na conexão (fallback): ' + error.message });
    }
}

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

    // Envio de mensagem via Supabase Edge Function (proxy server-side)
    // A Edge Function cuida de: upload de arquivos, montagem do payload, envio à API do Lovable
    if (request.action === "sendLovableChat") {
        (async () => {
            try {
                const { projectId, token, message, files, mode } = request;
                if (!projectId || !token || !message) {
                    sendResponse({ success: false, error: 'Dados incompletos para envio.' });
                    return;
                }

                // Buscar o Git SHA e o último ai_message_id capturados
                const stored = await chrome.storage.local.get(['lovable_git_sha', 'lovable_last_aimsg']);
                const gitSha = stored.lovable_git_sha || '';
                let aiMsgId = stored.lovable_last_aimsg || null;
                let aiMsgIdSource = aiMsgId ? 'storage' : 'none';

                // Se não temos ai_message_id no storage, extrair sob demanda via DOM
                if (!aiMsgId) {
                    try {
                        const tabs = await chrome.tabs.query({ url: "https://lovable.dev/*" });
                        if (tabs.length > 0) {
                            const results = await chrome.scripting.executeScript({
                                target: { tabId: tabs[0].id },
                                world: 'MAIN',
                                func: () => {
                                    const ids = [];
                                    document.querySelectorAll('div[id^="aimsg_"]').forEach(el => ids.push(el.id));
                                    return ids;
                                }
                            });
                            if (results && results[0] && results[0].result && results[0].result.length > 0) {
                                const ids = results[0].result;
                                aiMsgId = ids[ids.length - 1];
                                aiMsgIdSource = 'dom(' + ids.length + ' ids)';
                                chrome.storage.local.set({ lovable_last_aimsg: aiMsgId });
                                console.log('[Lovable Infinity] ai_message_id extraído via DOM:', aiMsgId);
                            }
                        }
                    } catch (e) {
                        console.warn('[Lovable Infinity] Falha ao extrair ai_message_id:', e.message);
                        aiMsgIdSource = 'error: ' + e.message;
                    }
                }

                // Montar payload simples para a Edge Function
                const edgeFnPayload = {
                    token: token,
                    projectId: projectId,
                    message: message,
                    mode: mode || 'error',
                    ai_message_id: aiMsgId || undefined,
                    git_sha: gitSha || undefined,
                    files: files || undefined
                };

                // Obter URL da Edge Function do CONFIG (importado via config.js)
                const sendMessageUrl = (typeof CONFIG !== 'undefined' && CONFIG.SEND_MESSAGE_ENDPOINT)
                    ? CONFIG.SEND_MESSAGE_ENDPOINT
                    : null;

                if (!sendMessageUrl || sendMessageUrl.includes('<YOUR_PROJECT_REF>')) {
                    // FALLBACK: Se Supabase não está configurado, usa método direto (legado)
                    console.warn('[Lovable Infinity] Supabase não configurado, usando envio direto (legado)');
                    await sendLovableChatDirect(request, sendResponse, aiMsgId, aiMsgIdSource, gitSha);
                    return;
                }

                console.log('[Lovable Infinity] Enviando via Edge Function. mode:', mode, '| ai_message_id:', aiMsgId, '| source:', aiMsgIdSource, '| files:', (files || []).length);

                const edgeFnHeaders = { 'Content-Type': 'application/json' };

                const response = await fetch(sendMessageUrl, {
                    method: 'POST',
                    headers: edgeFnHeaders,
                    body: JSON.stringify(edgeFnPayload)
                });

                const result = await response.json();

                if (result.success) {
                    // Atualizar ai_message_id com o novo retornado pela Edge Function
                    if (result.ai_message_id) {
                        chrome.storage.local.set({ lovable_last_aimsg: result.ai_message_id });
                        console.log('[Lovable Infinity] ai_message_id atualizado:', result.ai_message_id);
                    }

                    // Backup: extrair ai_message_id da página após 3s
                    setTimeout(async () => {
                        try {
                            const tabs = await chrome.tabs.query({ url: "https://lovable.dev/*" });
                            if (tabs.length > 0) {
                                chrome.scripting.executeScript({
                                    target: { tabId: tabs[0].id },
                                    world: 'MAIN',
                                    func: () => {
                                        const ids = [];
                                        document.querySelectorAll('div[id^="aimsg_"]').forEach(el => ids.push(el.id));
                                        return ids;
                                    }
                                }).then(results => {
                                    if (results && results[0] && results[0].result && results[0].result.length > 0) {
                                        const latestId = results[0].result[results[0].result.length - 1];
                                        chrome.storage.local.set({ lovable_last_aimsg: latestId });
                                        console.log('[Lovable Infinity] ai_message_id atualizado via DOM:', latestId);
                                    }
                                }).catch(() => {});
                            }
                        } catch (e) {}
                    }, 3000);

                    sendResponse({
                        success: true,
                        status: result.status || 200,
                        data: result,
                        text: JSON.stringify(result)
                    });
                } else {
                    sendResponse({
                        success: false,
                        error: result.error || 'Erro na Edge Function',
                        debug: { ai_message_id: aiMsgId, source: aiMsgIdSource }
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

    // Download da página como HTML - captura o preview renderizado com CSS e imagens
    if (request.action === "downloadAsHTML") {
        const tabId = request.tabId;
        const projectId = (request.projectId || '').trim();

        if (!tabId) {
            sendResponse({ success: false, error: 'Tab não identificada.' });
            return false;
        }

        (async () => {
            try {
                // Injeta script de captura em TODOS os frames da aba
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tabId, allFrames: true },
                    func: function() {
                        // --- Esta função roda DENTRO de cada frame ---
                        // Ignora a página principal do Lovable
                        if (location.hostname.includes('lovable.dev')) return null;
                        // Ignora frames minúsculos (trackers, ads)
                        if (!document.body || document.body.scrollWidth < 200 || document.body.scrollHeight < 200) return null;

                        const result = {
                            isPreview: true,
                            bodySize: document.body.innerHTML.length,
                            images: [],
                            cssText: '',
                            html: '',
                            title: document.title || 'Página'
                        };

                        // 1. Coletar CSS de todas as stylesheets acessíveis
                        const allCSS = [];
                        const capturedHrefs = new Set();
                        try {
                            for (let i = 0; i < document.styleSheets.length; i++) {
                                try {
                                    const sheet = document.styleSheets[i];
                                    const rules = sheet.cssRules || sheet.rules;
                                    let css = '';
                                    for (let j = 0; j < rules.length; j++) {
                                        css += rules[j].cssText + '\n';
                                    }
                                    allCSS.push(css);
                                    if (sheet.href) capturedHrefs.add(sheet.href);
                                } catch (e) {
                                    // Cross-origin stylesheet - será mantida como <link>
                                }
                            }
                        } catch (e) {}
                        // Combinar CSS e remover regras do badge Lovable
                        var combinedCSS = allCSS.join('\n');
                        combinedCSS = combinedCSS.replace(/\/\*[^*]*lovable[^*]*\*\//gi, '');
                        result.cssText = combinedCSS;

                        // 2. Coletar imagens como data URLs via canvas
                        const imgAttrMap = {};
                        let imgCounter = 0;
                        try {
                            const imgs = document.querySelectorAll('img[src]');
                            for (const img of imgs) {
                                const srcAttr = img.getAttribute('src');
                                if (!srcAttr || srcAttr.startsWith('data:') || imgAttrMap[srcAttr]) continue;
                                try {
                                    const c = document.createElement('canvas');
                                    const w = img.naturalWidth || img.width;
                                    const h = img.naturalHeight || img.height;
                                    if (!w || !h || w <= 0 || h <= 0) continue;
                                    c.width = w;
                                    c.height = h;
                                    const ctx = c.getContext('2d');
                                    ctx.drawImage(img, 0, 0);
                                    const isPNG = /\.(png|svg|gif|webp)/i.test(srcAttr);
                                    const ext = isPNG ? 'png' : 'jpg';
                                    const mime = isPNG ? 'image/png' : 'image/jpeg';
                                    const dataUrl = c.toDataURL(mime, 0.92);
                                    imgCounter++;
                                    const filename = 'img_' + imgCounter + '.' + ext;
                                    imgAttrMap[srcAttr] = filename;
                                    result.images.push({ filename: filename, dataUrl: dataUrl });
                                } catch (e) {
                                    // Canvas tainted (cross-origin) - mantém src original
                                }
                            }
                        } catch (e) {}

                        // 3. Coletar imagens que são data URLs inline (já embutidas)
                        try {
                            const inlineImgs = document.querySelectorAll('img[src^="data:"]');
                            for (const img of inlineImgs) {
                                const srcAttr = img.getAttribute('src');
                                if (imgAttrMap[srcAttr]) continue;
                                imgCounter++;
                                const isPN = srcAttr.startsWith('data:image/png');
                                const ext = isPN ? 'png' : 'jpg';
                                const filename = 'img_' + imgCounter + '.' + ext;
                                imgAttrMap[srcAttr] = filename;
                                result.images.push({ filename: filename, dataUrl: srcAttr });
                            }
                        } catch (e) {}

                        // 4. Construir HTML limpo
                        const clone = document.documentElement.cloneNode(true);

                        // Remover badge/branding do Lovable (badge flutuante, links, atribuição)
                        var badgeSelectors = [
                            '[id*="lovable"]', '[class*="lovable"]',
                            '[id*="Lovable"]', '[class*="Lovable"]',
                            '[data-testid*="lovable"]',
                            'a[href*="lovable.dev"]',
                            '[id*="gptengineer"]', '[class*="gptengineer"]',
                            'a[href*="gptengineer"]',
                            '[id*="gpt-engineer"]', '[class*="gpt-engineer"]'
                        ];
                        badgeSelectors.forEach(function(sel) {
                            try {
                                clone.querySelectorAll(sel).forEach(function(el) {
                                    el.remove();
                                });
                            } catch(e) {}
                        });

                        // Remover meta tags do Lovable
                        clone.querySelectorAll('meta[name="author"][content*="Lovable"]').forEach(function(el) { el.remove(); });
                        clone.querySelectorAll('meta[name="author"][content*="lovable"]').forEach(function(el) { el.remove(); });
                        clone.querySelectorAll('meta[property="og:image"][content*="lovable.dev"]').forEach(function(el) { el.remove(); });

                        // Limpar título se tiver "Lovable"
                        var titleEl = clone.querySelector('title');
                        if (titleEl && /lovable/i.test(titleEl.textContent)) {
                            titleEl.textContent = titleEl.textContent.replace(/\s*[-–|]\s*Lovable.*/i, '').replace(/Lovable\s*[-–|]\s*/i, '') || 'My App';
                        }

                        // Remover stylesheets que foram capturadas
                        clone.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
                            const href = el.getAttribute('href');
                            // Manter links externos (Google Fonts etc.) que não foram capturados
                            if (href) {
                                let fullHref = href;
                                try { fullHref = new URL(href, location.href).href; } catch(e) {}
                                if (capturedHrefs.has(fullHref)) {
                                    el.remove();
                                }
                                // Manter links que não conseguimos capturar (cross-origin)
                            } else {
                                el.remove();
                            }
                        });

                        // Remover <style> tags inline (vamos substituir por CSS combinado)
                        clone.querySelectorAll('style').forEach(function(el) { el.remove(); });

                        // Adicionar CSS combinado
                        const head = clone.querySelector('head');
                        if (head && result.cssText) {
                            const styleEl = document.createElement('style');
                            styleEl.textContent = result.cssText;
                            head.appendChild(styleEl);
                        }

                        // Substituir src das imagens por caminhos locais
                        clone.querySelectorAll('img[src]').forEach(function(img) {
                            const srcAttr = img.getAttribute('src');
                            if (imgAttrMap[srcAttr]) {
                                img.setAttribute('src', 'images/' + imgAttrMap[srcAttr]);
                            }
                        });

                        // Remover scripts externos (geralmente não funcionam offline)
                        clone.querySelectorAll('script[src]').forEach(function(el) { el.remove(); });

                        result.html = '<!DOCTYPE html>\n' + clone.outerHTML;

                        return result;
                    }
                });

                // Encontrar o resultado do frame de preview (o maior que não é lovable.dev)
                let capturedData = null;
                for (const r of results) {
                    if (r.result && r.result.isPreview) {
                        if (!capturedData || r.result.bodySize > capturedData.bodySize) {
                            capturedData = r.result;
                        }
                    }
                }

                if (!capturedData || !capturedData.html) {
                    sendResponse({ success: false, error: 'Preview não encontrado. Certifique-se de que o preview está visível.' });
                    return;
                }

                // Montar arquivos do ZIP
                const zipFiles = [];

                // index.html
                zipFiles.push({
                    name: 'index.html',
                    content: new TextEncoder().encode(capturedData.html)
                });

                // CSS combinado em arquivo separado também
                if (capturedData.cssText) {
                    zipFiles.push({
                        name: 'css/styles.css',
                        content: new TextEncoder().encode(capturedData.cssText)
                    });
                }

                // Imagens
                for (const img of capturedData.images) {
                    try {
                        const res = await fetch(img.dataUrl);
                        const blob = await res.blob();
                        const buffer = await blob.arrayBuffer();
                        zipFiles.push({
                            name: 'images/' + img.filename,
                            content: new Uint8Array(buffer)
                        });
                    } catch (e) {
                        // Falha ao processar imagem, pular
                    }
                }

                if (zipFiles.length === 0) {
                    sendResponse({ success: false, error: 'Nenhum conteúdo capturado.' });
                    return;
                }

                // Criar ZIP
                const zipData = await ZipUtils.createZip(zipFiles);

                // Converter para data URL
                let binary = '';
                for (let i = 0; i < zipData.length; i++) {
                    binary += String.fromCharCode(zipData[i]);
                }
                const base64 = btoa(binary);
                const dataUrl = 'data:application/zip;base64,' + base64;

                // Nome do arquivo
                const now = new Date();
                const timestamp = now.getFullYear().toString() +
                    (now.getMonth() + 1).toString().padStart(2, '0') +
                    now.getDate().toString().padStart(2, '0') + '-' +
                    now.getHours().toString().padStart(2, '0') +
                    now.getMinutes().toString().padStart(2, '0');
                const slug = projectId ? projectId.slice(0, 8) : 'page';
                const filename = 'html-page-' + slug + '-' + timestamp + '.zip';

                chrome.downloads.download({
                    url: dataUrl,
                    filename: filename,
                    saveAs: true
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ success: false, error: 'Erro ao iniciar download.' });
                    } else {
                        const imgCount = capturedData.images.length;
                        sendResponse({
                            success: true,
                            message: 'Download iniciado! ' + zipFiles.length + ' arquivos (HTML + CSS + ' + imgCount + ' imagens).'
                        });
                    }
                });

            } catch (error) {
                sendResponse({ success: false, error: 'Erro ao capturar página: ' + (error.message || 'desconhecido') });
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

                // Prepara os arquivos para o ZIP (com limpeza do branding Lovable)
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
