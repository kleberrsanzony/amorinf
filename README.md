# Lovable Infinity

Extensao Chrome que permite prompts ilimitados no Lovable.dev.

## Estrutura do Projeto

```
.
├── extension-prod/     # Extensao de PRODUCAO (usuarios finais)
│   └── Envia mensagens via N8N webhook (estavel)
│
├── extension-dev/      # Extensao de DESENVOLVIMENTO (laboratorio)
│   └── Envia mensagens direto para a API do Lovable (experimental)
│
├── supabase/           # Backend (Supabase Edge Functions)
│   ├── functions/
│   │   ├── _shared/            # Modulos compartilhados (CORS, JWT, DB)
│   │   ├── send-prompt/        # Proxy N8N (usado pela extensao PROD)
│   │   ├── send-message/       # Proxy direto Lovable API (usado pela extensao DEV)
│   │   ├── enhance-prompt/     # Melhorador de prompt + transcricao de audio
│   │   ├── validate-license/   # Validacao de licenca + emissao de JWT
│   │   ├── verify-session/     # Verificacao de sessao JWT
│   │   └── refresh-session/    # Renovacao de sessao JWT
│   └── migrations/             # SQL migrations (tabela licenses)
│
├── docs/               # Documentacao
└── .cursor/            # Regras do Cursor IDE
```

## Duas Extensoes, Mesmo Backend

Ambas as extensoes compartilham:
- Mesmo sistema de licenciamento (Supabase Postgres)
- Mesmo melhorador de prompt (OpenRouter via Supabase)
- Mesma interface visual
- Mesmo limite de arquivos: ate 10 anexos, 20MB por arquivo
- Anexo por botao, colar (Ctrl+V) e drag & drop

A diferenca esta APENAS no envio de mensagens:
- **PROD** (`extension-prod/`): Extension → Supabase `send-prompt` → N8N → Lovable
- **DEV** (`extension-dev/`): Extension → Supabase `send-message` → Lovable API direta

## Seguranca (send-prompt / PROD)

- Versao minima: 3.5.0
- HMAC-SHA256 do body (anti-tampering)
- Nonce anti-replay (armazenado em DB)
- Janela de timestamp (5 min)
- Rate limit: 20 req/min por licenca
- Webhook URL so server-side

## Stack

- **Frontend:** Chrome Extension (Manifest V3)
- **Backend:** Supabase Edge Functions (Deno/TypeScript)
- **Banco de dados:** Supabase PostgreSQL (licencas)
- **APIs externas:** Lovable API, OpenRouter API, N8N

## Deploy

### Edge Functions (Supabase)
```powershell
$env:SUPABASE_ACCESS_TOKEN = "seu_token"
npx supabase functions deploy --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi
```

### Extensoes (Chrome)
Carregar em `chrome://extensions` com Developer Mode:
- **Producao:** Apontar para `extension-prod/`
- **Desenvolvimento:** Apontar para `extension-dev/`
