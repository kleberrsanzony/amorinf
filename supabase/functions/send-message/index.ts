// Edge Function: send-message
// Proxy server-side para envio de mensagens ao Lovable API
// Recebe payload simples da extensão, faz upload de arquivos e monta o payload completo

import "@supabase/functions-js/edge-runtime.d.ts";

// ============================================
// CORS headers (extensão Chrome pode precisar)
// ============================================
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info",
};

// ============================================
// Geração de IDs no formato Lovable (Crockford Base32)
// ============================================
const CROCKFORD_CHARS = "0123456789abcdefghjkmnpqrstvwxyz";

function generateCrockfordId(length: number): string {
  let result = "";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) {
    result += CROCKFORD_CHARS[arr[i] % CROCKFORD_CHARS.length];
  }
  return result;
}

function generateMsgId(): string {
  return "umsg_" + generateCrockfordId(28);
}

function generateErrorId(): string {
  return "error_" + generateCrockfordId(28);
}

function generateAiMsgId(): string {
  return "aimsg_" + generateCrockfordId(28);
}

// ============================================
// Montagem de Payloads
// ============================================

interface UploadedFile {
  file_id: string;
  file_name: string;
  type: string;
}

function buildErrorFixPayload(
  userMessage: string,
  aiMessageId?: string
): Record<string, unknown> {
  const now = Date.now();
  const errorMsg = `Application behavior does not match expected output. User reports: ${userMessage}`;
  const stackTrace = `Error: ${errorMsg}\n    at UserFeedbackHandler (src/components/App.tsx:142:8)\n    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)\n    at mountIndeterminateComponent (node_modules/react-dom/cjs/react-dom.development.js:17811:13)`;

  const errorDetail = {
    timestamp: now,
    error_type: "RUNTIME_ERROR",
    filename: "src/components/App.tsx",
    lineno: 142,
    colno: 8,
    stack: stackTrace,
    has_blank_screen: false,
  };

  const formattedMessage = `Fix these issues\n\n${errorMsg}\n\n\`\`\`\n${JSON.stringify(errorDetail, null, 2)}\n\`\`\`\n`;

  return {
    id: generateMsgId(),
    message: formattedMessage,
    mode: "instant",
    contains_error: true,
    error_ids: [generateErrorId()],
    ai_message_id: aiMessageId || generateAiMsgId(),
    current_page: "/",
    view: "preview",
    view_description: "The user is currently viewing the preview. ",
    model: null,
    session_replay: "[]",
    client_logs: [],
    network_requests: [],
    runtime_errors: [
      {
        timestamp: now - 1000,
        error_type: "RUNTIME_ERROR",
        message: errorMsg,
        filename: "src/components/App.tsx",
        lineno: 142,
        colno: 8,
        stack: stackTrace,
        has_blank_screen: false,
      },
    ],
    integration_metadata: {
      browser: {
        preview_viewport_width: 960,
        preview_viewport_height: 861,
      },
    },
  };
}

function buildMinimalPayload(
  userMessage: string,
  aiMessageId?: string
): Record<string, unknown> {
  return {
    id: generateMsgId(),
    message: userMessage,
    mode: "instant",
    contains_error: true,
    ai_message_id: aiMessageId || generateAiMsgId(),
    current_page: "/",
    view: "code",
    view_description: "The user is currently viewing the code.",
    model: null,
  };
}

// ============================================
// Upload de arquivos para o Lovable (GCS via signed URL)
// ============================================

interface FileData {
  name: string;
  type: string;
  data: string; // base64 data URL
}

async function uploadFileToLovable(
  fileData: FileData,
  token: string,
  gitSha?: string
): Promise<UploadedFile | null> {
  const uploadHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (gitSha) uploadHeaders["X-Client-Git-SHA"] = gitSha;

  try {
    // 1. Obter URL assinada para upload
    const uploadUrlResp = await fetch(
      "https://api.lovable.dev/files/generate-upload-url",
      {
        method: "POST",
        headers: uploadHeaders,
        body: JSON.stringify({
          file_name: fileData.name,
          content_type: fileData.type,
          status: "uploading",
        }),
      }
    );

    if (!uploadUrlResp.ok) {
      console.warn(
        `[send-message] Falha ao obter upload URL para ${fileData.name}: ${uploadUrlResp.status}`
      );
      return null;
    }

    const uploadUrlData = await uploadUrlResp.json();
    const signedUrl: string = uploadUrlData.url;
    const fileId: string | null =
      uploadUrlData.id || uploadUrlData.file_id || null;

    if (!signedUrl) {
      console.warn(`[send-message] URL assinada vazia para ${fileData.name}`);
      return null;
    }

    // 2. Converter base64 data URL para Blob
    const base64Match = fileData.data.match(
      /^data:[^;]+;base64,(.+)$/
    );
    if (!base64Match) {
      console.warn(
        `[send-message] Data URL inválida para ${fileData.name}`
      );
      return null;
    }
    const binaryStr = atob(base64Match[1]);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: fileData.type });

    // 3. PUT no Google Cloud Storage
    const putResp = await fetch(signedUrl, {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": fileData.type },
    });

    if (!putResp.ok) {
      console.warn(
        `[send-message] PUT falhou para ${fileData.name}: ${putResp.status}`
      );
      return null;
    }

    // 4. Extrair file_id da URL se não veio na resposta
    let resolvedFileId = fileId;
    if (!resolvedFileId) {
      const urlMatch = signedUrl.match(
        /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
      );
      if (urlMatch) resolvedFileId = urlMatch[1];
    }

    if (!resolvedFileId) {
      console.warn(
        `[send-message] Não foi possível resolver file_id para ${fileData.name}`
      );
      return null;
    }

    console.log(`[send-message] Upload concluído: ${fileData.name} (${resolvedFileId})`);

    return {
      file_id: resolvedFileId,
      file_name: fileData.name,
      type: "user_upload",
    };
  } catch (err) {
    console.warn(
      `[send-message] Erro no upload de ${fileData.name}:`,
      (err as Error).message
    );
    return null;
  }
}

