/**
 * send-prompt – Proxy seguro para o webhook N8N
 *
 * Recebe mensagem da extensão, valida JWT de sessão,
 * e encaminha payload PLAIN para o N8N:
 *   - Sem arquivos: JSON { message, projectId, token, timestamp }
 *   - Com arquivos: FormData multipart (file blobs + campos texto)
 */

import {
  CORS_HEADERS,
  corsResponse,
  jsonResponse,
  errorResponse,
} from "../_shared/cors.ts";
import { requireSession } from "../_shared/jwt.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);

  // 1. Verificar sessão JWT (licença válida)
  const auth = await requireSession(req);
  if (!auth.ok) {
    return jsonResponse(
      { success: false, error: auth.message },
      auth.status
    );
  }

  // 2. Parse do body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", 400);
  }

  // 3. Dados do payload
  const message = String(body.message ?? "").trim();
  const projectId = String(body.projectId ?? "").trim();
  const lovableToken = String(body.token ?? "").trim();
  const filesData = (body.files as Array<{ name?: string; type?: string; data?: string }>) || [];

  if (!message && filesData.length === 0)
    return errorResponse("message ou arquivos são obrigatórios", 400);
  if (!projectId) return errorResponse("projectId é obrigatório", 400);
  if (!lovableToken) return errorResponse("token é obrigatório", 400);
  if (filesData.length > 10) {
    return errorResponse("Máximo de 10 arquivos por mensagem.", 400);
  }

  const webhookUrl = Deno.env.get("N8N_WEBHOOK_URL") || "";
  if (!webhookUrl) {
    console.error("[send-prompt] N8N_WEBHOOK_URL não configurada");
    return errorResponse("Serviço temporariamente indisponível.", 503);
  }

  try {
    // 4. Enviar para o N8N — payload PLAIN conforme documentação
    let response: Response;
    const sendTimestamp = new Date().toISOString();

    if (filesData.length > 0) {
      // ===== COM ARQUIVOS: FormData multipart =====
      const formData = new FormData();
      formData.append("message", message);
      formData.append("projectId", projectId);
      formData.append("token", lovableToken);
      formData.append("timestamp", sendTimestamp);

      for (const f of filesData) {
        if (!f?.data) continue;
        try {
          const base64Match = f.data.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match) {
            const mimeType = base64Match[1];
            const base64Data = base64Match[2];
            const binaryStr = atob(base64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: mimeType });
            formData.append("file", blob, f.name || "file");
          }
        } catch (err) {
          console.warn(`[send-prompt] Falha ao converter arquivo ${f.name}:`, (err as Error).message);
        }
      }

      console.log(`[send-prompt] Enviando FormData ao N8N. license: ${auth.session.licenseKey}, files: ${filesData.length}`);
      response = await fetch(webhookUrl, {
        method: "POST",
        body: formData,
      });
    } else {
      // ===== SEM ARQUIVOS: JSON simples =====
      const jsonPayload = {
        message,
        projectId,
        token: lovableToken,
        timestamp: sendTimestamp,
      };

      console.log(`[send-prompt] Enviando JSON ao N8N. license: ${auth.session.licenseKey}`);
      response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jsonPayload),
      });
    }

    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      // resposta não-JSON do N8N
    }

    if (response.ok) {
      return jsonResponse({ success: true, data: json });
    } else {
      const errorMsg =
        (json.message as string) ||
        (json.error as string) ||
        `Erro ${response.status}`;
      return jsonResponse(
        { success: false, error: errorMsg },
        response.status >= 400 && response.status < 600
          ? response.status
          : 502
      );
    }
  } catch (err) {
    console.error("[send-prompt] Erro:", (err as Error).message);
    return errorResponse(
      "Falha ao processar prompt: " + (err as Error).message,
      500
    );
  }
});
