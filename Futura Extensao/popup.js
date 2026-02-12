// Popup - Lovable Infinity (comunicação via Supabase Edge Functions)
// Console mantido (ofuscação da build já protege o código)

document.addEventListener('DOMContentLoaded', async () => {
    // ============================================
    // VERIFICAÇÃO DE AUTENTICAÇÃO COM LICENÇA + JWT
    // ============================================
    const authData = await chrome.storage.local.get(['isAuthenticated', 'licenseKey', 'sessionToken']);

    if (CONFIG.REQUIRE_LICENSE && (!authData.isAuthenticated || !authData.licenseKey || !authData.sessionToken)) {
        window.location.href = 'auth.html';
        return;
    }

    // Elements
    const chatContainer = document.getElementById('chat-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const attachBtn = document.getElementById('attach-btn');
    const improvePromptBtn = document.getElementById('improve-prompt-btn');
    const statusBadge = document.getElementById('status-badge');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const lovableRequiredOverlay = document.getElementById('lovable-required-overlay');
    const logoutBtn = document.getElementById('logout-btn');
    const licenseDaysEl = document.getElementById('license-days');
    const filePreviewContainer = document.getElementById('file-preview-container');
    const screenshotBtn = document.getElementById('screenshot-btn');
    const downloadProjectBtn = document.getElementById('download-project-btn');
    const downloadHtmlBtn = document.getElementById('download-html-btn');
    const voiceBtn = document.getElementById('voice-btn');
    // Mode toggle removido - modo fixo em 'error'

    // Storage key for chat per project
    const CHAT_STORAGE_KEY = 'lovable_infinity_chat';
    const MAX_HISTORIES_PER_PROJECT = 20;

    // In-memory mirror of current chat for persistence
    let currentSessionMessages = [];

    let config = {
        token: '',
        projectId: ''
    };

    // Load saved settings and captured token from background
    const stored = await chrome.storage.local.get(['lovable_token', 'licenseKey', 'deviceFingerprint']);

    if (stored.lovable_token) {
        config.token = stored.lovable_token;
        updateTokenDisplay(config.token);
    }

    // ============================================
    // VALIDAÇÃO DE LICENÇA NA ABERTURA (Supabase)
    // ============================================
    async function validateLicenseOnce() {
        const loadingOverlay = document.getElementById('loading-overlay');

        try {
            const authData = await chrome.storage.local.get(['licenseKey']);

            if (!authData.licenseKey) {
                window.location.href = 'auth.html';
                return;
            }

            const result = await validateKeySecure(authData.licenseKey);

            if (!result.valid) {
                await chrome.storage.local.remove(['isAuthenticated', 'licenseKey', 'authTimestamp', 'userData', 'lovable_token', 'deviceFingerprint']);
                window.location.href = 'auth.html';
            } else {
                // Atualizar userData com expiryDate e lifetime
                if (result.license) {
                    const current = await chrome.storage.local.get(['userData']);
                    const userData = { ...(current.userData || {}) };
                    if (result.license.expiryDate) userData.expiryDate = result.license.expiryDate;
                    if (result.license.lifetime === true) userData.lifetime = true;
                    await chrome.storage.local.set({ userData });
                }
                // Garantir deviceFingerprint no storage
                const sess = await chrome.storage.local.get(['deviceFingerprint']);
                if (!sess.deviceFingerprint) {
                    const fp = await getDeviceFingerprint();
                    await chrome.storage.local.set({ deviceFingerprint: fp });
                }
                if (loadingOverlay) loadingOverlay.style.display = 'none';
                await updateLicenseDaysDisplay();
            }
        } catch (error) {
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
            await updateLicenseDaysDisplay();
        }
    }

    /**
     * Calcula dias restantes da licença e atualiza o texto no header
     */
    async function updateLicenseDaysDisplay() {
        if (!licenseDaysEl) return;
        const stored = await chrome.storage.local.get(['userData']);

        if (stored.userData && stored.userData.lifetime === true) {
            licenseDaysEl.textContent = 'Vitalício';
            licenseDaysEl.style.display = '';
            return;
        }

        const dayMs = 24 * 60 * 60 * 1000;
        const now = Date.now();
        let daysLeft = null;

        if (stored.userData && stored.userData.expiryDate) {
            const expiry = new Date(stored.userData.expiryDate).getTime();
            if (expiry > now) daysLeft = Math.ceil((expiry - now) / dayMs);
        }

        if (daysLeft !== null && daysLeft >= 0) {
            licenseDaysEl.textContent = daysLeft === 0 ? 'Último dia' : (daysLeft === 1 ? '1 dia restante' : daysLeft + ' dias restantes');
            licenseDaysEl.style.display = '';
        } else {
            licenseDaysEl.textContent = 'Licença ativa';
            licenseDaysEl.style.display = '';
        }
    }

    // Verificar integridade
    const integrityOk = await verifyIntegrity();

    // Executar validação UMA ÚNICA VEZ ao iniciar
    await validateLicenseOnce();

    // ============================================
    // VERIFICAÇÃO JWT OBRIGATÓRIA
    // O token é assinado pelo servidor - não pode ser forjado.
    // Sem JWT válido = sem acesso, mesmo que moque outras respostas.
    // ============================================
    const sessionResult = await verifySessionWithServer();
    if (!sessionResult.valid) {
        // Tentar renovar o token
        const refreshed = await tryRefreshSession();
        if (!refreshed) {
            // JWT inválido/expirado - forçar novo login
            await chrome.storage.local.remove([
                'isAuthenticated', 'licenseKey', 'authTimestamp', 'userData',
                'lovable_token', 'deviceFingerprint',
                'sessionToken', 'refreshToken', 'sessionExpiresAt'
            ]);
            window.location.href = 'auth.html';
            return;
        }
    }

    // Helper: Update UI when token is found
    function updateTokenDisplay(token) {
        if (token) {
            statusBadge.innerHTML = '<span class="status-dot"></span> Ativo';
            statusBadge.style.color = '#10b981';
            statusBadge.style.background = 'rgba(16, 185, 129, 0.1)';
            statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        } else {
            statusBadge.innerHTML = '<span class="status-dot" style="background:#a1a1aa;box-shadow:none;"></span> Desconectado';
            statusBadge.style.color = '#a1a1aa';
            statusBadge.style.background = 'rgba(161, 161, 170, 0.1)';
            statusBadge.style.borderColor = 'rgba(161, 161, 170, 0.2)';
        }
    }

    // ----- Chat storage (per project) -----
    async function loadChatState(projectId) {
        if (!projectId) return;
        try {
            const result = await chrome.storage.local.get([CHAT_STORAGE_KEY]);
            const data = result[CHAT_STORAGE_KEY] && result[CHAT_STORAGE_KEY][projectId];
            const current = data && data.current && Array.isArray(data.current) ? data.current : [];
            currentSessionMessages = current.slice();
            if (current.length > 0) {
                renderMessagesToChat(current);
            }
        } catch (e) {}
    }

    async function saveCurrentSession(projectId) {
        if (!projectId) return;
        try {
            const result = await chrome.storage.local.get([CHAT_STORAGE_KEY]);
            const root = result[CHAT_STORAGE_KEY] || {};
            if (!root[projectId]) root[projectId] = { current: [], histories: [] };
            root[projectId].current = currentSessionMessages.slice();
            await chrome.storage.local.set({ [CHAT_STORAGE_KEY]: root });
        } catch (e) {}
    }

    function formatHistoryTitle(dateStr) {
        const d = new Date(dateStr);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `Conversa ${day}/${month} ${h}:${m}`;
    }

    async function addToHistories(projectId, title) {
        if (!projectId || currentSessionMessages.length === 0) return;
        try {
            const result = await chrome.storage.local.get([CHAT_STORAGE_KEY]);
            const root = result[CHAT_STORAGE_KEY] || {};
            if (!root[projectId]) root[projectId] = { current: [], histories: [] };
            const histories = root[projectId].histories || [];
            const entry = {
                id: 'h-' + Date.now(),
                title: title || formatHistoryTitle(new Date().toISOString()),
                messages: currentSessionMessages.slice(),
                createdAt: new Date().toISOString()
            };
            histories.unshift(entry);
            if (histories.length > MAX_HISTORIES_PER_PROJECT) histories.length = MAX_HISTORIES_PER_PROJECT;
            root[projectId].histories = histories;
            root[projectId].current = [];
            await chrome.storage.local.set({ [CHAT_STORAGE_KEY]: root });
        } catch (e) {}
    }

    function renderMessagesToChat(messages) {
        chatContainer.replaceChildren();
        if (!Array.isArray(messages)) return;
        messages.forEach(function (msg) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + (msg.type || 'system');
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = msg.text || '';
            messageDiv.appendChild(contentDiv);
            
            // Botão de copiar para mensagens do usuário
            if (msg.type === 'user' && msg.text) {
                const copyBtn = document.createElement('button');
                copyBtn.className = 'message-copy-btn';
                copyBtn.title = 'Copiar prompt';
                copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                copyBtn.addEventListener('click', async () => {
                    try {
                        await navigator.clipboard.writeText(msg.text);
                        copyBtn.classList.add('copied');
                        copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                        setTimeout(() => {
                            copyBtn.classList.remove('copied');
                            copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                        }, 1500);
                    } catch (_) {}
                });
                messageDiv.appendChild(copyBtn);
            }
            
            chatContainer.appendChild(messageDiv);
        });
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Chat Logic
    function addMessage(text, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = text;
        messageDiv.appendChild(contentDiv);
        
        // Botão de copiar para mensagens do usuário
        if (type === 'user' && text) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'message-copy-btn';
            copyBtn.title = 'Copiar prompt';
            copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    copyBtn.classList.add('copied');
                    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                    }, 1500);
                } catch (_) {}
            });
            messageDiv.appendChild(copyBtn);
        }
        
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        currentSessionMessages.push({ text: text, type: type });
        if (config.projectId) saveCurrentSession(config.projectId);
    }

    function addSystemMessage(text) {
        addMessage(text, 'system');
    }

    // Create hidden file input (aceita imagens, vídeos e arquivos comuns)
    const MAX_ATTACHMENTS = 10;
    const MAX_FILE_SIZE_MB = 20;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.json,.zip,.rar,.7z,.html,.css,.js,.ts,.py,.md,.ogg,.mp3,.wav,.m4a,.aac,.flac';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    let attachedFiles = [];

    attachBtn.addEventListener('click', () => {
        if (attachedFiles.length >= MAX_ATTACHMENTS) {
            addSystemMessage(`Máximo de ${MAX_ATTACHMENTS} anexos atingido.`);
            return;
        }
        fileInput.click();
    });

    // Helper: Update Send Button State
    function updateSendButtonState() {
        const hasText = messageInput.value.trim().length > 0;
        const hasFiles = attachedFiles.length > 0;
        if (hasText || hasFiles) {
            sendBtn.removeAttribute('disabled');
        } else {
            sendBtn.setAttribute('disabled', 'true');
        }
    }

    // Helpers de tipo de arquivo
    function getFileCategory(file) {
        if (!file || !file.type) return 'file';
        if (file.type.startsWith('image/')) return 'image';
        if (file.type.startsWith('video/')) return 'video';
        if (file.type.startsWith('audio/')) return 'audio';
        return 'file';
    }

    function getFileIcon(file) {
        const cat = getFileCategory(file);
        if (cat === 'video') return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
        if (cat === 'audio') return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Renderizar todos os previews do array attachedFiles
    function renderAttachmentPreviews() {
        filePreviewContainer.innerHTML = '';
        if (attachedFiles.length === 0) {
            filePreviewContainer.style.display = 'none';
            attachBtn.classList.remove('active');
            return;
        }
        filePreviewContainer.style.display = 'flex';
        attachBtn.classList.add('active');

        attachedFiles.forEach((entry, idx) => {
            const { file, dataUrl } = entry;
            const cat = getFileCategory(file);
            const chip = document.createElement('div');
            chip.className = 'file-preview-chip' + (cat === 'image' ? ' has-thumbnail' : cat === 'video' ? ' has-thumbnail video-thumb' : '');

            if (cat === 'image') {
                const thumbnail = document.createElement('div');
                thumbnail.className = 'file-thumbnail';
                const img = document.createElement('img');
                if (dataUrl) {
                    img.src = dataUrl;
                } else {
                    const reader = new FileReader();
                    reader.onload = (e) => { img.src = e.target.result; };
                    reader.readAsDataURL(file);
                }
                img.alt = file ? file.name : 'Screenshot';
                thumbnail.appendChild(img);
                chip.appendChild(thumbnail);
            } else if (cat === 'video') {
                const thumbnail = document.createElement('div');
                thumbnail.className = 'file-thumbnail video-icon-wrap';
                thumbnail.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
                chip.appendChild(thumbnail);
            } else if (cat === 'audio') {
                const thumbnail = document.createElement('div');
                thumbnail.className = 'file-thumbnail video-icon-wrap';
                thumbnail.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
                chip.appendChild(thumbnail);
            } else {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'file-icon';
                iconSpan.innerHTML = getFileIcon(file);
                chip.appendChild(iconSpan);
            }

            const infoWrap = document.createElement('div');
            infoWrap.className = 'file-info';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-name';
            nameSpan.textContent = file ? file.name : 'Screenshot do preview';
            infoWrap.appendChild(nameSpan);
            if (file && file.size) {
                const sizeSpan = document.createElement('span');
                sizeSpan.className = 'file-size';
                sizeSpan.textContent = formatFileSize(file.size);
                infoWrap.appendChild(sizeSpan);
            }
            chip.appendChild(infoWrap);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-file-btn';
            removeBtn.title = 'Remover';
            removeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            removeBtn.addEventListener('click', () => {
                removeAttachment(idx);
            });
            chip.appendChild(removeBtn);

            filePreviewContainer.appendChild(chip);
        });

        // Contador se tiver mais de 1
        if (attachedFiles.length > 1) {
            const counter = document.createElement('div');
            counter.className = 'file-counter';
            counter.textContent = `${attachedFiles.length}/${MAX_ATTACHMENTS} anexos`;
            filePreviewContainer.appendChild(counter);
        }

        messageInput.focus();
    }

    function addAttachment(file, dataUrl = null) {
        if (attachedFiles.length >= MAX_ATTACHMENTS) {
            addSystemMessage(`Máximo de ${MAX_ATTACHMENTS} anexos atingido.`);
            return;
        }
        if (file && file.size > MAX_FILE_SIZE_BYTES) {
            addSystemMessage(`Arquivo "${file.name}" excede ${MAX_FILE_SIZE_MB}MB. Máximo: ${MAX_FILE_SIZE_MB}MB por arquivo.`);
            return;
        }
        attachedFiles.push({ file, dataUrl });
        renderAttachmentPreviews();
        updateSendButtonState();
    }

    function removeAttachment(index) {
        attachedFiles.splice(index, 1);
        renderAttachmentPreviews();
        updateSendButtonState();
    }

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            const remaining = MAX_ATTACHMENTS - attachedFiles.length;
            const filesToAdd = Array.from(fileInput.files).slice(0, remaining);
            filesToAdd.forEach(f => {
                if (f.size > MAX_FILE_SIZE_BYTES) {
                    addSystemMessage(`"${f.name}" excede ${MAX_FILE_SIZE_MB}MB. Ignorado.`);
                } else {
                    addAttachment(f);
                }
            });
            if (fileInput.files.length > remaining) {
                addSystemMessage(`Apenas ${remaining} arquivo(s) adicionado(s). Limite de ${MAX_ATTACHMENTS} atingido.`);
            }
        }
        fileInput.value = '';
    });

    // Drag & drop na área de mensagem
    messageInput.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        messageInput.classList.add('drag-over');
    });
    messageInput.addEventListener('dragleave', () => {
        messageInput.classList.remove('drag-over');
    });
    messageInput.addEventListener('drop', (e) => {
        e.preventDefault();
        messageInput.classList.remove('drag-over');
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const remaining = MAX_ATTACHMENTS - attachedFiles.length;
        const filesToAdd = Array.from(files).slice(0, remaining);
        filesToAdd.forEach(f => {
            if (f.size > MAX_FILE_SIZE_BYTES) {
                addSystemMessage(`"${f.name}" excede ${MAX_FILE_SIZE_MB}MB. Ignorado.`);
            } else {
                addAttachment(f);
            }
        });
        if (files.length > remaining) {
            addSystemMessage(`Limite de ${MAX_ATTACHMENTS} anexos atingido.`);
        }
    });

    // Colar imagem (Ctrl+V)
    messageInput.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/') || item.type.startsWith('audio/'))) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (!blob) return;
                const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' || blob.type === 'image/jpg' ? 'jpg' : blob.type.split('/')[1] || 'png';
                const pastedFile = new File([blob], `colado-${Date.now()}.${ext}`, { type: blob.type });
                addAttachment(pastedFile);
                return;
            }
        }
    });

    function clearFile() {
        attachedFiles = [];
        fileInput.value = '';
        filePreviewContainer.style.display = 'none';
        attachBtn.classList.remove('active');
        updateSendButtonState();
    }

    // ============================================
    // MODOS DE ENVIO
    // A construção do payload agora é feita server-side (Edge Function)
    // O popup envia apenas: message (texto limpo), mode, files
    // ============================================

    // Modo de envio fixo em 'error' (error fix)
    const sendMode = 'error';

    // Envio de mensagem via API direta do Lovable (formato error fix)
    async function sendMessage() {
        const text = messageInput.value.trim();
        const files = [...attachedFiles];

        if (!text && files.length === 0) return;

        if (!config.token) {
            const freshStore = await chrome.storage.local.get(['lovable_token']);
            if (freshStore.lovable_token) {
                config.token = freshStore.lovable_token;
                updateTokenDisplay(config.token);
            }
        }

        await captureData();

        if (!config.token || !config.projectId) {
            addSystemMessage('Alerta: Token ou ID do projeto ausentes. Dê um refresh na página.');
            return;
        }

        // Montar indicador de anexos na mensagem do user
        let attachLabel = '';
        if (files.length > 0) {
            const imgs = files.filter(f => getFileCategory(f.file) === 'image').length;
            const vids = files.filter(f => getFileCategory(f.file) === 'video').length;
            const auds = files.filter(f => getFileCategory(f.file) === 'audio').length;
            const docs = files.length - imgs - vids - auds;
            const parts = [];
            if (imgs > 0) parts.push(`${imgs} imagem${imgs > 1 ? 'ns' : ''}`);
            if (vids > 0) parts.push(`${vids} vídeo${vids > 1 ? 's' : ''}`);
            if (auds > 0) parts.push(`${auds} áudio${auds > 1 ? 's' : ''}`);
            if (docs > 0) parts.push(`${docs} arquivo${docs > 1 ? 's' : ''}`);
            attachLabel = ` [${parts.join(', ')}]`;
        }

        addMessage(text + attachLabel, 'user');
        messageInput.value = '';
        messageInput.style.height = 'auto';
        updateSendButtonState();
        clearFile();

        try {
            // Converter TODOS os anexos para base64 (imagens, vídeos, áudios, documentos)
            const fileAttachments = [];
            if (files.length > 0) {
                for (const entry of files) {
                    try {
                        // Usar dataUrl se já tiver (screenshot), senão converter
                        let b64 = entry.dataUrl;
                        if (!b64) {
                            b64 = await new Promise((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onload = () => resolve(reader.result);
                                reader.onerror = reject;
                                reader.readAsDataURL(entry.file);
                            });
                        }
                        fileAttachments.push({
                            data: b64,
                            name: entry.file.name,
                            type: entry.file.type || 'application/octet-stream'
                        });
                    } catch (e) {
                        console.warn('[Lovable Infinity] Falha ao converter anexo:', e);
                    }
                }
            }

            // Envia mensagem limpa + modo + arquivos para o background
            // O background decide se usa Edge Function (Supabase) ou fallback direto
            chrome.runtime.sendMessage({
                action: "sendLovableChat",
                projectId: config.projectId,
                token: config.token,
                message: text,
                mode: sendMode,
                files: fileAttachments.length > 0 ? fileAttachments : undefined
            }, (response) => {
                if (chrome.runtime.lastError) {
                    addSystemMessage("Erro: " + chrome.runtime.lastError.message);
                    return;
                }
                if (response && response.success) {
                    addSystemMessage('Enviado! A resposta aparecerá no Lovable.');
                } else {
                    let debugInfo = '';
                    if (response && response.debug) {
                        debugInfo = `\n[DEBUG] ai_message_id: ${response.debug.ai_message_id || 'NENHUM'} | fonte: ${response.debug.source || '?'}`;
                    }
                    addSystemMessage(`Falha: ${response?.error || 'Erro interno'}${debugInfo}`);
                }
            });
        } catch (error) {
            addSystemMessage(`Erro: ${error.message}`);
        }
    }

    // Limpar histórico da conversa
    async function clearChatHistory() {
        if (config.projectId && currentSessionMessages.length > 0) {
            await addToHistories(config.projectId, formatHistoryTitle(new Date().toISOString()));
        }
        currentSessionMessages = [];
        chatContainer.replaceChildren();
        if (config.projectId) await saveCurrentSession(config.projectId);
    }

    clearHistoryBtn.addEventListener('click', async () => {
        if (chatContainer.children.length === 0) return;
        // Arquiva a conversa atual e limpa o chat (sem confirmação para fluidez)
        await clearChatHistory();
    });

    // Sair: limpar licença/sessão e voltar para a tela de ativação
    logoutBtn.addEventListener('click', async () => {
        if (!confirm('Deseja sair e desativar a licença neste navegador?')) return;
        await chrome.storage.local.remove([
            'isAuthenticated', 'licenseKey', 'authTimestamp', 'userData',
            'deviceFingerprint', 'lovable_token',
            'sessionToken', 'refreshToken', 'sessionExpiresAt'
        ]);
        window.location.href = 'auth.html';
    });

    // Screenshot do preview do Lovable
    if (screenshotBtn) {
        screenshotBtn.addEventListener('click', async () => {
            // Verifica se está no Lovable com projeto aberto
            if (!config.projectId) {
                addSystemMessage('Abra um projeto no Lovable para capturar o preview.');
                return;
            }

            screenshotBtn.disabled = true;
            screenshotBtn.classList.add('loading');
            
            try {
                const devicePixelRatio = window.devicePixelRatio || 1;
                
                const response = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({
                        action: "capturePreviewScreenshot",
                        devicePixelRatio: devicePixelRatio
                    }, resolve);
                });

                if (response && response.success && response.dataUrl) {
                    // Converte dataUrl para File e adiciona ao array de anexos
                    const res = await fetch(response.dataUrl);
                    const blob = await res.blob();
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    const screenshotFile = new File([blob], `preview-${timestamp}.png`, { type: 'image/png' });
                    
                    addAttachment(screenshotFile, response.dataUrl);
                    addSystemMessage('Screenshot capturado! Envie com sua mensagem.');
                } else {
                    addSystemMessage(response?.error || 'Não foi possível capturar o preview.');
                }
            } catch (error) {
                addSystemMessage('Erro ao capturar: ' + (error.message || 'desconhecido'));
            } finally {
                screenshotBtn.disabled = false;
                screenshotBtn.classList.remove('loading');
            }
        });
    }

    // Download do projeto (beta) – por enquanto apenas esqueleto
    async function downloadProject() {
        // Garante que estamos em um projeto do Lovable e com token
        await captureData();
        if (!config.projectId) {
            addSystemMessage('Abra um projeto no Lovable para baixar o código.');
            return;
        }
        if (!config.token) {
            addSystemMessage('Token do Lovable não encontrado. Recarregue a página do projeto.');
            return;
        }

        if (!downloadProjectBtn) return;
        downloadProjectBtn.disabled = true;
        downloadProjectBtn.classList.add('loading');

        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    action: "downloadProject",
                    projectId: config.projectId,
                    token: config.token
                }, resolve);
            });

            if (response && response.success) {
                addSystemMessage(response.message || 'Download do projeto iniciado!');
            } else {
                addSystemMessage(response?.error || 'Erro ao baixar projeto.');
            }
        } catch (e) {
            addSystemMessage('Erro ao iniciar download do projeto: ' + (e.message || 'desconhecido'));
        } finally {
            downloadProjectBtn.disabled = false;
            downloadProjectBtn.classList.remove('loading');
        }
    }

    // Download da página como HTML (captura o preview renderizado)
    async function downloadAsHTML() {
        await captureData();
        if (!config.projectId) {
            addSystemMessage('Abra um projeto no Lovable para capturar a página.');
            return;
        }

        if (!downloadHtmlBtn) return;
        downloadHtmlBtn.disabled = true;
        downloadHtmlBtn.classList.add('loading');
        addSystemMessage('Capturando página... aguarde.');

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                addSystemMessage('Não foi possível identificar a aba ativa.');
                return;
            }

            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    action: "downloadAsHTML",
                    tabId: tab.id,
                    projectId: config.projectId
                }, resolve);
            });

            if (response && response.success) {
                addSystemMessage(response.message || 'Download da página HTML iniciado!');
            } else {
                addSystemMessage(response?.error || 'Erro ao capturar página.');
            }
        } catch (e) {
            addSystemMessage('Erro: ' + (e.message || 'desconhecido'));
        } finally {
            downloadHtmlBtn.disabled = false;
            downloadHtmlBtn.classList.remove('loading');
        }
    }

    // Melhorar prompt: stream da API, texto aparece no input em tempo real
    if (improvePromptBtn) {
        improvePromptBtn.addEventListener('click', async () => {
            const text = messageInput.value.trim();
            if (!text) {
                messageInput.focus();
                return;
            }
            const endpoint = (typeof CONFIG !== 'undefined' && CONFIG.IMPROVE_PROMPT_ENDPOINT) ? CONFIG.IMPROVE_PROMPT_ENDPOINT : '';
            if (!endpoint) {
                addSystemMessage('Melhorador de prompt não configurado.');
                return;
            }
            improvePromptBtn.disabled = true;
            improvePromptBtn.classList.add('loading');
            improvePromptBtn.setAttribute('aria-busy', 'true');
            improvePromptBtn.title = 'Melhorando...';
            messageInput.readOnly = true;
            messageInput.classList.add('improving');
            messageInput.placeholder = 'Melhorando prompt...';
            attachBtn.disabled = true;
            sendBtn.disabled = true;
            
            try {
                // Envia JWT + apikey do Supabase no header
                const _sessionToken = typeof getSessionToken === 'function' ? await getSessionToken() : null;
                const _headers = typeof getSupabaseHeaders === 'function' ? getSupabaseHeaders() : { 'Content-Type': 'application/json' };
                if (_sessionToken) _headers['Authorization'] = 'Bearer ' + _sessionToken;

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: _headers,
                    body: JSON.stringify({ text: text, stream: false })
                });
                
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    addSystemMessage(errData.error || response.statusText || 'Erro ao melhorar prompt.');
                    return;
                }
                
                const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
                const isJson = contentType.includes('application/json');
                let fullText = '';
                
                if (isJson) {
                    const json = await response.json();
                    if (json.error) {
                        addSystemMessage(json.error);
                        return;
                    }
                    const msg = json.text ?? json.choices?.[0]?.message?.content ?? json.message ?? '';
                    fullText = typeof msg === 'string' ? msg.trim() : '';
                } else {
                    // Stream SSE
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    messageInput.value = '';
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const parts = buffer.split('\n\n');
                        buffer = parts.pop() || '';
                        for (const part of parts) {
                            if (part.startsWith('data: ')) {
                                const payload = part.slice(6).trim();
                                if (payload === '[DONE]') continue;
                                try {
                                    const data = JSON.parse(payload);
                                    const content = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content;
                                    if (content) {
                                        messageInput.value += content;
                                        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
                                    }
                                } catch (_) {}
                            }
                        }
                    }
                    fullText = messageInput.value;
                }
                
                if (fullText) {
                    messageInput.value = fullText;
                    messageInput.dispatchEvent(new Event('input', { bubbles: true }));
                    messageInput.scrollTop = messageInput.scrollHeight;
                    updateSendButtonState();
                }
                messageInput.focus();
            } catch (e) {
                addSystemMessage('Erro: ' + (e.message || 'desconhecido'));
            } finally {
                improvePromptBtn.disabled = false;
                improvePromptBtn.classList.remove('loading');
                improvePromptBtn.removeAttribute('aria-busy');
                improvePromptBtn.title = 'Melhorar prompt com IA';
                messageInput.readOnly = false;
                messageInput.classList.remove('improving');
                messageInput.placeholder = 'Enviar mensagem...';
                attachBtn.disabled = false;
                sendBtn.disabled = false;
                updateSendButtonState();
            }
        });
    }

    // ============================================
    // DIGITAÇÃO POR VOZ (Speech-to-Text via Gemini)
    // Grava áudio via content script no lovable.dev (HTTPS)
    // ============================================
    if (voiceBtn) {
        let voiceIsRecording = false;
        let voiceRecordingTimer = null;
        let voiceTimerEl = null;
        let voiceStartTime = 0;
        const VOICE_MAX_DURATION = 120000; // 2 minutos
        let voiceAutoStopTimeout = null;
        let voiceActiveTabId = null;

        function voiceUpdateTimer() {
            if (!voiceTimerEl) return;
            const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
            const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const secs = String(elapsed % 60).padStart(2, '0');
            voiceTimerEl.textContent = mins + ':' + secs;
        }

        function voiceShowTimer() {
            voiceTimerEl = document.createElement('span');
            voiceTimerEl.className = 'voice-timer';
            voiceTimerEl.textContent = '00:00';
            voiceBtn.appendChild(voiceTimerEl);
        }

        function voiceHideTimer() {
            if (voiceTimerEl) {
                voiceTimerEl.remove();
                voiceTimerEl = null;
            }
        }

        function voiceSetState(state) {
            voiceBtn.classList.remove('voice-recording', 'voice-processing');
            voiceBtn.disabled = false;
            if (state === 'recording') {
                voiceBtn.classList.add('voice-recording');
                voiceBtn.title = 'Parar gravação';
            } else if (state === 'processing') {
                voiceBtn.classList.add('voice-processing');
                voiceBtn.disabled = true;
                voiceBtn.title = 'Transcrevendo...';
            } else {
                voiceBtn.title = 'Digitação por voz';
            }
        }

        async function voiceGetLovableTab() {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tab = tabs[0];
            if (!tab || !tab.url || !tab.url.includes('lovable.dev')) {
                return null;
            }
            return tab;
        }

        async function voiceStartRecording() {
            const tab = await voiceGetLovableTab();
            if (!tab) {
                addSystemMessage('Abra o Lovable.dev para usar a digitação por voz.');
                return;
            }
            voiceActiveTabId = tab.id;

            try {
                const result = await chrome.tabs.sendMessage(tab.id, { action: 'voiceStartRecording' });
                if (!result || !result.success) {
                    if (result && result.needsPermission) {
                        addSystemMessage('Permita o acesso ao microfone no popup que apareceu no topo da página do Lovable.');
                    } else {
                        addSystemMessage(result?.error || 'Erro ao iniciar gravação.');
                    }
                    voiceSetState('idle');
                    return;
                }

                voiceIsRecording = true;
                voiceSetState('recording');
                voiceStartTime = Date.now();
                voiceShowTimer();
                voiceRecordingTimer = setInterval(voiceUpdateTimer, 1000);

                voiceAutoStopTimeout = setTimeout(() => {
                    if (voiceIsRecording) voiceStopRecording();
                }, VOICE_MAX_DURATION);

            } catch (err) {
                addSystemMessage('Erro ao conectar com a página. Recarregue o Lovable.dev e tente novamente.');
                voiceSetState('idle');
            }
        }

        async function voiceStopRecording() {
            if (!voiceIsRecording) return;
            voiceIsRecording = false;
            clearInterval(voiceRecordingTimer);
            clearTimeout(voiceAutoStopTimeout);
            voiceHideTimer();
            voiceSetState('processing');
            messageInput.readOnly = true;
            messageInput.classList.add('improving');
            messageInput.placeholder = 'Transcrevendo áudio...';

            if (voiceActiveTabId) {
                try {
                    await chrome.tabs.sendMessage(voiceActiveTabId, { action: 'voiceStopRecording' });
                } catch (_) {}
            }
            // O áudio chega via 'voiceRecordingResult' pelo chrome.runtime.onMessage
        }

        // Listener para receber o áudio gravado pelo content script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action !== 'voiceRecordingResult') return;

            (async () => {
                try {
                    if (!message.success || !message.audio) {
                        addSystemMessage(message.error || 'Erro na gravação.');
                        return;
                    }

                    const endpoint = (typeof CONFIG !== 'undefined' && CONFIG.TRANSCRIBE_AUDIO_ENDPOINT)
                        ? CONFIG.TRANSCRIBE_AUDIO_ENDPOINT : '';
                    if (!endpoint) {
                        addSystemMessage('Endpoint de transcrição não configurado.');
                        return;
                    }

                    const _sessionToken = typeof getSessionToken === 'function' ? await getSessionToken() : null;
                    const _headers = typeof getSupabaseHeaders === 'function' ? getSupabaseHeaders() : { 'Content-Type': 'application/json' };
                    if (_sessionToken) _headers['Authorization'] = 'Bearer ' + _sessionToken;

                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: _headers,
                        body: JSON.stringify({
                            action: 'transcribe',
                            audio: message.audio,
                            format: message.format || 'webm'
                        })
                    });

                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        addSystemMessage(errData.error || response.statusText || 'Erro ao transcrever áudio.');
                        return;
                    }

                    const json = await response.json();
                    if (json.error) {
                        addSystemMessage(json.error);
                        return;
                    }

                    const transcribedText = (json.text || '').trim();
                    if (transcribedText) {
                        const current = messageInput.value;
                        if (current && !current.endsWith(' ') && !current.endsWith('\n')) {
                            messageInput.value = current + ' ' + transcribedText;
                        } else {
                            messageInput.value = current + transcribedText;
                        }
                        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
                        messageInput.scrollTop = messageInput.scrollHeight;
                        updateSendButtonState();
                        messageInput.focus();
                    } else {
                        addSystemMessage('Nenhuma fala detectada no áudio.');
                    }
                } catch (e) {
                    addSystemMessage('Erro na transcrição: ' + (e.message || 'desconhecido'));
                } finally {
                    voiceSetState('idle');
                    messageInput.readOnly = false;
                    messageInput.classList.remove('improving');
                    messageInput.placeholder = 'Enviar mensagem...';
                }
            })();
        });

        voiceBtn.addEventListener('click', () => {
            if (voiceIsRecording) {
                voiceStopRecording();
            } else {
                voiceStartRecording();
            }
        });
    }

    // Toggle de modo removido - modo fixo em 'error'

    // Event Listeners
    sendBtn.addEventListener('click', sendMessage);
    if (downloadProjectBtn) {
        downloadProjectBtn.addEventListener('click', downloadProject);
    }
    if (downloadHtmlBtn) {
        downloadHtmlBtn.addEventListener('click', downloadAsHTML);
    }

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
        updateSendButtonState();
    });

    function isOnLovableTab(url) {
        if (!url) return false;
        try {
            const u = new URL(url);
            return u.origin === 'https://lovable.dev';
        } catch (_) {
            return false;
        }
    }

    async function captureData() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) {
            config.projectId = '';
            return;
        }
        if (!isOnLovableTab(tab.url)) {
            config.projectId = '';
            return;
        }
        const projectMatch = tab.url.match(/projects\/([a-zA-Z0-9-]+)/);
        if (projectMatch && projectMatch[1]) {
            config.projectId = projectMatch[1];
        } else {
            config.projectId = '';
        }
        if (!config.token) {
            const freshStore = await chrome.storage.local.get(['lovable_token']);
            if (freshStore.lovable_token) {
                config.token = freshStore.lovable_token;
                updateTokenDisplay(config.token);
            }
        }
    }

    // Atualiza overlay baseado no estado atual
    function updateOverlayState() {
        if (!lovableRequiredOverlay) return;
        
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            const tab = tabs && tabs[0];
            const url = tab?.url || '';
            const onLovable = isOnLovableTab(url);
            const hasProject = !!config.projectId;
            
            if (!onLovable) {
                // Fora do Lovable completamente
                lovableRequiredOverlay.innerHTML = `
                    <p class="lovable-required-text">Abra o Lovable.dev para usar a extensão.</p>
                    <p class="lovable-required-hint">A extensão só funciona em abas de projeto do Lovable.</p>
                `;
                lovableRequiredOverlay.style.display = 'flex';
            } else if (!hasProject) {
                // No Lovable, mas sem projeto aberto
                lovableRequiredOverlay.innerHTML = `
                    <p class="lovable-required-text">Acesse um projeto para começar</p>
                    <p class="lovable-required-hint">Selecione ou crie um projeto no Lovable para editar.</p>
                `;
                lovableRequiredOverlay.style.display = 'flex';
            } else {
                // No Lovable com projeto aberto
                lovableRequiredOverlay.style.display = 'none';
            }
        });
    }

    // Captura dados e carrega histórico no carregamento inicial
    let currentProjectId = '';
    
    async function initializeForCurrentTab() {
        await captureData();
        
        // Se mudou de projeto, recarrega o histórico
        if (config.projectId !== currentProjectId) {
            currentProjectId = config.projectId;
            currentSessionMessages = [];
            chatContainer.replaceChildren();
            
            if (config.projectId) {
                await loadChatState(config.projectId);
            }
        }
        
        updateOverlayState();
    }
    
    // Inicialização
    await initializeForCurrentTab();
    
    // Detecta quando a aba atualiza (navegação, refresh)
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        // Só processa se a URL mudou e o carregamento completou
        if (changeInfo.status === 'complete' && tab.active) {
            await initializeForCurrentTab();
        }
    });
    
    // Detecta quando o usuário troca de aba
    chrome.tabs.onActivated.addListener(async () => {
        await initializeForCurrentTab();
    });

    // Listen for storage changes in real-time
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.lovable_token) {
            config.token = changes.lovable_token.newValue;
            updateTokenDisplay(config.token);
        }
    });

    // Initial state check
    updateSendButtonState();
});
