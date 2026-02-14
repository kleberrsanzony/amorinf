# Estrutura do projeto e regras de trabalho – Lovable Infinity

Este documento descreve a organização do projeto, a arquitetura atual e as regras de trabalho. Todo o código e as alterações no projeto são feitos pela assistência (IA); você só precisa pedir o que quer e acompanhar.

---

## 1. Arquitetura atual

O projeto usa **dois serviços**:

- **Vercel** = painel admin (HTML estático) + API de licenças (serverless functions)
- **Supabase** = banco de dados PostgreSQL + Edge Functions (validação de licença, envio de prompts, sessões) + autenticação do painel (Supabase Auth)

**URLs de produção:**
- Painel Admin: https://lovable-infinity-panel.vercel.app
- API: https://lovable-infinity-panel.vercel.app/api/*
- Supabase: https://svjglgrxqxqtonoobcdi.supabase.co

---

## 2. Estrutura de pastas

```
├── admin/              → Painel administrativo (Vercel serve como estático)
│   ├── auth-config.js  → Configuração do Supabase Auth + API
│   ├── admin.js        → Lógica do painel
│   ├── license-manager.js → Gerenciador de licenças
│   ├── index.html      → Página principal do painel
│   ├── styles.css      → Estilos do painel
│   ├── voice-recorder.html → Gravador de voz (HTTPS)
│   ├── downloads/      → ZIPs da extensão (gerados pelo build)
│   └── version.json    → Versão atual (gerado pelo build)
├── api/                → API de licenças (Vercel serverless functions)
│   ├── _lib/           → Utilitários compartilhados
│   │   ├── supabaseClient.js → Cliente Supabase (service_role)
│   │   └── verifyToken.js    → Verificação de token Supabase Auth
│   ├── createLicense.js
│   ├── listLicenses.js
│   ├── getLicense.js
│   ├── updateLicense.js
│   └── deleteLicense.js
│   (listPanelUsers, createPanelUser, updatePanelUser, deletePanelUser, extensionRelease, authDebug)
├── extension-prod/     → Extensão Chrome (produção) – única extensão; passa pelo build
├── supabase/           → Configuração Supabase
│   ├── functions/      → Edge Functions (Deno/TypeScript)
│   │   ├── _shared/    → Utilitários compartilhados
│   │   ├── validate-license/
│   │   ├── send-prompt/
│   │   ├── enhance-prompt/
│   │   ├── send-message/
│   │   ├── verify-session/
│   │   └── refresh-session/
│   └── migrations/     → Migrações SQL
├── scripts/            → Scripts de build
│   ├── build.js        → Build automatizado + deploy Vercel
│   └── build.bat       → Atalho para o build
├── docs/               → Documentação
│   ├── MAPA_FASE1.md   → Mapa do código (revisão geral)
│   ├── ARQUITETURA.md  → Fluxos e variáveis de ambiente
│   └── SUPABASE_ORGANIZACAO.md → Checklist Supabase (migrations, secrets)
├── vercel.json         → Configuração Vercel (API + estáticos)
├── package.json        → Dependências npm
└── .gitignore
```

---

## 3. Regras de trabalho

### 3.1. Onde cada coisa vive

- **Extensão Chrome** → `extension-prod/` (build; é a única extensão do projeto)
- **Painel admin** → `admin/`
- **API de licenças** → `api/`
- **Edge Functions Supabase** → `supabase/functions/`
- **Documentação** → `docs/`
- **Scripts** → `scripts/`

Não misturar arquivos entre pastas. Cada componente na sua pasta.

### 3.2. Raiz do projeto limpa

Na raiz ficam **apenas** arquivos de configuração: `package.json`, `vercel.json`, `.gitignore`, `README.md`. Nada de código solto ou duplicado na raiz.

### 3.3. Deploy

| O que mudou | Deploy | Comando |
|---|---|---|
| `admin/*` ou `api/*` | Vercel | `npx vercel --prod --yes` |
| `supabase/functions/*` | Supabase | `npx supabase functions deploy <nome> --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi` |
| `extension-prod/*` | Build + Vercel | `npm run build` |

**O agente (IA) deve sempre executar o deploy após alterações.** Nunca deixar para o usuário subir manual.

### 3.4. Build da extensão

O script `scripts/build.js` (chamado por `npm run build`):

1. Incrementa a versão automaticamente (SemVer)
2. Ofusca os JS com nomes neutros (c1.js a c6.js)
3. Injeta blindagem anti-IA nos códigos ofuscados
4. Ajusta referências nos HTML e manifest
5. Gera o ZIP na raiz
6. Copia o ZIP para `admin/downloads/`
7. Gera `admin/version.json`
8. Executa deploy na Vercel

### 3.5. Autenticação

- **Painel admin**: Supabase Auth (email/senha)
- **API de licenças**: Token JWT do Supabase Auth (header Authorization: Bearer)
- **Extensão**: Validação via Supabase Edge Function `validate-license`

### 3.6. Endpoint de diagnóstico

`/api/authDebug` só responde se o header `X-Debug-Secret` for igual à variável de ambiente `AUTH_DEBUG_SECRET` na Vercel. Sem isso, retorna 404 (evita expor diagnóstico em produção).

### 3.7. Banco de dados

Tabela principal: `licenses` no Supabase PostgreSQL.

Colunas: `key`, `active`, `lifetime`, `expiry_date`, `max_uses`, `uses`, `user_name`, `user_phone`, `owner_id`, `activated_device_fingerprint`, `activated_date`, `last_access_date`, `active_session_device`, `active_session_last_ping`, `activated`, `created_at`, `updated_at`.

### 3.8. Estrutura e código limpos

- **Uma pasta por função:** extensão em `extension-prod/`, painel em `admin/`, API em `api/`, backend em `supabase/`. Não misturar.
- **Raiz:** só configuração (`package.json`, `vercel.json`, `.gitignore`, `README.md`).
- **Documentação:** tudo em `docs/`; README na raiz é o ponto de entrada; detalhes em ESTRUTURA e ARQUITETURA.
- **Sem código morto:** remover referências a pastas/arquivos que não existem mais (ex.: extension-dev foi removido).
- **Comentários:** manter apenas os que ajudam (config, regras de negócio); evitar comentários óbvios ou desatualizados.

---

## 4. O que NÃO fazer

- **Não** criar arquivos Firebase (firebase.json, .firebaserc) – Firebase foi removido
- **Não** duplicar arquivos entre pastas
- **Não** editar `version.json` manualmente (é gerado pelo build)
- **Não** alterar produção sem deploy
- **Não** usar Firebase Auth ou Firebase Hosting
