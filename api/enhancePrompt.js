/**
 * POST /api/enhancePrompt — Melhorador de prompt + Transcrição de áudio via OpenRouter
 * Requer sessão JWT válida.
 */
const { requireSession } = require('./_lib/sessionManager');
const { parseBody } = require('./_lib/firebaseAdmin');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'stepfun/step-3.5-flash:free';
const OPENROUTER_VOICE_MODEL = 'google/gemini-2.5-flash';

const TRANSCRIPTION_PROMPT = `You are a precise speech-to-text transcription assistant. Your ONLY task is to transcribe the audio provided into text. Rules:
1. Output ONLY the transcribed text, nothing else.
2. Do NOT add any commentary, explanation, or formatting.
3. Preserve the original language of the speech (detect automatically).
4. If the audio is in Portuguese, transcribe in Portuguese.
5. If the audio is unclear or empty, respond with an empty string.
6. Do NOT translate - transcribe exactly what is said.
7. Use proper punctuation and capitalization.`;

const SYSTEM_PROMPT = `You are an ELITE PROMPT ARCHITECT for Lovable development. Your role is to transform user requests into comprehensive, actionable prompts that generate beautiful, elegant, and highly functional applications.
DETECTION AND ADAPTATION
Automatically detect the scope of the user request:
SMALL EDITS: If the user wants to modify specific elements, change colors, adjust spacing, fix a bug, or make targeted improvements, provide a CONCISE, FOCUSED prompt that addresses only that specific change while preserving all existing functionality and design.
LARGE PROJECTS: If the user wants to create a complete SaaS, landing page, institutional site, dashboard, or any full application, generate a COMPREHENSIVE specification that serves as a detailed blueprint.
CORE PRINCIPLES
Never specify exact hex colors or color schemes. Instead, describe color intentions like modern, vibrant, professional, trustworthy, energetic, calming, allowing Lovable AI to choose harmonious palettes.
Never specify third-party integrations like Stripe, PayPal, checkout systems, payment processors, or external APIs unless the user explicitly mentions them.
Always define animations, transitions, micro-interactions, and motion design to create delightful user experiences.
Focus on layout structure, component hierarchy, user flows, and interaction patterns.
Emphasize responsive design, accessibility, and modern UI/UX best practices.
FOR SMALL EDITS
Identify the exact component or section the user wants to modify.
Provide precise instructions on what to change while explicitly stating to preserve all other existing content and functionality.
Keep the prompt short and surgical, avoiding unnecessary context.
FOR LARGE PROJECTS
Create a structured specification covering: PROJECT OVERVIEW, LAYOUT ARCHITECTURE, SECTIONS AND COMPONENTS, VISUAL DESIGN DIRECTION, ANIMATIONS AND INTERACTIONS, RESPONSIVE BEHAVIOR, ACCESSIBILITY, USER FLOWS, and TONE AND CONTENT GUIDANCE.
QUALITY STANDARDS
Every prompt you generate should enable Lovable to create products that are visually stunning, functionally robust, and delightfully interactive. Think like a product designer and frontend architect combined.
CRITICAL REMINDERS
Always output plain text, never markdown formatting.
Never summarize or truncate. Focus on design intent and user experience.`;

function extractTextFromContent(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    const parts = [];
    for (const item of raw) {
      if (typeof item === 'string') parts.push(item);
      else if (item && typeof item === 'object' && (item.type === 'text' || item.type === 'output_text') && typeof item.text === 'string') parts.push(item.text);
    }
    return parts.join('').trim();
  }
  if (typeof raw === 'object' && raw !== null && typeof raw.text === 'string') return raw.text.trim();
  return '';
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function jsonRes(res, status, data) {
  res.setHeader('Content-Type', 'application/json');
  cors(res);
  res.status(status).end(JSON.stringify(data));
}

async function handleTranscribeAudio(body, res) {
  const audioData = (body.audio || '').trim();
  const audioFormat = (body.format || 'webm').trim().toLowerCase();

  if (!audioData) return jsonRes(res, 400, { error: "Campo 'audio' (base64) é obrigatório" });
  if (audioData.length > 10 * 1024 * 1024) return jsonRes(res, 413, { error: 'Áudio muito grande. Máximo ~7.5MB.' });

  const apiKey = (process.env.OPENROUTER_VOICE_API_KEY || process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) return jsonRes(res, 500, { error: 'OPENROUTER_VOICE_API_KEY não configurada.' });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'HTTP-Referer': 'https://lovable-infinity-panel.vercel.app' },
      body: JSON.stringify({
        model: OPENROUTER_VOICE_MODEL,
        messages: [{ role: 'user', content: [{ type: 'text', text: TRANSCRIPTION_PROMPT }, { type: 'input_audio', input_audio: { data: audioData, format: audioFormat } }] }],
        stream: false, max_tokens: 4096, temperature: 0.1,
      }),
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || errData.message || response.statusText;
      return jsonRes(res, response.status, { error: `OpenRouter: ${errMsg}` });
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message || choice?.delta || {};
    const rawContent = message.content || message.text || choice?.text || '';
    const fullText = extractTextFromContent(rawContent);
    return jsonRes(res, 200, { text: fullText });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') return jsonRes(res, 504, { error: 'Transcrição demorou demais. Tente um áudio mais curto.' });
    return jsonRes(res, 500, { error: 'Falha ao transcrever: ' + (err.message || 'erro desconhecido') });
  }
}

async function handleImprovePrompt(body, res) {
  const text = (body.text != null ? String(body.text) : '').trim();
  const wantStream = body.stream !== false;

  if (!text) return jsonRes(res, 400, { error: "Campo 'text' é obrigatório" });

  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) return jsonRes(res, 500, { error: 'OPENROUTER_API_KEY não configurada.' });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50000);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'HTTP-Referer': 'https://lovable-infinity-panel.vercel.app' },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
        stream: wantStream, max_tokens: 8192, temperature: 0.3,
      }),
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || errData.message || response.statusText;
      return jsonRes(res, response.status, { error: `OpenRouter: ${errMsg}` });
    }

    if (!wantStream) {
      const data = await response.json();
      const choice = data.choices?.[0];
      const message = choice?.message || choice?.delta || {};
      const rawContent = message.content || message.text || choice?.text || '';
      const fullText = extractTextFromContent(rawContent);
      if (!fullText) return jsonRes(res, 502, { error: 'OpenRouter retornou resposta vazia.' });
      return jsonRes(res, 200, { text: fullText });
    }

    // Stream response — pipe diretamente
    cors(res);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } catch (_) {}
    res.end();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') return jsonRes(res, 504, { error: 'A IA demorou demais para responder.' });
    return jsonRes(res, 500, { error: 'Falha ao chamar OpenRouter: ' + (err.message || 'erro desconhecido') });
  }
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'Method not allowed' });

  // JWT obrigatório
  const auth = requireSession(req);
  if (!auth.ok) return jsonRes(res, auth.status, { valid: false, message: auth.message });

  const body = parseBody(req);

  // Roteamento por action
  if (body.action === 'transcribe') {
    return await handleTranscribeAudio(body, res);
  }
  return await handleImprovePrompt(body, res);
};
