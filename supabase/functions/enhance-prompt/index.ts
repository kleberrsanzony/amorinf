// Supabase Edge Function: enhance-prompt
// 1) Melhorar prompt: POST { text } → OpenRouter (Gemini 2.5 Flash Lite) → retorna { text }
// 2) Transcrever áudio: POST { action: 'transcribe', audio: base64, format: 'webm' } → OpenRouter (áudio) → retorna { text }
//
// Chaves NUNCA no código — apenas em Supabase Secrets ou .env local (não commitado).
// Secrets: OPENROUTER_API_KEY, OPENROUTER_MODEL (opcional; default: google/gemini-2.5-flash-lite)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const OPENROUTER_MODEL = (Deno.env.get("OPENROUTER_MODEL") || "google/gemini-2.5-flash-lite").trim();
/** System prompt do Enhanced (melhorar prompt). O placeholder {{INPUT}} é substituído pelo texto do usuário. */
const DEFAULT_SYSTEM_PROMPT = `<context>
Você é um especialista em Product Design, UX Writing, desenvolvimento web 
e comunicação clara. Seu único trabalho é receber o input do usuário e 
devolvê-lo em uma versão significativamente melhorada, mais detalhada, 
mais precisa e mais eficaz.

Interprete a intenção real do input e o aprimore dentro do contexto 
que ele pertence:

- Se for uma solicitação de organização, melhore a clareza e a estrutura.
- Se for uma solicitação de copy ou texto, torne-o mais persuasivo e impactante.
- Se for uma solicitação de construção de interface, página ou aplicação web, 
  detalhe componentes, seções, fluxos e experiência do usuário — instruindo 
  o uso de bibliotecas React prontas como 21st.dev, shadcn/ui, Aceternity UI 
  ou Magic UI, nunca construindo elementos do zero.

Input do usuário:
{{INPUT}}
</context>

<reasoning>
Antes de responder, raciocine internamente e de forma silenciosa:

1. Explore 3 interpretações possíveis do input: o que foi pedido 
   literalmente, o que o usuário provavelmente precisa de verdade, 
   e a versão mais completa e eficaz do que foi solicitado.

2. Identifique a intenção real, o contexto e os gaps do input original.

3. Gere mentalmente 3 versões aprimoradas e selecione apenas a mais 
   completa, natural e eficaz das três.

Todo esse processo é estritamente interno. Nenhuma etapa, versão 
ou raciocínio deve aparecer na resposta.
</reasoning>

<output_rules>
Entregue uma única resposta: o texto refinado, puro e direto.
Sem asteriscos, sem títulos, sem marcadores, sem comentários,
sem análise, sem introdução, sem conclusão, sem variações.
Apenas o texto melhorado.
</output_rules>`;

function getEnhanceSystemPrompt(override?: string | null): string {
    const fromEnv = (Deno.env.get("ENHANCE_SYSTEM_PROMPT") || "").trim();
    if (override != null && typeof override === "string" && override.trim()) return override.trim();
    if (fromEnv) return fromEnv;
    return DEFAULT_SYSTEM_PROMPT;
}

function jsonResponse(data: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function errorResponse(message: string, status = 400) {
    return jsonResponse({ error: message }, status);
}

/** Melhorar texto do prompt via OpenRouter (Gemini 2.5 Flash Lite). systemPromptOverride opcional (body ou Secret). */
async function improvePrompt(text: string, systemPromptOverride?: string | null): Promise<{ text: string } | { error: string }> {
    if (!OPENROUTER_API_KEY) {
        return { error: "Melhorador de prompt não configurado (OPENROUTER_API_KEY)." };
    }
    let systemPrompt = getEnhanceSystemPrompt(systemPromptOverride);
    systemPrompt = systemPrompt.replace(/\{\{INPUT\}\}/g, text);
    try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "HTTP-Referer": "https://lovable.dev",
            },
            body: JSON.stringify({
                model: OPENROUTER_MODEL,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: "Gere o prompt aprimorado conforme as regras acima." },
                ],
                max_tokens: 2048,
            }),
        });

        const data = await res.json().catch(() => ({}));
        if (data.error) {
            return { error: (data.error as { message?: string }).message || "Erro ao melhorar prompt." };
        }
        const content = data.choices?.[0]?.message?.content ?? "";
        return { text: (content && typeof content === "string" ? content : "").trim() };
    } catch (e) {
        const msg = (e as Error).message || String(e);
        return { error: "Erro de conexão: " + msg };
    }
}

/** Transcrever áudio base64 via OpenRouter (Gemini com input_audio) — mesma chave, sem Whisper */
async function transcribeAudio(base64: string, format: string): Promise<{ text: string } | { error: string }> {
    if (!OPENROUTER_API_KEY) {
        return { error: "Transcrição não configurada (OPENROUTER_API_KEY)." };
    }
    const fmt = (format === "mp3" ? "mp3" : format === "wav" ? "wav" : "webm");
    try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "HTTP-Referer": "https://lovable.dev",
            },
            body: JSON.stringify({
                model: OPENROUTER_MODEL,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Transcreva este áudio para texto em português. Retorne apenas o texto transcrito, sem explicações." },
                            { type: "input_audio", input_audio: { data: base64, format: fmt } },
                        ],
                    },
                ],
                max_tokens: 2048,
            }),
        });

        const data = await res.json().catch(() => ({}));
        if (data.error) {
            return { error: (data.error as { message?: string }).message || "Erro ao transcrever." };
        }
        const content = data.choices?.[0]?.message?.content ?? "";
        return { text: (content && typeof content === "string" ? content : "").trim() };
    } catch (e) {
        const msg = (e as Error).message || String(e);
        return { error: "Erro na transcrição: " + msg };
    }
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return errorResponse("Método não permitido", 405);
    }

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action;
        const audio = body.audio;
        const format = (body.format || "webm").toLowerCase();

        // Transcrição de áudio (digitação por voz)
        if (action === "transcribe" && audio && typeof audio === "string") {
            const result = await transcribeAudio(audio, format);
            if ("error" in result) {
                return errorResponse(result.error, 400);
            }
            return jsonResponse({ text: result.text });
        }

        // Melhorar prompt (texto). Opcional: system_prompt ou systemPrompt no body.
        const text = body.text;
        const systemPromptBody = body.system_prompt ?? body.systemPrompt;
        if (text != null && typeof text === "string" && text.trim()) {
            const result = await improvePrompt(text.trim(), systemPromptBody);
            if ("error" in result) {
                return errorResponse(result.error, 400);
            }
            return jsonResponse({ text: result.text });
        }

        return errorResponse("Envie 'text' para melhorar prompt ou 'action':'transcribe' com 'audio' para transcrição.", 400);
    } catch (e) {
        const msg = (e as Error).message || String(e);
        return errorResponse("Erro interno: " + msg, 500);
    }
});
