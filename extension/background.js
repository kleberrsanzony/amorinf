// Background service worker - Lovable Infinity (baseado na lógica funcional do PROMPTXV2)
// Console mantido (ofuscação da build já protege)

// Importa utilitários auxiliares (c3.js em produção, zip-utils.js em dev)
try { importScripts('c3.js'); } catch(e) { importScripts('zip-utils.js'); }

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

// Captura ai_message_id de POST /chat que a PRÓPRIA PÁGINA Lovable faz (não a extensão)
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        // Só captura de abas reais (tabId > 0 exclui requisições da extensão)
        if (details.tabId > 0 && details.method === 'POST' && details.url.includes('/chat')) {
            if (details.requestBody && details.requestBody.raw && details.requestBody.raw.length > 0) {
                try {
                    const decoder = new TextDecoder();
                    const bodyStr = decoder.decode(details.requestBody.raw[0].bytes);
                    const body = JSON.parse(bodyStr);
                    if (body.ai_message_id && typeof body.ai_message_id === 'string' && body.ai_message_id.startsWith('aimsg_')) {
                        chrome.storage.local.set({ lovable_last_aimsg: body.ai_message_id });
                        console.log('[Lovable Infinity] ai_message_id capturado de POST /chat:', body.ai_message_id);
                    }
                } catch (e) { }
            }
        }
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

    // Envio direto à API do Lovable no formato "error fix" (modo instant)
    if (request.action === "sendLovableChat") {
        (async () => {
            try {
                const { projectId, token, payload } = request;
                if (!projectId || !token || !payload) {
                    sendResponse({ success: false, error: 'Dados incompletos para envio.' });
                    return;
                }

                // Buscar o Git SHA e o último ai_message_id capturados
                const stored = await chrome.storage.local.get(['lovable_git_sha', 'lovable_last_aimsg']);
                const gitSha = stored.lovable_git_sha || '';
                let aiMsgId = stored.lovable_last_aimsg || null;
                let aiMsgIdSource = aiMsgId ? 'storage' : 'none';

                // Se não temos ai_message_id no storage, extrair sob demanda da aba do Lovable
                if (!aiMsgId) {
                    try {
                        const tabs = await chrome.tabs.query({ url: "https://lovable.dev/*" });
                        if (tabs.length > 0) {
                            const results = await chrome.scripting.executeScript({
                                target: { tabId: tabs[0].id },
                                world: 'MAIN',
                                func: () => {
                                    // Busca aimsg_ no React fiber tree da página
                                    var found = [];
                                    var visited = new WeakSet();

                                    function searchObj(obj, depth) {
                                        if (depth > 4 || !obj || typeof obj !== 'object' || found.length > 200) return;
                                        try { if (visited.has(obj)) return; visited.add(obj); } catch(e) { return; }
                                        try {
                                            var keys = Object.keys(obj);
                                            for (var i = 0; i < keys.length; i++) {
                                                try {
                                                    var val = obj[keys[i]];
                                                    if (typeof val === 'string') {
                                                        var m = val.match(/aimsg_[a-z0-9]{10,}/g);
                                                        if (m) m.forEach(function(id) { if (found.indexOf(id) === -1) found.push(id); });
                                                    } else if (typeof val === 'object' && val !== null) {
                                                        searchObj(val, depth + 1);
                                                    }
                                                } catch(e) {}
                                            }
                                        } catch(e) {}
                                    }

                                    function scanFiber(fiber, depth) {
                                        if (depth > 60 || !fiber || found.length > 200) return;
                                        try { if (visited.has(fiber)) return; visited.add(fiber); } catch(e) { return; }
                                        if (fiber.memoizedProps) searchObj(fiber.memoizedProps, 0);
                                        // memoizedState é uma lista encadeada nos React hooks
                                        var state = fiber.memoizedState;
                                        var sc = 0;
                                        while (state && sc < 30) {
                                            if (state.memoizedState != null) {
                                                if (typeof state.memoizedState === 'string') {
                                                    var m = state.memoizedState.match(/aimsg_[a-z0-9]{10,}/g);
                                                    if (m) m.forEach(function(id) { if (found.indexOf(id) === -1) found.push(id); });
                                                } else if (typeof state.memoizedState === 'object') {
                                                    searchObj(state.memoizedState, 0);
                                                }
                                            }
                                            state = state.next;
                                            sc++;
                                        }
                                        if (fiber.child) scanFiber(fiber.child, depth + 1);
                                        if (fiber.sibling) scanFiber(fiber.sibling, depth + 1);
                                    }

                                    var allEls = document.querySelectorAll('*');
                                    for (var i = 0; i < allEls.length; i++) {
                                        var el = allEls[i];
                                        var keys = Object.keys(el);
                                        for (var k = 0; k < keys.length; k++) {
                                            if (keys[k].indexOf('__reactFiber') === 0 || keys[k].indexOf('__reactInternalInstance') === 0) {
                                                scanFiber(el[keys[k]], 0);
                                                break;
                                            }
                                        }
                                        // Não para no primeiro elemento - continua buscando em todo o DOM
                                    }
                                    return found;
                                }
                            });
                            if (results && results[0] && results[0].result && results[0].result.length > 0) {
                                const ids = results[0].result;
                                aiMsgId = ids[ids.length - 1]; // Último = mais recente
                                aiMsgIdSource = 'scripting(' + ids.length + ' ids found)';
                                chrome.storage.local.set({ lovable_last_aimsg: aiMsgId });
                                console.log('[Lovable Infinity] ai_message_id extraído via scripting:', aiMsgId, '(total:', ids.length, ')');
                            } else {
                                console.warn('[Lovable Infinity] Nenhum ai_message_id encontrado via scripting');
                                aiMsgIdSource = 'scripting(none found)';
                            }
                        } else {
                            console.warn('[Lovable Infinity] Nenhuma aba lovable.dev encontrada');
                            aiMsgIdSource = 'no lovable tab';
                        }
                    } catch (e) {
                        console.warn('[Lovable Infinity] Falha ao extrair ai_message_id via scripting:', e.message);
                        aiMsgIdSource = 'scripting-error: ' + e.message;
                    }
                }

                // Sobrescrever o ai_message_id com o real capturado (se disponível)
                if (aiMsgId) {
                    payload.ai_message_id = aiMsgId;
                }

                console.log('[Lovable Infinity] Enviando para API. ai_message_id:', payload.ai_message_id, '| source:', aiMsgIdSource);

                const headers = {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                };
                if (gitSha) {
                    headers['X-Client-Git-SHA'] = gitSha;
                }

                const url = `https://api.lovable.dev/projects/${projectId}/chat`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                });

                const text = await response.text();
                let json = {};
                try { json = JSON.parse(text); } catch (e) { }

                if (response.ok || response.status === 202) {
                    // Notifica o content script para ocultar a mensagem "Fix these issues" do chat
                    try {
                        const lovableTabs = await chrome.tabs.query({ url: "https://lovable.dev/*" });
                        lovableTabs.forEach(tab => {
                            chrome.tabs.sendMessage(tab.id, { action: 'hideErrorFixMessages' }).catch(() => {});
                        });
                    } catch (e) {}
                    sendResponse({ success: true, status: response.status, data: json, text: text });
                } else {
                    const errorMsg = json.message || json.error || response.statusText || 'Erro desconhecido';
                    sendResponse({
                        success: false,
                        error: `Erro ${response.status}: ${errorMsg}`,
                        debug: { ai_message_id: payload.ai_message_id, source: aiMsgIdSource }
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
