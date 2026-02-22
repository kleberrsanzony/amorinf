// ============================================
// CONTENT SCRIPT - Lovable Infinity
// ============================================

// ============================================
// CAPTURA DE ai_message_id VIA MUTATION OBSERVER
// Método confiável: observa o DOM em tempo real para detectar
// novos elementos div[id^="aimsg_"] adicionados pelo React
// (Mesmo método usado pela Leigos Academy)
// ============================================
(function setupAiMsgIdObserver() {
  if (window.__lovableAimsgObserverActive) return;
  window.__lovableAimsgObserverActive = true;

  let lastAiMsgId = null;

  // Função recursiva para encontrar aimsg_ IDs em nós adicionados
  function checkNodeForAiMsgId(node) {
    if (node.nodeType !== 1) return; // Só elementos DOM
    // Verifica o próprio nó
    if (node.id && node.id.startsWith('aimsg_')) {
      lastAiMsgId = node.id;
      chrome.storage.local.set({ lovable_last_aimsg: node.id });
      console.log('[Lovable Infinity] ai_message_id capturado via MutationObserver:', node.id);
    }
    // Verifica filhos (nós podem ser inseridos em batch)
    if (node.querySelectorAll) {
      const children = node.querySelectorAll('div[id^="aimsg_"]');
      if (children.length > 0) {
        const latest = children[children.length - 1];
        lastAiMsgId = latest.id;
        chrome.storage.local.set({ lovable_last_aimsg: latest.id });
        console.log('[Lovable Infinity] ai_message_id capturado via MutationObserver (filho):', latest.id);
      }
    }
  }

  // Configurar MutationObserver
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        checkNodeForAiMsgId(node);
      }
    }
  });

  // Iniciar observação quando o body estiver disponível
  function startObserving() {
    if (!document.body) {
      // Body ainda não existe, tentar novamente
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserving);
      } else {
        setTimeout(startObserving, 500);
      }
      return;
    }

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    console.log('[Lovable Infinity] MutationObserver ativo para ai_message_id');

    // Scan inicial: capturar IDs já presentes na página
    const existing = document.querySelectorAll('div[id^="aimsg_"]');
    if (existing.length > 0) {
      const latest = existing[existing.length - 1];
      lastAiMsgId = latest.id;
      chrome.storage.local.set({ lovable_last_aimsg: latest.id });
      console.log('[Lovable Infinity] ai_message_id existente capturado:', latest.id, '(total:', existing.length, ')');
    }
  }

  startObserving();
})();

// Aplicar ocultação da marca d'água ao carregar (e reaplicar para iframes que carregam depois)
(function applyWatermarkPreferenceOnLoad() {
  function requestApply() {
    chrome.storage.local.get(['hideLovableWatermark'], function (data) {
      if (data.hideLovableWatermark) {
        chrome.runtime.sendMessage({ action: 'applyWatermarkPreference' }, function () {});
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', requestApply);
  } else {
    requestApply();
  }
  setTimeout(requestApply, 2500);
})();

// ============================================
// SCROLL AUTOMÁTICO NO CHAT DO LOVABLE
// Força scroll para o fim quando o chat do Lovable recebe novo conteúdo.
// ============================================
(function setupLovableChatAutoScroll() {
  if (window.__lovableChatScrollActive) return;
  window.__lovableChatScrollActive = true;

  function getScrollableParent(el) {
    let node = el && el.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      const overflowY = style.overflowY || style.overflow;
      const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
        node.scrollHeight > node.clientHeight;
      if (isScrollable) return node;
      node = node.parentElement;
    }
    return null;
  }

  function scrollChatToBottom(targetEl) {
    const container = targetEl && getScrollableParent(targetEl);
    if (container) {
      try {
        container.scrollTop = container.scrollHeight;
      } catch (e) { /* ignore */ }
    }
  }

  let scrollScheduled = false;
  function scheduleScrollToBottom(addedNode) {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      scrollChatToBottom(addedNode);
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        // Novo nó no DOM: tenta rolar o container scrollável que o contém
        scheduleScrollToBottom(node);
        // Também verifica se o nó em si é um container de chat (ex.: painel de mensagens)
        if (node.querySelector && node.querySelector('[id^="aimsg_"]')) {
          scheduleScrollToBottom(node);
        }
      }
    }
  });

  function startChatScrollObserving() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startChatScrollObserving);
      } else {
        setTimeout(startChatScrollObserving, 300);
      }
      return;
    }
    observer.observe(document.body, { childList: true, subtree: true });
    // Scroll inicial: após um tempo, tenta rolar qualquer container que pareça chat (com aimsg_)
    setTimeout(() => {
      const withAimsg = document.querySelector('[id^="aimsg_"]');
      if (withAimsg) scrollChatToBottom(withAimsg);
    }, 1500);
    console.log('[Lovable Infinity] Auto-scroll do chat do Lovable ativado.');
  }

  startChatScrollObserving();
})();

