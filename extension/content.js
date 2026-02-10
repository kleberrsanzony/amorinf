// ============================================
// CONTENT SCRIPT - Lovable Infinity
// ============================================

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
  // getUserMedia funciona aqui pois estamos no contexto do lovable.dev (HTTPS)
  // ============================================
  if (request.action === "voiceStartRecording") {
    (async () => {
      try {
        // Parar gravação anterior se existir
        if (window.__voiceRecorder && window.__voiceRecorder.state === 'recording') {
          window.__voiceRecorder.stop();
          if (window.__voiceStream) window.__voiceStream.getTracks().forEach(t => t.stop());
        }

        window.__voiceChunks = [];
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
            chrome.runtime.sendMessage({
              action: 'voiceRecordingResult',
              success: false,
              error: 'Nenhum dado de áudio capturado'
            });
            return;
          }

          try {
            const blob = new Blob(window.__voiceChunks, { type: recorder.mimeType || 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result.split(',')[1] || '';
              const format = (recorder.mimeType || 'audio/webm').includes('webm') ? 'webm' : 'mp3';
              chrome.runtime.sendMessage({
                action: 'voiceRecordingResult',
                success: true,
                audio: base64,
                format: format
              });
            };
            reader.onerror = () => {
              chrome.runtime.sendMessage({
                action: 'voiceRecordingResult',
                success: false,
                error: 'Erro ao converter áudio'
              });
            };
            reader.readAsDataURL(blob);
          } catch (err) {
            chrome.runtime.sendMessage({
              action: 'voiceRecordingResult',
              success: false,
              error: err.message || 'Erro ao processar áudio'
            });
          }
        };

        recorder.start(250);
        sendResponse({ success: true });
      } catch (err) {
        const isPermission = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
        sendResponse({
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