// ============================================
// Handler principal
// ============================================

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const {
      token,
      projectId,
      message,
      files,
      mode,
      ai_message_id,
      git_sha,
    } = body as {
      token?: string;
      projectId?: string;
      message?: string;
      files?: FileData[];
      mode?: string;
      ai_message_id?: string;
      git_sha?: string;
    };

    // Validação de campos obrigatórios
    if (!token || !projectId || !message) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Campos obrigatórios: token, projectId, message",
        }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    // ============================================
    // 1. Upload de arquivos (se houver)
    // ============================================
    const uploadedFiles: UploadedFile[] = [];
    const optimisticImageUrls: string[] = [];

    if (files && Array.isArray(files) && files.length > 0) {
      console.log(`[send-message] Enviando ${files.length} arquivo(s) para upload...`);

      for (const fileData of files) {
        const uploaded = await uploadFileToLovable(fileData, token, git_sha);
        if (uploaded) {
          uploadedFiles.push(uploaded);
          // Para imagens, guardar URL para preview otimista
          if (fileData.type && fileData.type.startsWith("image/")) {
            optimisticImageUrls.push(
              `https://storage.googleapis.com/lovable-uploads/${uploaded.file_id}`
            );
          }
        }
      }

      console.log(`[send-message] ${uploadedFiles.length}/${files.length} arquivo(s) enviados com sucesso`);
    }

    // ============================================
    // 2. Montar payload no formato correto
    // ============================================
    let payload: Record<string, unknown>;

    if (mode === "min") {
      payload = buildMinimalPayload(message, ai_message_id);
    } else {
      payload = buildErrorFixPayload(message, ai_message_id);
    }

    // Adicionar referências dos arquivos ao payload
    if (uploadedFiles.length > 0) {
      payload.files = uploadedFiles;
      if (optimisticImageUrls.length > 0) {
        payload.optimisticImageUrls = optimisticImageUrls;
      }
    }

    // ============================================
    // 3. Enviar para a API do Lovable
    // ============================================
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (git_sha) {
      headers["X-Client-Git-SHA"] = git_sha;
    }

    const lovableUrl = `https://api.lovable.dev/projects/${projectId}/chat`;

    console.log(`[send-message] Enviando para Lovable API. mode=${mode || "error"}, files=${uploadedFiles.length}, ai_message_id=${payload.ai_message_id}`);

    const lovableResp = await fetch(lovableUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const responseText = await lovableResp.text();
    let responseJson: Record<string, unknown> = {};
    try {
      responseJson = JSON.parse(responseText);
    } catch (_) {
      // Resposta não é JSON
    }

    if (!lovableResp.ok && lovableResp.status !== 202) {
      const errorMsg =
        (responseJson.message as string) ||
        (responseJson.error as string) ||
        lovableResp.statusText ||
        "Erro desconhecido";

      return new Response(
        JSON.stringify({
          success: false,
          error: `Erro ${lovableResp.status}: ${errorMsg}`,
          status: lovableResp.status,
        }),
        {
          status: lovableResp.status,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    // ============================================
    // 4. Extrair novo ai_message_id da resposta
    // ============================================
    let newAiMsgId: string | null = null;
    try {
      const aimsgMatches = responseText.match(/aimsg_[a-z0-9]{10,}/g);
      if (aimsgMatches && aimsgMatches.length > 0) {
        newAiMsgId = aimsgMatches[aimsgMatches.length - 1];
        console.log(`[send-message] Novo ai_message_id: ${newAiMsgId}`);
      }
    } catch (_) {
      // Sem ai_message_id na resposta
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: lovableResp.status,
        ai_message_id: newAiMsgId,
        files_uploaded: uploadedFiles.length,
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[send-message] Erro interno:", (err as Error).message);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Erro interno: " + (err as Error).message,
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }
});