// Listener para mensagens do background/popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // Backup method: try to read token from LocalStorage
  if (request.action === "getToken") {
    let token = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        // Procura por token no localStorage
        if (val && val.includes("ey") && val.includes("access_token")) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.access_token || parsed.session?.access_token) {
              token = parsed.access_token || parsed.session.access_token;
              break;
            }
          } catch (e) { }
        }
      }
    } catch (e) { }
    sendResponse({ token: token });
  }

  // Ping (verificação de script injetado)
  if (request.action === "ping") {
    sendResponse("pong");
  }

  // Token encontrado (Apenas log no console, sem UI)
  if (request.action === "tokenFound") {
    console.log("[Lovable Assistant] Token capturado com sucesso.");
  }

  // ============================================
  // GRAVAÇÃO DE ÁUDIO (Digitação por voz)
  // Gravamos em WebM e convertemos para WAV para a API (OpenRouter/Gemini aceitam WAV).
  // getUserMedia funciona aqui pois estamos no contexto do lovable.dev (HTTPS)
  // ============================================
  function audioBufferToWavBlob(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2;
    const arrayBuffer = new ArrayBuffer(44 + length);
    const view = new DataView(arrayBuffer);
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, length, true);
    const left = buffer.getChannelData(0);
    const right = numChannels > 1 ? buffer.getChannelData(1) : left;
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7FFF, true);
      offset += 2;
      if (numChannels > 1) {
        const r = Math.max(-1, Math.min(1, right[i]));
        view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  if (request.action === "voiceStartRecording") {
    let responded = false;
    const safeSendResponse = (payload) => {
      if (responded) return;
      responded = true;
      try { sendResponse(payload); } catch (e) { console.warn('[Lovable Infinity] sendResponse:', e); }
    };

    (async () => {
      const timeout = setTimeout(() => {
        safeSendResponse({ success: false, error: 'Timeout. Permita o microfone na página do Lovable.' });
      }, 12000);

      try {
        // Parar gravação anterior se existir
        if (window.__voiceRecorder && window.__voiceRecorder.state === 'recording') {
          window.__voiceRecorder.stop();
          if (window.__voiceStream) window.__voiceStream.getTracks().forEach(t => t.stop());
        }

        window.__voiceChunks = [];
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        clearTimeout(timeout);
        window.__voiceStream = stream;

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';

        const options = mimeType ? { mimeType } : {};
        const recorder = new MediaRecorder(stream, options);
        window.__voiceRecorder = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) window.__voiceChunks.push(e.data);
        };

        recorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          window.__voiceStream = null;

          if (!window.__voiceChunks || window.__voiceChunks.length === 0) {
            sendVoiceResult(false, 'Nenhum dado de áudio capturado');
            return;
          }

          const webmBlob = new Blob(window.__voiceChunks, { type: recorder.mimeType || 'audio/webm' });
          const formatFromMime = (recorder.mimeType || 'audio/webm').includes('webm') ? 'webm' : 'mp3';

          function sendVoiceResult(success, errorOrNull, base64, format) {
            try {
              chrome.runtime.sendMessage({
                action: 'voiceRecordingResult',
                success: !!success,
                error: success ? undefined : (errorOrNull || 'Erro ao processar áudio'),
                audio: base64 || undefined,
                format: format || 'webm'
              });
            } catch (e) {
              console.warn('[Lovable Infinity] sendVoiceResult:', e);
            }
          }

          try {
            const arrayBuffer = await webmBlob.arrayBuffer();
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) {
              throw new Error('AudioContext não disponível');
            }
            const audioCtx = new Ctx();
            const decoded = await audioCtx.decodeAudioData(arrayBuffer);
            const wavBlob = audioBufferToWavBlob(decoded);
            audioCtx.close();

            const reader = new FileReader();
            reader.onloadend = function () {
              try {
                const dataUrl = (reader.result && typeof reader.result === 'string') ? reader.result : '';
                const base64 = dataUrl.indexOf(',') >= 0 ? dataUrl.split(',')[1] : '';
                if (!base64 || base64.length < 100) {
                  sendVoiceResult(false, 'Áudio gravado está vazio ou muito curto.');
                  return;
                }
                sendVoiceResult(true, null, base64, 'wav');
              } catch (e) {
                sendVoiceResult(false, (e && e.message) || 'Erro ao converter áudio');
              }
            };
            reader.onerror = function () {
              sendVoiceResult(false, 'Erro ao ler áudio');
            };
            reader.readAsDataURL(wavBlob);
          } catch (err) {
            try {
              const reader = new FileReader();
              reader.onloadend = function () {
                try {
                  const dataUrl = (reader.result && typeof reader.result === 'string') ? reader.result : '';
                  const base64 = dataUrl.indexOf(',') >= 0 ? dataUrl.split(',')[1] : '';
                  if (base64 && base64.length >= 100) {
                    sendVoiceResult(true, null, base64, formatFromMime);
                  } else {
                    sendVoiceResult(false, (err && err.message) || 'Erro ao processar áudio');
                  }
                } catch (_) {
                  sendVoiceResult(false, (err && err.message) || 'Erro ao processar áudio');
                }
              };
              reader.onerror = function () { sendVoiceResult(false, (err && err.message) || 'Erro ao processar áudio'); };
              reader.readAsDataURL(webmBlob);
            } catch (fallbackErr) {
              sendVoiceResult(false, (err && err.message) || 'Erro ao processar áudio');
            }
          }
        };

        recorder.start(250);
        safeSendResponse({ success: true });
      } catch (err) {
        clearTimeout(timeout);
        const isPermission = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
        safeSendResponse({
          success: false,
          error: err.message || 'Erro ao acessar microfone',
          needsPermission: isPermission
        });
      }
    })();
    return true; // resposta assíncrona
  }

  if (request.action === "voiceStopRecording") {
    if (window.__voiceRecorder && window.__voiceRecorder.state === 'recording') {
      window.__voiceRecorder.stop();
    }
    sendResponse({ success: true });
  }

  // Captura screenshot do iframe de preview do Lovable
  if (request.action === "capturePreview") {
    (async () => {
      try {
        // Tenta encontrar o iframe de preview do Lovable
        // O Lovable usa um iframe para mostrar o preview da aplicação
        const previewSelectors = [
          'iframe[title*="preview"]',
          'iframe[title*="Preview"]',
          'iframe[src*="webcontainer"]',
          'iframe[class*="preview"]',
          '[data-testid="preview"] iframe',
          '.preview-container iframe',
          '[class*="PreviewFrame"] iframe',
          'iframe'
        ];

        let previewIframe = null;
        let previewElement = null;

        // Tenta encontrar o iframe específico do preview
        for (const selector of previewSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            // Verifica se o iframe tem dimensões razoáveis (não é um tracker/ad)
            const rect = el.getBoundingClientRect();
            if (rect.width > 200 && rect.height > 200) {
              // Prioriza iframes que parecem ser de preview (maiores, à direita)
              if (!previewIframe || rect.width > previewIframe.getBoundingClientRect().width) {
                previewIframe = el;
              }
            }
          }
          if (previewIframe) break;
        }

        // Se não encontrou iframe, tenta capturar a área de preview diretamente
        if (!previewIframe) {
          const previewAreaSelectors = [
            '[data-testid="preview"]',
            '.preview-container',
            '[class*="Preview"]',
            '[class*="preview"]',
            'main > div:last-child' // Área direita geralmente é o preview
          ];

          for (const selector of previewAreaSelectors) {
            const el = document.querySelector(selector);
            if (el) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 200 && rect.height > 200) {
                previewElement = el;
                break;
              }
            }
          }
        }

        if (!previewIframe && !previewElement) {
          sendResponse({ success: false, error: 'Preview não encontrado. Abra um projeto com preview.' });
          return;
        }

        // Obtém as coordenadas do elemento para captura
        const targetEl = previewIframe || previewElement;
        const rect = targetEl.getBoundingClientRect();

        // Solicita captura da aba visível ao background
        sendResponse({ 
          success: true, 
          needsCapture: true,
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        });

      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Indica resposta assíncrona
  }
});
