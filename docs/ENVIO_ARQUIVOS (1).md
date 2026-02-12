# Envio de Arquivos — Leigos Academy Extension

## Visão Geral

O envio de arquivos segue uma arquitetura **100% server-side**: a extensão nunca faz chamadas diretas a webhooks ou serviços externos. Tudo passa pela Edge Function `send-message` do Supabase, que valida a licença, converte os arquivos e encaminha ao webhook N8N.

```
┌──────────────┐       JSON (DataURLs)       ┌──────────────────┐     FormData (Blobs)     ┌──────────┐
│   Extensão   │  ──────────────────────────► │  Edge Function   │  ─────────────────────►  │ Webhook  │
│  (popup.js)  │    via supabaseRequest()     │  send-message    │    multipart POST        │   N8N    │
└──────────────┘                              └──────────────────┘                          └──────────┘
```

## Fluxo Detalhado

### 1. Seleção de Arquivos (popup.js)

O usuário pode anexar arquivos de 3 formas:
- **Botão de anexo** (clique no ícone 📎)
- **Colar** (Ctrl+V com imagem na área de transferência)
- **Arrastar e soltar** (drag & drop na área de mensagem)

**Restrições:**
- Máximo **10 arquivos** por mensagem
- Máximo **20MB** por arquivo
- Tipos aceitos: imagens, vídeo, áudio, documentos (PDF, DOC, XLS, CSV, TXT, JSON, etc.)

### 2. Conversão para DataURL (popup.js → sendMessage)

Ao clicar em "Enviar", cada arquivo selecionado é convertido para DataURL via `FileReader.readAsDataURL()`:

```javascript
// popup.js — dentro de sendMessage()
const filePromises = selectedFiles.map(file => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      data: reader.result  // "data:image/png;base64,iVBOR..."
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
});
filesData = await Promise.all(filePromises);
```

O resultado é um array de objetos `{name, type, data}` onde `data` é a DataURL completa.

### 3. Envio ao Background (popup.js → background.js)

O popup envia tudo via `chrome.runtime.sendMessage`:

```javascript
chrome.runtime.sendMessage({
  action: 'sendMessage',
  data: {
    token: currentToken,
    projectId: currentProjectId,
    message: message,
    files: filesData  // Array de {name, type, data: DataURL}
  }
});
```

### 4. Processamento no Background (license.js → supabase-config.js)

O background recebe e chama `processMessageSend()` que:
1. Valida a licença salva
2. Obtém o HWID (Installation ID)
3. Chama `sendMessageSupabase()` passando todos os dados

```javascript
// license.js
const result = await sendMessageSupabase(
  saved.key, hwid, token, projectId, message, files, prevSessionId, isChatMode
);
```

### 5. Requisição Assinada (supabase-config.js)

`sendMessageSupabase()` usa `supabaseRequest()` que:
- Gera timestamp + nonce
- Assina o body com **HMAC-SHA256** usando o session token como chave
- Envia headers de segurança: `x-request-signature`, `x-session-token`, `x-request-timestamp`, `x-request-nonce`, `x-extension-version`
- Faz POST JSON para `{supa_url}/functions/v1/send-message`

**Os arquivos vão como DataURLs dentro do JSON body.** Nenhuma URL externa é exposta no frontend.

### 6. Edge Function — Validação (send-message/index.ts)

A Edge Function realiza na ordem:
1. **Verifica versão** da extensão (`x-extension-version ≥ 8.0.1`)
2. **Valida session token** — deriva o token esperado via `HMAC(HMAC_SIGNING_SECRET, licenseKey:hwid)` e compara em tempo constante
3. **Verifica timestamp** — janela de 5 minutos
4. **Verifica nonce** — anti-replay (nonces são armazenados em memória)
5. **Verifica HMAC** — assinatura do body usando session token como chave
6. **Rate limit** — máx. 20 req/min por licença
7. **Busca licença** no Supabase — verifica se existe, está ativa, não expirou, e o HWID está autorizado
8. **Verifica créditos** na API Lovable — precisa ter ≥ 1 crédito

### 7. Edge Function — Encaminhamento ao Webhook

Após validação, a Edge Function decide o formato de envio:

#### Com arquivos (FormData multipart):

```typescript
// Converter DataURL → Blob
for (const file of files) {
  let blob: Blob;
  try {
    const res = await fetch(file.data);    // DataURL como fetch
    blob = await res.blob();
  } catch {
    // Fallback manual: atob() → Uint8Array → Blob
    const base64 = dataURI.split(',')[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: mimeType });
  }
  formData.append('file', blob, file.name);
}

// Adicionar campos texto
formData.append('message', message);
formData.append('projectId', projectId);
formData.append('token', token);
formData.append('timestamp', new Date().toISOString());

// POST multipart (Content-Type definido automaticamente com boundary)
await fetch(webhookUrl, { method: 'POST', body: formData });
```

#### Sem arquivos (JSON):

```typescript
await fetch(webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, projectId, token, timestamp, chatMode: false })
});
```

### 8. Webhook URL

A URL do webhook é lida de uma variável de ambiente **server-side**:

```typescript
const webhookUrl = Deno.env.get('WEBHOOK_URL')
```

**Nunca é exposta ao cliente.** Configurada via:
```bash
supabase secrets set WEBHOOK_URL=https://...
```

## Segurança

| Aspecto | Detalhe |
|---------|---------|
| **Webhook URL** | Somente server-side (env var `WEBHOOK_URL`) |
| **HMAC Signing Secret** | Somente server-side (env var `HMAC_SIGNING_SECRET`) |
| **Service Role Key** | Somente server-side (env var `SUPABASE_SERVICE_ROLE_KEY`) |
| **Session Token** | Derivado server-side, usado para assinar requests |
| **Anti-replay** | Nonces únicos + janela de 5 min |
| **Rate limit** | 20 req/min por licença |
| **Versão mínima** | Extensão ≥ 8.0.1 obrigatória |
| **Multi-device** | HWID verificado contra lista de dispositivos da licença |

## Arquivos Envolvidos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `extensao/popup.js` | Seleção de arquivos, conversão para DataURL, UI |
| `extensao/license.js` | `processMessageSend()` — orquestra envio com validação de licença |
| `extensao/supabase-config.js` | `sendMessageSupabase()` — requisição assinada (HMAC) à Edge Function |
| `extensao/background.js` | Service worker — roteia `sendMessage` para `processMessageSend()` |
| `supabase/functions/send-message/index.ts` | Validação completa + conversão DataURL→Blob→FormData + envio ao webhook |
