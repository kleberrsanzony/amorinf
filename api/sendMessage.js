/**
 * POST /api/sendMessage — Proxy server-side para envio de mensagens ao Lovable API
 * Faz upload de arquivos, monta payload e envia para api.lovable.dev
 */
const { parseBody } = require('./_lib/firebaseAdmin');
const crypto = require('crypto');

// Geração de IDs no formato Lovable (Crockford Base32)
const CROCKFORD_CHARS = '0123456789abcdefghjkmnpqrstvwxyz';
function generateCrockfordId(length) {
  let result = '';
  const arr = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += CROCKFORD_CHARS[arr[i] % CROCKFORD_CHARS.length];
  }
  return result;
}
function generateMsgId() { return 'umsg_' + generateCrockfordId(28); }
function generateErrorId() { return 'error_' + generateCrockfordId(28); }
function generateAiMsgId() { return 'aimsg_' + generateCrockfordId(28); }

function buildErrorFixPayload(userMessage, aiMessageId) {
  const now = Date.now();
  const errorMsg = `Application behavior does not match expected output. User reports: ${userMessage}`;
  const stackTrace = `Error: ${errorMsg}\n    at UserFeedbackHandler (src/components/App.tsx:142:8)\n    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)\n    at mountIndeterminateComponent (node_modules/react-dom/cjs/react-dom.development.js:17811:13)`;
  const errorDetail = { timestamp: now, error_type: 'RUNTIME_ERROR', filename: 'src/components/App.tsx', lineno: 142, colno: 8, stack: stackTrace, has_blank_screen: false };
  const formattedMessage = `Fix these issues\n\n${errorMsg}\n\n\`\`\`\n${JSON.stringify(errorDetail, null, 2)}\n\`\`\`\n`;
  return {
    id: generateMsgId(), message: formattedMessage, mode: 'instant', contains_error: true,
    error_ids: [generateErrorId()], ai_message_id: aiMessageId || generateAiMsgId(),
    current_page: '/', view: 'preview',
    view_description: 'The user is currently viewing the preview. ', model: null,
    session_replay: '[]', client_logs: [], network_requests: [],
    runtime_errors: [{ timestamp: now - 1000, error_type: 'RUNTIME_ERROR', message: errorMsg, filename: 'src/components/App.tsx', lineno: 142, colno: 8, stack: stackTrace, has_blank_screen: false }],
    integration_metadata: { browser: { preview_viewport_width: 960, preview_viewport_height: 861 } },
  };
}

function buildMinimalPayload(userMessage, aiMessageId) {
  return {
    id: generateMsgId(), message: userMessage, mode: 'instant', contains_error: true,
    ai_message_id: aiMessageId || generateAiMsgId(), current_page: '/', view: 'code',
    view_description: 'The user is currently viewing the code.', model: null,
  };
}

async function uploadFileToLovable(fileData, token, gitSha) {
  const uploadHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (gitSha) uploadHeaders['X-Client-Git-SHA'] = gitSha;

  try {
    const uploadUrlResp = await fetch('https://api.lovable.dev/files/generate-upload-url', {
      method: 'POST', headers: uploadHeaders,
      body: JSON.stringify({ file_name: fileData.name, content_type: fileData.type, status: 'uploading' }),
    });
    if (!uploadUrlResp.ok) { console.warn(`[sendMessage] Falha ao obter upload URL: ${uploadUrlResp.status}`); return null; }

    const uploadUrlData = await uploadUrlResp.json();
    const signedUrl = uploadUrlData.url;
    let fileId = uploadUrlData.id || uploadUrlData.file_id || null;
    if (!signedUrl) return null;

    const base64Match = fileData.data.match(/^data:[^;]+;base64,(.+)$/);
    if (!base64Match) return null;
    const buf = Buffer.from(base64Match[1], 'base64');

    const putResp = await fetch(signedUrl, { method: 'PUT', body: buf, headers: { 'Content-Type': fileData.type } });
    if (!putResp.ok) { console.warn(`[sendMessage] PUT falhou: ${putResp.status}`); return null; }

    if (!fileId) {
      const urlMatch = signedUrl.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (urlMatch) fileId = urlMatch[1];
    }
    if (!fileId) return null;

    console.log(`[sendMessage] Upload concluído: ${fileData.name} (${fileId})`);
    return { file_id: fileId, file_name: fileData.name, type: 'user_upload' };
  } catch (err) {
    console.warn(`[sendMessage] Erro no upload de ${fileData.name}:`, err.message);
    return null;
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-client-info');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = parseBody(req);
    const { token, projectId, message, files, mode, ai_message_id, git_sha } = body;

    if (!token || !projectId || !message) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios: token, projectId, message' });
    }

    // 1. Upload de arquivos
    const uploadedFiles = [];
    const optimisticImageUrls = [];
    if (files && Array.isArray(files) && files.length > 0) {
      console.log(`[sendMessage] Enviando ${files.length} arquivo(s)...`);
      for (const fileData of files) {
        const uploaded = await uploadFileToLovable(fileData, token, git_sha);
        if (uploaded) {
          uploadedFiles.push(uploaded);
          if (fileData.type && fileData.type.startsWith('image/')) {
            optimisticImageUrls.push(`https://storage.googleapis.com/lovable-uploads/${uploaded.file_id}`);
          }
        }
      }
      console.log(`[sendMessage] ${uploadedFiles.length}/${files.length} arquivo(s) enviados`);
    }

    // 2. Montar payload
    let payload;
    if (mode === 'min') {
      payload = buildMinimalPayload(message, ai_message_id);
    } else {
      payload = buildErrorFixPayload(message, ai_message_id);
    }
    if (uploadedFiles.length > 0) {
      payload.files = uploadedFiles;
      if (optimisticImageUrls.length > 0) payload.optimisticImageUrls = optimisticImageUrls;
    }

    // 3. Enviar para Lovable API
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (git_sha) headers['X-Client-Git-SHA'] = git_sha;

    const lovableUrl = `https://api.lovable.dev/projects/${projectId}/chat`;
    console.log(`[sendMessage] Enviando para Lovable API. mode=${mode || 'error'}, files=${uploadedFiles.length}`);

    const lovableResp = await fetch(lovableUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    const responseText = await lovableResp.text();
    let responseJson = {};
    try { responseJson = JSON.parse(responseText); } catch (_) {}

    if (!lovableResp.ok && lovableResp.status !== 202) {
      const errorMsg = responseJson.message || responseJson.error || lovableResp.statusText || 'Erro desconhecido';
      return res.status(lovableResp.status).json({ success: false, error: `Erro ${lovableResp.status}: ${errorMsg}`, status: lovableResp.status });
    }

    // 4. Extrair novo ai_message_id
    let newAiMsgId = null;
    try {
      const aimsgMatches = responseText.match(/aimsg_[a-z0-9]{10,}/g);
      if (aimsgMatches && aimsgMatches.length > 0) newAiMsgId = aimsgMatches[aimsgMatches.length - 1];
    } catch (_) {}

    return res.status(200).json({ success: true, status: lovableResp.status, ai_message_id: newAiMsgId, files_uploaded: uploadedFiles.length });
  } catch (err) {
    console.error('[sendMessage] Erro interno:', err.message);
    return res.status(500).json({ success: false, error: 'Erro interno: ' + err.message });
  }
};
