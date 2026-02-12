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

                // Buscar sessionToken, ai_message_id e git_sha
                const stored = await chrome.storage.local.get(['sessionToken', 'lovable_last_aimsg', 'lovable_git_sha']);

                if (!stored.sessionToken) {
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

                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + stored.sessionToken
                };

                console.log('[Lovable Infinity PROD] Enviando via send-message. files:', (files || []).length);

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

    // Download da página como HTML - captura o preview renderizado com CSS, imagens, vídeos e fontes
    if (request.action === "downloadAsHTML") {
        const tabId = request.tabId;
        const projectId = (request.projectId || '').trim();

        if (!tabId) {
            sendResponse({ success: false, error: 'Tab não identificada.' });
            return false;
        }

        (async () => {
            try {
                // ============================================================
                // FASE 1: Content Script — coletar HTML, CSS e URLs de recursos
                // ============================================================
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tabId, allFrames: true },
                    func: function() {
                        // --- Esta função roda DENTRO de cada frame ---
                        if (location.hostname.includes('lovable.dev')) return null;
                        if (!document.body || document.body.scrollWidth < 200 || document.body.scrollHeight < 200) return null;

                        var baseUrl = location.href;
                        function resolveUrl(url) {
                            if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
                            try { return new URL(url, baseUrl).href; } catch(e) { return null; }
                        }

                        var result = {
                            isPreview: true,
                            bodySize: document.body.innerHTML.length,
                            resources: [],      // { url, type, originalRef }
                            dataResources: [],   // { dataUrl, type, originalRef } para data: URLs inline
                            cssText: '',
                            html: '',
                            title: document.title || 'Página',
                            pageUrl: baseUrl
                        };
                        var seenUrls = {};

                        function addResource(url, type, originalRef) {
                            var resolved = resolveUrl(url);
                            if (!resolved || seenUrls[resolved]) return;
                            seenUrls[resolved] = true;
                            result.resources.push({ url: resolved, type: type, originalRef: originalRef || url });
                        }

                        // 1. Coletar CSS de todas as stylesheets acessíveis
                        var allCSS = [];
                        var capturedHrefs = {};
                        try {
                            for (var i = 0; i < document.styleSheets.length; i++) {
                                try {
                                    var sheet = document.styleSheets[i];
                                    var rules = sheet.cssRules || sheet.rules;
                                    var css = '';
                                    for (var j = 0; j < rules.length; j++) {
                                        css += rules[j].cssText + '\n';
                                    }
                                    allCSS.push(css);
                                    if (sheet.href) capturedHrefs[sheet.href] = true;
                                } catch (e) {
                                    // Cross-origin stylesheet
                                }
                            }
                        } catch (e) {}
                        var combinedCSS = allCSS.join('\n');
                        combinedCSS = combinedCSS.replace(/\/\*[^*]*lovable[^*]*\*\//gi, '');
                        result.cssText = combinedCSS;

                        // 2. Coletar URLs de imagens (<img src> e <img srcset>)
                        try {
                            document.querySelectorAll('img[src]').forEach(function(img) {
                                var src = img.getAttribute('src');
                                if (src && src.startsWith('data:')) {
                                    if (!seenUrls['data_' + src.substring(0, 80)]) {
                                        seenUrls['data_' + src.substring(0, 80)] = true;
                                        result.dataResources.push({ dataUrl: src, type: 'image', originalRef: src });
                                    }
                                } else if (src) {
                                    addResource(src, 'image', src);
                                }
                            });
                            document.querySelectorAll('img[srcset]').forEach(function(img) {
                                var srcset = img.getAttribute('srcset') || '';
                                srcset.split(',').forEach(function(entry) {
                                    var url = entry.trim().split(/\s+/)[0];
                                    if (url && !url.startsWith('data:')) addResource(url, 'image', url);
                                });
                            });
                        } catch (e) {}

                        // 3. Coletar URLs de vídeos (<video src>, <video poster>, <source src>)
                        try {
                            document.querySelectorAll('video[src]').forEach(function(v) {
                                var src = v.getAttribute('src');
                                if (src && !src.startsWith('blob:')) addResource(src, 'video', src);
                            });
                            document.querySelectorAll('video[poster]').forEach(function(v) {
                                var poster = v.getAttribute('poster');
                                if (poster) addResource(poster, 'image', poster);
                            });
                            document.querySelectorAll('source[src]').forEach(function(s) {
                                var src = s.getAttribute('src');
                                var type = (s.getAttribute('type') || '').toLowerCase();
                                if (src && !src.startsWith('blob:')) {
                                    var resType = type.startsWith('audio') ? 'video' : (type.startsWith('video') ? 'video' : 'video');
                                    addResource(src, resType, src);
                                }
                            });
                        } catch (e) {}

                        // 4. Coletar URLs de background-image no CSS
                        try {
                            var bgMatches = combinedCSS.match(/url\(\s*["']?([^"')]+)["']?\s*\)/gi) || [];
                            bgMatches.forEach(function(match) {
                                var inner = match.replace(/url\(\s*["']?/i, '').replace(/["']?\s*\)$/i, '');
                                if (inner && !inner.startsWith('data:') && !inner.startsWith('blob:')) {
                                    // Determinar tipo: fonte ou imagem
                                    var isFont = /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(inner);
                                    addResource(inner, isFont ? 'font' : 'image', inner);
                                }
                            });
                        } catch (e) {}

                        // 5. Coletar favicons
                        try {
                            document.querySelectorAll('link[rel*="icon"]').forEach(function(link) {
                                var href = link.getAttribute('href');
                                if (href) addResource(href, 'favicon', href);
                            });
                        } catch (e) {}

                        // 6. Construir HTML limpo (com URLs ORIGINAIS — serão substituídas no background)
                        var clone = document.documentElement.cloneNode(true);

                        // Remover branding Lovable
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
                            try { clone.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
                        });
                        clone.querySelectorAll('meta[name="author"][content*="Lovable"]').forEach(function(el) { el.remove(); });
                        clone.querySelectorAll('meta[name="author"][content*="lovable"]').forEach(function(el) { el.remove(); });
                        clone.querySelectorAll('meta[property="og:image"][content*="lovable.dev"]').forEach(function(el) { el.remove(); });

                        var titleEl = clone.querySelector('title');
                        if (titleEl && /lovable/i.test(titleEl.textContent)) {
                            titleEl.textContent = titleEl.textContent.replace(/\s*[-–|]\s*Lovable.*/i, '').replace(/Lovable\s*[-–|]\s*/i, '') || 'My App';
                        }

                        // Remover stylesheets que foram capturadas (manter cross-origin como <link>)
                        clone.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
                            var href = el.getAttribute('href');
                            if (href) {
                                var fullHref = href;
                                try { fullHref = new URL(href, baseUrl).href; } catch(e) {}
                                if (capturedHrefs[fullHref]) el.remove();
                            } else {
                                el.remove();
                            }
                        });

                        // Remover <style> inline (substituídas pelo CSS combinado)
                        clone.querySelectorAll('style').forEach(function(el) { el.remove(); });

                        // Adicionar link para CSS externo (será arquivo local no ZIP)
                        var head = clone.querySelector('head');
                        if (head && combinedCSS) {
                            var linkEl = document.createElement('link');
                            linkEl.setAttribute('rel', 'stylesheet');
                            linkEl.setAttribute('href', 'css/styles.css');
                            head.appendChild(linkEl);
                        }

                        // Remover scripts externos
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

                // ============================================================
                // FASE 2: Background — baixar recursos via fetch() (sem CORS)
                // ============================================================
                const MAX_RESOURCES = 200;
                const MAX_SIZE = 50 * 1024 * 1024; // 50MB por recurso
                const FETCH_TIMEOUT = 15000; // 15s

                // Utilitário: adivinhar extensão pela URL ou Content-Type
                function guessExt(url, contentType) {
                    var ct = (contentType || '').toLowerCase();
                    // Por Content-Type
                    if (ct.includes('image/png')) return 'png';
                    if (ct.includes('image/jpeg')) return 'jpg';
                    if (ct.includes('image/gif')) return 'gif';
                    if (ct.includes('image/webp')) return 'webp';
                    if (ct.includes('image/svg')) return 'svg';
                    if (ct.includes('image/x-icon') || ct.includes('image/vnd.microsoft.icon')) return 'ico';
                    if (ct.includes('video/mp4')) return 'mp4';
                    if (ct.includes('video/webm')) return 'webm';
                    if (ct.includes('video/ogg')) return 'ogv';
                    if (ct.includes('font/woff2') || ct.includes('application/font-woff2')) return 'woff2';
                    if (ct.includes('font/woff') || ct.includes('application/font-woff')) return 'woff';
                    if (ct.includes('font/ttf') || ct.includes('application/font-sfnt') || ct.includes('font/sfnt')) return 'ttf';
                    if (ct.includes('font/otf')) return 'otf';
                    if (ct.includes('application/vnd.ms-fontobject')) return 'eot';
                    // Por extensão na URL
                    try {
                        var pathname = new URL(url).pathname;
                        var match = pathname.match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
                        if (match) return match[1].toLowerCase();
                    } catch(e) {}
                    // Fallback
                    if (ct.includes('image/')) return 'png';
                    if (ct.includes('video/')) return 'mp4';
                    if (ct.includes('font/')) return 'woff2';
                    return 'bin';
                }

                // Fetch com timeout
                async function fetchWithTimeout(url, timeout) {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), timeout);
                    try {
                        const res = await fetch(url, { signal: controller.signal });
                        clearTimeout(timer);
                        return res;
                    } catch(e) {
                        clearTimeout(timer);
                        throw e;
                    }
                }

                // Mapa de URL original → caminho local no ZIP
                const urlMap = {};
                const zipFiles = [];
                const counters = { image: 0, video: 0, font: 0, favicon: 0 };

                // Baixar recursos remotos (fetch no background — sem CORS)
                const resourcesToFetch = (capturedData.resources || []).slice(0, MAX_RESOURCES);
                for (const res of resourcesToFetch) {
                    try {
                        const response = await fetchWithTimeout(res.url, FETCH_TIMEOUT);
                        if (!response.ok) continue;
                        // Verificar tamanho
                        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
                        if (contentLength > MAX_SIZE) continue;

                        const buffer = await response.arrayBuffer();
                        if (buffer.byteLength > MAX_SIZE) continue;

                        const ext = guessExt(res.url, response.headers.get('content-type'));
                        counters[res.type] = (counters[res.type] || 0) + 1;
                        const folder = res.type === 'favicon' ? 'images' : res.type + 's';
                        const filename = res.type + '_' + counters[res.type] + '.' + ext;
                        const localPath = folder + '/' + filename;

                        zipFiles.push({
                            name: localPath,
                            content: new Uint8Array(buffer)
                        });
                        urlMap[res.url] = localPath;
                        // Também mapear a referência original (pode ser relativa)
                        if (res.originalRef && res.originalRef !== res.url) {
                            urlMap[res.originalRef] = localPath;
                        }
                    } catch (e) {
                        // Recurso inacessível — mantém URL original
                    }
                }

                // Processar data: URLs inline (imagens embutidas no HTML)
                const dataResources = (capturedData.dataResources || []).slice(0, MAX_RESOURCES);
                for (const dr of dataResources) {
                    try {
                        const resp = await fetch(dr.dataUrl);
                        const blob = await resp.blob();
                        const buffer = await blob.arrayBuffer();
                        counters.image = (counters.image || 0) + 1;
                        var ext2 = 'png';
                        if (dr.dataUrl.startsWith('data:image/jpeg')) ext2 = 'jpg';
                        else if (dr.dataUrl.startsWith('data:image/gif')) ext2 = 'gif';
                        else if (dr.dataUrl.startsWith('data:image/webp')) ext2 = 'webp';
                        else if (dr.dataUrl.startsWith('data:image/svg')) ext2 = 'svg';
                        var localPath2 = 'images/image_' + counters.image + '.' + ext2;
                        zipFiles.push({
                            name: localPath2,
                            content: new Uint8Array(buffer)
                        });
                        urlMap[dr.originalRef] = localPath2;
                    } catch(e) {}
                }

                // ============================================================
                // FASE 3: Substituir URLs no HTML e CSS pelos caminhos locais
                // ============================================================
                let finalHTML = capturedData.html;
                let finalCSS = capturedData.cssText || '';

                // Ordenar URLs por comprimento decrescente (evitar substituições parciais)
                const sortedUrls = Object.keys(urlMap).sort((a, b) => b.length - a.length);

                for (const originalUrl of sortedUrls) {
                    const localPath = urlMap[originalUrl];
                    // Escapar para uso em regex
                    const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    // Substituir no HTML (atributos src, href, poster, srcset)
                    finalHTML = finalHTML.replace(new RegExp(escaped, 'g'), localPath);
                    // Substituir no CSS (url(...))
                    finalCSS = finalCSS.replace(new RegExp(escaped, 'g'), '../' + localPath);
                }

                // ============================================================
                // FASE 4: Montar ZIP
                // ============================================================
                // index.html
                zipFiles.push({
                    name: 'index.html',
                    content: new TextEncoder().encode(finalHTML)
                });

                // css/styles.css
                if (finalCSS) {
                    zipFiles.push({
                        name: 'css/styles.css',
                        content: new TextEncoder().encode(finalCSS)
                    });
                }

                if (zipFiles.length === 0) {
                    sendResponse({ success: false, error: 'Nenhum conteúdo capturado.' });
                    return;
                }

                // Criar ZIP
                const zipData = await ZipUtils.createZip(zipFiles);

                // Converter para base64 data URL (URL.createObjectURL não funciona em Service Worker MV3)
                let binary = '';
                for (let i = 0; i < zipData.length; i++) {
                    binary += String.fromCharCode(zipData[i]);
                }
                const base64 = btoa(binary);
                const dataUrl = `data:application/zip;base64,${base64}`;

                // Nome do arquivo
                const now = new Date();
                const timestamp = now.getFullYear().toString() +
                    (now.getMonth() + 1).toString().padStart(2, '0') +
                    now.getDate().toString().padStart(2, '0') + '-' +
                    now.getHours().toString().padStart(2, '0') +
                    now.getMinutes().toString().padStart(2, '0') +
                    now.getSeconds().toString().padStart(2, '0');
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
                        const totalResources = zipFiles.length - 1 - (finalCSS ? 1 : 0); // descontar HTML e CSS
                        const parts = [];
                        if (counters.image > 0) parts.push(counters.image + ' imagens');
                        if (counters.video > 0) parts.push(counters.video + ' vídeos');
                        if (counters.font > 0) parts.push(counters.font + ' fontes');
                        if (counters.favicon > 0) parts.push(counters.favicon + ' favicons');
                        const detail = parts.length > 0 ? ' (' + parts.join(', ') + ')' : '';
                        sendResponse({
                            success: true,
                            message: 'Download iniciado! ' + zipFiles.length + ' arquivos — HTML + CSS + ' + totalResources + ' recursos' + detail
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
