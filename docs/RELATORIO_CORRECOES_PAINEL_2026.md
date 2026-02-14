# Relatório: Correções do Painel Admin (fev/2026)

Documento que descreve os problemas encontrados no painel Lovable Infinity (Vercel + Supabase) e as soluções aplicadas.

---

## 1. Resumo

O painel em https://lovable-infinity-panel.vercel.app passou a retornar **500 (Internal Server Error)** ao listar licenças após o login e, ao acessar o domínio sem login, exibia erro de **Refresh Token** no console. As causas foram identificadas e corrigidas; o painel voltou a abrir e a exibir as licenças normalmente.

---

## 2. Problemas identificados

### 2.1. Erro 500 em `GET /api/listLicenses`

**Sintoma:** Após login no painel, a chamada a `/api/listLicenses?ownerId=...&access_token=...` retornava **500 (Internal Server Error)** e a lista de licenças não carregava.

**Causa (logs da Vercel):**  
`[listLicenses] Supabase error: undefined Invalid API key`

A variável de ambiente **SUPABASE_SERVICE_ROLE_KEY** na Vercel estava com valor incorreto (por exemplo chave **anon** em vez da chave **service_role**, ou chave antiga/truncada). O cliente Supabase na API rejeitava a requisição ao banco com "Invalid API key".

### 2.2. Erro de Refresh Token ao abrir o painel (sem login)

**Sintoma:** Ao acessar o domínio do painel sem fazer login, o console do navegador exibia:

- `Failed to load resource: 400` em `.../auth/v1/token?grant_type=refresh_token`
- `AuthApiError: Invalid Refresh Token: Refresh Token Not Found`

**Causa:** O Supabase Client (no navegador) guarda sessão em `localStorage`. Ao carregar a página, ele tenta renovar a sessão usando o **refresh token** armazenado. Se esse token for antigo, tiver sido revogado ou for de outro dispositivo, o servidor responde 400 e a biblioteca dispara o erro. Não havia tratamento para esse caso; o fluxo não limpava a sessão inválida nem exibia a tela de login de forma limpa.

---

## 3. Soluções aplicadas

### 3.1. Correção do 500 em listLicenses (Invalid API key)

**Ação em produção (Vercel):**

1. No **Supabase Dashboard** → projeto **svjglgrxqxqtonoobcdi** → **Project Settings** → **API**, foi copiada a chave **service_role** (Secret), e não a **anon** (Public).
2. Na **Vercel** → projeto do painel → **Settings** → **Environment Variables**, a variável **SUPABASE_SERVICE_ROLE_KEY** foi atualizada com esse valor, para o ambiente **Production** (e Preview, se aplicável).
3. Foi feito **Redeploy** do projeto para que as funções serverless passassem a usar a nova variável.

**Ajustes no código (para robustez):**

- Em **api/listLicenses.js**: checagem de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` antes de chamar o Supabase; em caso de ausência, retorno **503** com mensagem genérica. Tratamento de erro do Supabase (log de `error.code` e `error.message`) e `catch` que, em caso de mensagem “obrigatórios”, retorna 503 em vez de 500.
- Função **toLicense** tornada defensiva (linhas com `row` nulo ou campos ausentes) e filtro `.filter(Boolean)` na lista retornada.
- Em **api/_lib/verifyToken.js**: todo o corpo de **verifyToken** envolvido em `try/catch`; em qualquer exceção retorna `null` (evita 500 por falha de JWKS ou getSupabase no fallback e resulta em 401 quando o token não é válido).

### 3.2. Tratamento de Refresh Token inválido no painel

**Arquivo:** `admin/auth-config.js`

- **Função `isRefreshTokenError(err)`:** identifica erros relacionados a refresh token (mensagens contendo "Refresh Token", "refresh_token" ou "Invalid Refresh Token").
- **getSession():** as chamadas a `supabaseClient.auth.getSession()` passaram a ter `.catch()`. Em caso de `isRefreshTokenError`, chama-se `signOut()` (limpa sessão no localStorage) e o callback do `onAuthStateChanged` é chamado com `null`, exibindo a tela de login.
- **onAuthStateChange:** o segundo `getSession()` (quando `session` vem `null`) também passou a ter `.catch()` com a mesma lógica de limpeza em erro de refresh token.
- **getAdminAuthToken():** `getSession()` e `refreshSession()` envolvidos em try/catch; em erro de refresh token, `currentSession` é limpo e `signOut()` é chamado para evitar novas tentativas com token inválido.

Com isso, ao abrir o painel com um refresh token inválido no storage, a sessão é limpa e a tela de login é exibida sem quebrar o fluxo. Uma mensagem de erro pode ainda aparecer no console (emitida pela biblioteca do Supabase) antes do nosso `catch`, mas o comportamento da aplicação fica correto.

---

## 4. Outras alterações relacionadas (revisão geral)

No contexto da revisão geral do projeto, também foram feitas:

- **Documentação:** criação de `docs/MAPA_FASE1.md`, `docs/ARQUITETURA.md` e `docs/SUPABASE_ORGANIZACAO.md`; atualização de `docs/ESTRUTURA_E_REGRAS_DO_PROJETO.md`.
- **API:** validação de token JWT via JWKS (ES256) em `api/_lib/verifyJwks.js`; fallback com JWT Secret em `api/_lib/verifyJwtSecret.js`; endpoint **authDebug** protegido em produção (header `X-Debug-Secret` = `AUTH_DEBUG_SECRET`).
- **Vercel:** `vercel.json` com CORS incluindo método **PATCH** e header **X-Debug-Secret**.
- **Supabase:** link do projeto remoto (`supabase link`), reparo do histórico de migrations e aplicação da migration `20260213000000_add_user_phone_owner_id.sql` com `supabase db push`.

---

## 5. Checklist pós-correção

- [x] Painel abre sem erro de refresh token no carregamento (sem login).
- [x] Login com Supabase Auth funciona.
- [x] Lista de licenças carrega após o login (sem 500).
- [x] Variável **SUPABASE_SERVICE_ROLE_KEY** na Vercel está com a chave **service_role** do projeto Supabase correto.
- [x] Deploy em produção na Vercel com as alterações aplicadas.

---

## 6. Referência rápida

| Item | Onde |
|------|------|
| Chave service_role | Supabase Dashboard → Project Settings → API → service_role (secret) |
| Env vars do painel | Vercel → projeto → Settings → Environment Variables |
| Logs da API em produção | Vercel → Deployments → [deploy] → Logs / Functions |
| Tratamento de refresh token | `admin/auth-config.js` (isRefreshTokenError, getSession/onAuthStateChange/getAdminAuthToken) |
| Tratamento de erro na listagem | `api/listLicenses.js` (env check, toLicense defensivo, verifyToken sem throw) |
