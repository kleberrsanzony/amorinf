# Lovable Infinity

Extensao Chrome que permite prompts ilimitados no Lovable.dev.

## IMPORTANTE: Extensao de Producao

> **A extensao principal e UNICA de trabalho e `extension-prod/`.**
> Toda build, correcao, melhoria e funcionalidade e feita nela.
> A pasta `Futura Extensao/` e apenas para experimentacao futura e NAO deve ser editada em producao.

## Estrutura do Projeto

```
.
├── extension-prod/        # EXTENSAO PRINCIPAL (producao, build, distribuicao)
│   ├── background.js      # Service worker (comunicacao N8N, download HTML)
│   ├── popup.js            # Interface do chat, licenca, arquivos
│   ├── config.js           # Configuracoes e endpoints
│   ├── auth.js             # Autenticacao de licenca
│   ├── content.js          # Content script (injecao na pagina)
│   ├── zip-utils.js        # Utilitario para criar ZIPs
│   └── build/              # Pasta gerada pelo build (ofuscada, nao commitar)
│
├── Futura Extensao/        # Modo desenvolvedor (experimentacao futura, NAO USAR)
│
├── admin/                  # Painel admin (hospedado na Vercel)
│   ├── index.html          # Interface do painel
│   ├── admin.js            # Logica do painel (licencas, usuarios)
│   ├── auth-config.js      # Autenticacao Supabase + API
│   ├── styles.css          # Estilos
│   └── version.json        # Versao atual (gerado pelo build)
│
├── api/                    # API Vercel (serverless functions)
│   ├── createLicense.js    # Criar licenca
│   ├── listLicenses.js     # Listar licencas
│   ├── updateLicense.js    # Editar licenca
│   ├── deleteLicense.js    # Remover licenca
│   ├── createPanelUser.js  # Criar socio/parceiro
│   ├── listPanelUsers.js   # Listar socios
│   ├── updatePanelUser.js  # Editar socio (nome, email, senha)
│   └── deletePanelUser.js  # Remover socio
│
├── supabase/               # Backend (Edge Functions + migrations)
│   ├── functions/
│   │   ├── _shared/            # Modulos compartilhados (CORS, JWT, DB)
│   │   ├── send-prompt/        # Proxy N8N (envio de mensagens)
│   │   ├── validate-license/   # Validacao de licenca + JWT
│   │   ├── verify-session/     # Verificacao de sessao JWT
│   │   ├── refresh-session/    # Renovacao de sessao JWT
│   │   └── enhance-prompt/     # Melhorador de prompt + transcricao de audio
│   └── migrations/             # SQL migrations
│
├── scripts/                # Scripts de build
│   └── build.js            # Build automatizado (ofuscacao, ZIP, deploy)
│
├── docs/                   # Documentacao
└── .cursor/rules/          # Regras do Cursor IDE
```

## Fluxo de Mensagens (Producao)

```
Extensao → Supabase Edge Function (send-prompt) → N8N Webhook → Lovable
```

## Fluxo de Build

```
npm run build           → Incrementa PATCH (3.5.1 → 3.5.2)
npm run build -- minor  → Incrementa MINOR (3.5.1 → 3.6.0)
npm run build -- major  → Incrementa MAJOR (3.5.1 → 4.0.0)
npm run build -- skip   → Mantem versao atual
```

O build:
1. Ofusca o JS de `extension-prod/` com blindagem anti-IA
2. Gera `extension-prod/build/` (pasta ofuscada)
3. Cria ZIP `LOVABLE_INFINITY_vX.X.X.zip`
4. Copia para `admin/downloads/`
5. Faz deploy automatico na Vercel (painel + API)

## Stack

- **Frontend:** Chrome Extension (Manifest V3)
- **Backend:** Supabase Edge Functions (Deno/TypeScript)
- **Banco de dados:** Supabase PostgreSQL
- **Painel admin:** Vercel (static + serverless)
- **APIs externas:** N8N, OpenRouter API

## Seguranca

- JWT obrigatorio para envio de mensagens
- Validacao de licenca via Supabase Postgres
- Codigo ofuscado com blindagem anti-IA
- Multi-tenancy: licencas separadas por owner_id
- Sem licencas de manutencao ou bypass no codigo

## Deploy

### Build completo (extensao + painel)
```powershell
npm run build
```

### Edge Functions (Supabase)
```powershell
$env:SUPABASE_ACCESS_TOKEN = "seu_token"
npx supabase functions deploy --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi
```

### Painel admin (Vercel — ja incluido no build)
```powershell
npx vercel --prod --yes
```
