/**
 * POST /api/sendPrompt — Proxy seguro para o webhook N8N
 * Valida sessão JWT, encaminha payload para N8N (JSON ou FormData multipart)
 */
const { requireSession } = require('./_lib/sessionManager');
const { parseBody } = require('./_lib/firebaseAdmin');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json');
  cors(res);
  res.status(status).end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Método não permitido.' });

  // 1. Verificar sessão JWT
  const auth = requireSession(req);
  if (!auth.ok) return json(res, auth.status, { success: false, error: auth.message });

  // 2. Parse do body
  const body = parseBody(req);
  const message = String(body.message || '').trim();
  const projectId = String(body.projectId || '').trim();
  const lovableToken = String(body.token || '').trim();
  const filesData = body.files || [];

  if (!message && filesData.length === 0) return json(res, 400, { success: false, error: 'message ou arquivos são obrigatórios' });
  if (!projectId) return json(res, 400, { success: false, error: 'projectId é obrigatório' });
  if (!lovableToken) return json(res, 400, { success: false, error: 'token é obrigatório' });
  if (filesData.length > 10) return json(res, 400, { success: false, error: 'Máximo de 10 arquivos por mensagem.' });

  const webhookUrl = (process.env.N8N_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    console.error('[sendPrompt] N8N_WEBHOOK_URL não configurada');
    return json(res, 503, { success: false, error: 'Serviço temporariamente indisponível.' });
  }

  try {
    const sendTimestamp = new Date().toISOString();
    let response;

    if (filesData.length > 0) {
      // COM ARQUIVOS: FormData multipart
      const FormData = (await import('form-data')).default || require('form-data');
      const formData = new FormData();
      formData.append('message', message);
      formData.append('projectId', projectId);
      formData.append('token', lovableToken);
      formData.append('timestamp', sendTimestamp);

      for (const f of filesData) {
        if (!f || !f.data) continue;
        try {
          const base64Match = f.data.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match) {
            const buf = Buffer.from(base64Match[2], 'base64');
            formData.append('file', buf, { filename: f.name || 'file', contentType: base64Match[1] });
          }
        } catch (err) {
          console.warn(`[sendPrompt] Falha ao converter arquivo ${f.name}:`, err.message);
        }
      }

      console.log(`[sendPrompt] Enviando FormData ao N8N. license: ${auth.session.licenseKey}, files: ${filesData.length}`);
      response = await fetch(webhookUrl, { method: 'POST', body: formData, headers: formData.getHeaders ? formData.getHeaders() : {} });
    } else {
      // SEM ARQUIVOS: JSON simples
      console.log(`[sendPrompt] Enviando JSON ao N8N. license: ${auth.session.licenseKey}`);
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, projectId, token: lovableToken, timestamp: sendTimestamp }),
      });
    }

    const text = await response.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch (_) {}

    if (response.ok) {
      return json(res, 200, { success: true, data: parsed });
    } else {
      const errorMsg = parsed.message || parsed.error || `Erro ${response.status}`;
      return json(res, response.status >= 400 && response.status < 600 ? response.status : 502, { success: false, error: errorMsg });
    }
  } catch (err) {
    console.error('[sendPrompt] Erro:', err.message);
    return json(res, 500, { success: false, error: 'Falha ao processar prompt: ' + err.message });
  }
};
