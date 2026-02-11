// ============================================
// CONTENT SCRIPT - Lovable Infinity
// ============================================

// ============================================
// EXTRATOR PASSIVO: Tenta extrair ai_message_id periodicamente
// Usa injeção via <script> (pode ser bloqueado pelo CSP).
// O método principal agora é chrome.scripting.executeScript no background.js
// ============================================
(function setupAiMsgIdExtractor() {
  const extractorCode = `(function(){
    if(window.__lovableAimsgExtractorActive) return;
    window.__lovableAimsgExtractorActive=true;
    function extractAiMsgIds(){
      try{
        var found=[];
        var visited=new WeakSet();
        function searchObj(obj,depth){
          if(depth>4||!obj||typeof obj!=='object'||found.length>200) return;
          try{if(visited.has(obj))return;visited.add(obj);}catch(e){return;}
          try{
            var keys=Object.keys(obj);
            for(var i=0;i<keys.length;i++){
              try{
                var val=obj[keys[i]];
                if(typeof val==='string'){
                  var m=val.match(/aimsg_[a-z0-9]{10,}/g);
                  if(m) m.forEach(function(id){if(found.indexOf(id)===-1)found.push(id);});
                }else if(typeof val==='object'&&val!==null){
                  searchObj(val,depth+1);
                }
              }catch(e){}
            }
          }catch(e){}
        }
        function scanFiber(fiber,d){
          if(d>60||!fiber||found.length>200) return;
          try{if(visited.has(fiber))return;visited.add(fiber);}catch(e){return;}
          if(fiber.memoizedProps) searchObj(fiber.memoizedProps,0);
          var state=fiber.memoizedState;var sc=0;
          while(state&&sc<30){
            if(state.memoizedState!=null){
              if(typeof state.memoizedState==='string'){
                var m=state.memoizedState.match(/aimsg_[a-z0-9]{10,}/g);
                if(m) m.forEach(function(id){if(found.indexOf(id)===-1)found.push(id);});
              }else if(typeof state.memoizedState==='object'){
                searchObj(state.memoizedState,0);
              }
            }
            state=state.next;sc++;
          }
          if(fiber.child) scanFiber(fiber.child,d+1);
          if(fiber.sibling) scanFiber(fiber.sibling,d+1);
        }
        var allEls=document.querySelectorAll('*');
        for(var i=0;i<allEls.length;i++){
          var el=allEls[i];
          var keys=Object.keys(el);
          for(var k=0;k<keys.length;k++){
            if(keys[k].indexOf('__reactFiber')===0||keys[k].indexOf('__reactInternalInstance')===0){
              scanFiber(el[keys[k]],0);
              break;
            }
          }
        }
        if(found.length>0){
          window.postMessage({type:'LOVABLE_AIMSG_EXTRACTED',ids:found},'*');
        }
      }catch(e){}
    }
    if(document.readyState==='complete'){extractAiMsgIds();}
    else{window.addEventListener('load',function(){setTimeout(extractAiMsgIds,3000);});}
    setInterval(extractAiMsgIds,15000);
  })();`;

  function injectExtractor() {
    try {
      const script = document.createElement('script');
      script.textContent = extractorCode;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {
      console.warn('[Lovable Infinity] Falha ao injetar extrator (CSP?):', e.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(injectExtractor, 3000));
  } else {
    setTimeout(injectExtractor, 2000);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'LOVABLE_AIMSG_EXTRACTED' && event.data.ids && event.data.ids.length > 0) {
      const lastId = event.data.ids[event.data.ids.length - 1];
      chrome.storage.local.set({ lovable_last_aimsg: lastId });
      console.log('[Lovable Infinity] ai_message_id extraído via content script:', lastId, '(total:', event.data.ids.length, ')');
    }
  });
})();

// ============================================
// OCULTADOR CIRÚRGICO v3
// Alvo: div.relative DENTRO de div#umsg_ que contém texto de erro
// NUNCA toca em div#aimsg_ (respostas do AI)
// PRESERVA timestamps
// Usa inline style (resiste a re-renders do React)
// Re-verifica a cada mutação (sem cache de IDs processados)
// ============================================
(function setupErrorFixHider() {
  const MARKERS = [
    'Fix these issues',
    'fix these issues',
    'For the code present, I get the error below',
    'Please think step-by-step in order to resolve it'
  ];

  // Só pra não spammar console
  const logged = new Set();

  function run() {
    // SOMENTE div#umsg_ — jamais div#aimsg_
    document.querySelectorAll('div[id^="umsg_"]').forEach(umsg => {
      const txt = umsg.textContent || '';
      if (!MARKERS.some(m => txt.includes(m))) return;

      // Estrutura real do DOM (confirmada pelo usuário):
      //   div#umsg_ > div (wrapper)
      //     > div.mb-2...items-center.text-muted-foreground  ← TIMESTAMP (manter)
      //     > div.relative                                    ← BOLHA (esconder)
      //       > div.group...items-end.pr-4
      const wrapper = umsg.firstElementChild;
      if (!wrapper) return;

      // Busca SOMENTE filhos diretos do wrapper que tenham classe "relative"
      for (const child of wrapper.children) {
        if (child.classList && child.classList.contains('relative')) {
          // Inline style — React não remove isso
          child.style.setProperty('display', 'none', 'important');
        }
      }

      if (!logged.has(umsg.id)) {
        logged.add(umsg.id);
        console.log('[Lovable Infinity] Bolha error-fix ocultada:', umsg.id);
      }
    });
  }

  // MutationObserver — re-aplica a cada mudança no DOM
  let timer = null;
  const obs = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });

  function start() {
    obs.observe(document.body, { childList: true, subtree: true });
    run();
    setTimeout(run, 1000);
    setTimeout(run, 3000);
    setTimeout(run, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(start, 500));
  } else {
    start();
  }

  // Listener: background avisa que acabou de enviar uma mensagem error-fix
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'hideErrorFixMessages') {
      run();
      setTimeout(run, 500);
      setTimeout(run, 1500);
      setTimeout(run, 3500);
      setTimeout(run, 6000);
      sendResponse({ ok: true });
    }
  });
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
