# Lovable Infinity

Extensão Chrome que permite prompts ilimitados no [Lovable.dev](https://lovable.dev), com licenciamento e painel administrativo hospedados em Vercel e Supabase.

---

## Visão geral

| Componente | Descrição |
|------------|-----------|
| **Extensão (Chrome)** | Usuário final: valida licença no Supabase, envia mensagens via Edge Function `send-prompt` → N8N → Lovable. |
| **Painel admin** | HTML/JS em Vercel: login com Supabase Auth, CRUD de licenças e usuários do painel, download da extensão. |
| **API (Vercel)** | Serverless: list/create/get/update/delete licenças, gestão de usuários do painel e endpoint único de release `GET /api/extensionRelease` (retorna `{ version, publishedAt, filename }`). Autenticação via JWT (Supabase Auth). |
| **Supabase** | PostgreSQL (tabela `licenses`), Auth (login do painel), Edge Functions (validate-license, send-prompt, enhance-prompt, verify-session, refresh-session, send-message). |

**URLs de produção**

- Painel: https://lovable-infinity-panel.vercel.app  
- API: https://lovable-infinity-panel.vercel.app/api/*  
- Supabase: https://svjglgrxqxqtonoobcdi.supabase.co  

---

## Estrutura do projeto

```
├── admin/                 # Painel administrativo (Vercel serve como estático)
│   ├── index.html
│   ├── auth-config.js     # Supabase Auth + chamadas à API
│   ├── admin.js
│   ├── license-manager.js
│   ├── voice-recorder.html
│   ├── downloads/         # ZIP da extensão (gerado pelo build)
│   └── version.json      # Gerado pelo build
├── api/                   # Serverless functions (Vercel)
│   ├── _lib/              # verifyToken, verifyJwks, verifyJwtSecret, supabaseClient
│   ├── listLicenses.js, createLicense.js, getLicense.js, updateLicense.js, deleteLicense.js
│   ├── listPanelUsers.js, createPanelUser.js, updatePanelUser.js, deletePanelUser.js
│   ├── extensionRelease.js, authDebug.js
├── extension-prod/        # Extensão Chrome (produção) — entra no build
├── supabase/
│   ├── functions/         # Edge Functions (Deno/TypeScript)
│   │   ├── _shared/       # CORS, JWT, Supabase client
│   │   ├── validate-license, send-prompt, send-message, enhance-prompt
│   │   ├── verify-session, refresh-session
│   └── migrations/        # SQL (licenses, rate_limit, nonces)
├── scripts/
│   ├── build.js           # Build da extensão + deploy Vercel
│   └── reset-and-create-master.js
├── docs/                  # Documentação
├── vercel.json
└── package.json
```

---

## Fluxo da extensão

1. Usuário insere chave de licença → extensão chama `validate-license` (Supabase) com chave + device fingerprint.  
2. Supabase valida na tabela `licenses`, emite JWT de sessão (sessionToken, refreshToken).  
3. Ao enviar mensagem no Lovable, a extensão chama `send-prompt` (Supabase) com o JWT; a Edge Function encaminha para o webhook N8N, que integra com o Lovable.

A extensão **não** chama a API da Vercel; usa apenas Supabase (e N8N indiretamente).

---

## Fluxo do painel

1. Acesso ao domínio do painel → login com e-mail/senha (Supabase Auth).  
2. Token JWT é enviado nas requisições à API (Authorization, X-Auth-Token, ou `access_token` em GET).  
3. A API valida o JWT (JWKS ou JWT Secret) e acessa o Supabase (tabela `licenses` e `auth.admin` para usuários do painel).

---

## Desenvolvimento e deploy

### Pré-requisitos

- Node.js >= 14  
- Conta Supabase (projeto `svjglgrxqxqtonoobcdi`)  
- Conta Vercel (projeto do painel)  
- Variáveis de ambiente configuradas (ver `docs/ARQUITETURA.md` e `docs/SUPABASE_ORGANIZACAO.md`)

### Comandos

| Ação | Comando |
|------|--------|
| Build da extensão + deploy Vercel | `npm run build` |
| Deploy só do painel/API | `npx vercel --prod --yes` |
| Deploy Edge Functions (Supabase) | `npx supabase functions deploy --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi` |
| Reset Auth + licenças + criar usuário master | `npm run reset-master` |

O build da extensão incrementa a versão (SemVer), ofusca os JS em `extension-prod/`, gera o ZIP, copia para `admin/downloads/`, gera `admin/version.json` e executa deploy na Vercel.

### Extensão no Chrome

Em `chrome://extensions`, ativar "Modo do desenvolvedor" e carregar a pasta `extension-prod/` (ou o conteúdo descompactado do ZIP em `admin/downloads/`).

---


### Endpoint oficial de release da extensão

- Endpoint único: `GET /api/extensionRelease`
- Contrato de resposta: `{ version, publishedAt, filename }`
- Status legado: **não utilizar** `/api/publishExtensionRelease` (rota inexistente).

## Documentação

| Documento | Conteúdo |
|-----------|----------|
| `docs/ESTRUTURA_E_REGRAS_DO_PROJETO.md` | Estrutura de pastas, regras de trabalho, deploy, build. |
| `docs/ARQUITETURA.md` | Fluxos (Mermaid), variáveis de ambiente (Vercel e Supabase). |
| `docs/SUPABASE_ORGANIZACAO.md` | Migrations, secrets das Edge Functions, checklist. |
| `docs/RELATORIO_CORRECOES_PAINEL_2026.md` | Correções do painel (500, refresh token, Invalid API key). |
| `docs/MAPA_FASE1.md` | Mapa do código (revisão geral). |

---

## Stack

- **Frontend:** Chrome Extension (Manifest V3), painel HTML/JS/CSS  
- **Backend:** Vercel (serverless API), Supabase (PostgreSQL, Auth, Edge Functions)  
- **Integrações:** N8N (webhook), Lovable, OpenRouter (enhance-prompt)

---

## Licença e uso

Projeto privado. Uso da extensão mediante licença válida cadastrada no painel.
