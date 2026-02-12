/**
 * Edge Function: enhance-prompt
 * Melhorador de prompt + Transcrição de áudio via OpenRouter
 * Requer sessão JWT válida.
 */
import "@supabase/functions-js/edge-runtime.d.ts";
import { CORS_HEADERS, corsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireSession } from "../_shared/jwt.ts";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "stepfun/step-3.5-flash:free";
const OPENROUTER_VOICE_MODEL = "google/gemini-2.5-flash";

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

function extractTextFromContent(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const item of raw) {
      if (typeof item === "string") parts.push(item);
      else if (
        item &&
        typeof item === "object" &&
        ("type" in item) &&
        (item.type === "text" || item.type === "output_text") &&
        typeof item.text === "string"
      )
        parts.push(item.text);
    }
    return parts.join("").trim();
  }
  if (typeof raw === "object" && raw !== null && "text" in raw && typeof (raw as Record<string, unknown>).text === "string")
    return ((raw as Record<string, unknown>).text as string).trim();
  return "";
}

// ============================================
// Handler: Transcrição de Áudio
// ============================================
async function handleTranscribeAudio(
  body: Record<string, unknown>
): Promise<Response> {
  const audioData = ((body.audio as string) || "").trim();
  const audioFormat = ((body.format as string) || "webm").trim().toLowerCase();

  if (!audioData) {
    return errorResponse("Campo 'audio' (base64) é obrigatório", 400);
  }

  if (audioData.length > 10 * 1024 * 1024) {
    return errorResponse("Áudio muito grande. Máximo ~7.5MB.", 413);
  }

  const apiKey = (
    Deno.env.get("OPENROUTER_VOICE_API_KEY") ||
    Deno.env.get("OPENROUTER_API_KEY") ||
    ""
  ).trim();

  if (!apiKey) {
    return errorResponse("OPENROUTER_VOICE_API_KEY não configurada.", 500);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://svjglgrxqxqtonoobcdi.supabase.co",
      },
      body: JSON.stringify({
        model: OPENROUTER_VOICE_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: TRANSCRIPTION_PROMPT },
              {
                type: "input_audio",
                input_audio: { data: audioData, format: audioFormat },
              },
            ],
          },
        ],
        stream: false,
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg =
        (errData.error as Record<string, unknown>)?.message ||
        errData.message ||
        response.statusText;
      return errorResponse(`OpenRouter: ${errMsg}`, response.status);
    }

    const json = await response.json() as Record<string, unknown>;
    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    const message = (choice?.message ?? choice?.delta ?? {}) as Record<string, unknown>;
    const rawContent = message.content ?? message.text ?? (choice as Record<string, unknown>)?.text ?? "";
    const fullText = extractTextFromContent(rawContent);

    return jsonResponse({ text: fullText });
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error).name === "AbortError") {
      return errorResponse("Transcrição demorou demais. Tente um áudio mais curto.", 504);
    }
    return errorResponse("Falha ao transcrever: " + ((err as Error).message || "erro desconhecido"), 500);
  }
}

// ============================================
// Handler: Melhorar Prompt
// ============================================
async function handleImprovePrompt(
  body: Record<string, unknown>
): Promise<Response> {
  const text = (body.text != null ? String(body.text) : "").trim();
  const wantStream = body.stream !== false;

  if (!text) {
    return errorResponse("Campo 'text' é obrigatório", 400);
  }

  const apiKey = (
    Deno.env.get("OPENROUTER_API_KEY") || ""
  ).trim();

  if (!apiKey) {
    return errorResponse("OPENROUTER_API_KEY não configurada.", 500);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50000);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://svjglgrxqxqtonoobcdi.supabase.co",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        stream: wantStream,
        max_tokens: 8192,
        temperature: 0.3,
      }),
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg =
        (errData.error as Record<string, unknown>)?.message ||
        errData.message ||
        response.statusText;
      return errorResponse(`OpenRouter: ${errMsg}`, response.status);
    }

    if (!wantStream) {
      const json = await response.json() as Record<string, unknown>;
      const choices = json.choices as Array<Record<string, unknown>> | undefined;
      const choice = choices?.[0];
      const message = (choice?.message ?? choice?.delta ?? {}) as Record<string, unknown>;
      const rawContent = message.content ?? message.text ?? (choice as Record<string, unknown>)?.text ?? "";
      const fullText = extractTextFromContent(rawContent);

      if (!fullText) {
        return errorResponse("OpenRouter retornou resposta vazia.", 502);
      }
      return jsonResponse({ text: fullText });
    }

    // Stream response
    return new Response(response.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error).name === "AbortError") {
      return errorResponse("A IA demorou demais para responder.", 504);
    }
    return errorResponse("Falha ao chamar OpenRouter: " + ((err as Error).message || "erro desconhecido"), 500);
  }
}

// ============================================
// Handler principal
// ============================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  // JWT obrigatório
  const auth = await requireSession(req);
  if (!auth.ok) {
    return jsonResponse(
      { valid: false, message: auth.message },
      auth.status
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", 400);
  }

  // Roteamento por action
  if (body.action === "transcribe") {
    return await handleTranscribeAudio(body);
  }

  return await handleImprovePrompt(body);
});
