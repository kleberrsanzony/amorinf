# Supabase – Organização e checklist (Fase 4)

## Projeto

- **Ref:** svjglgrxqxqtonoobcdi  
- **URL:** https://svjglgrxqxqtonoobcdi.supabase.co  

## Banco de dados

### Migrations a aplicar (em ordem)

1. **20260210120000_security_rate_limit_nonces.sql**  
   - Tabelas: `rate_limit_log`, `used_nonces`.  
   - Uso: rate limit e anti-replay nas Edge Functions.

2. **20260212000000_create_licenses_table.sql**  
   - Tabela: `licenses` (key, active, lifetime, expiry_date, max_uses, uses, user_name, activated_device_fingerprint, activated_date, last_access_date, active_session_device, active_session_last_ping, activated, created_at, updated_at).  
   - RLS habilitado (service_role faz bypass).

3. **20260213000000_add_user_phone_owner_id.sql**  
   - Colunas em `licenses`: `user_phone`, `owner_id`.  
   - Índice: `idx_licenses_owner`.

**Checklist:** No Supabase Dashboard → SQL Editor (ou `supabase db push`), confirmar que as três migrations foram aplicadas e que a tabela `licenses` existe com as colunas acima.

### Tabelas fora do repositório

Se existirem tabelas “clientes” ou “sócios” criadas diretamente no projeto, documentar aqui e não sobrescrever com migrations. O painel pode ser estendido para exibi-las depois.

## Auth

- **Redirect URLs:** Incluir `https://lovable-infinity-panel.vercel.app` (e `/auth/callback` se o fluxo usar redirect após login).
- **Panel users:** São apenas usuários do Supabase Auth; não há tabela `panel_users`. CRUD via `auth.admin` (listUsers, createUser, updateUserById, deleteUser) na API Vercel.

## Edge Functions – Secrets

Configurar em: Supabase Dashboard → Project Settings → Edge Functions → Secrets (ou `supabase secrets set`).

| Secret | Obrigatório para | Descrição |
|--------|-------------------|-----------|
| **JWT_SECRET** | validate-license, verify-session, refresh-session, send-prompt | Chave para assinar/validar JWT de sessão da extensão. Deve ser um valor seguro e único. |
| **PROMPTX_LICENSE_KEY** | send-prompt | Única licença PromptX 3.1 usada no funil (ex.: TDH8-3XO7-P9MC-PY3Y). Não geramos licenças no Supabase do PromptX; apenas consumimos o serviço com essa licença. |
| **PROMPTX_DEVICE_ID** | send-prompt | DeviceId/hardware ID **da máquina em que a licença PromptX foi ativada** (ex.: HWID_INTEL...). Deve ser o valor real obtido desse ambiente; não gerar aleatório. Usado em validate e proxy_webhook. |
| **PROMPTX_GATEWAY_URL** | send-prompt | URL do secure-gateway do PromptX. |
| **PROMPTX_ANON_KEY** | send-prompt | Anon key do projeto Supabase do PromptX. |
| **N8N_WEBHOOK_URL** | send-prompt, send-message | URL do webhook N8N que recebe mensagens/arquivos. |
| **OPENROUTER_API_KEY** | enhance-prompt | Chave da API Open Router. Usada para **melhorar prompt** e **transcrição por voz** (Gemini 2.5 Flash Lite). **Nunca** colocar no código nem commitar; apenas em Secrets ou .env local (gitignored). |
| **OPENROUTER_MODEL** | enhance-prompt (opcional) | Modelo; default: `google/gemini-2.5-flash-lite`. |
| **ENHANCE_SYSTEM_PROMPT** | enhance-prompt (opcional) | System prompt do Enhanced (melhorar prompt). Se não definido, usa o padrão da função; a extensão pode sobrescrever por chamada enviando `system_prompt` no body. |

Outros (se usados pelo código): HMAC_SIGNING_SECRET ou WEBHOOK_URL (send-message), etc.

## Deploy das Edge Functions

```powershell
$env:SUPABASE_ACCESS_TOKEN = "seu_token"
npx supabase functions deploy --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi
```

Ou por função:

```powershell
npx supabase functions deploy validate-license --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi
npx supabase functions deploy send-prompt --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi
npx supabase functions deploy enhance-prompt --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi
# ... demais funções
```

`--no-verify-jwt` é usado porque a extensão envia `apikey` (anon) e a validação é feita por body/header próprio (licenseKey + deviceFingerprint ou JWT de sessão).

### Checklist Proxy Funil (send-prompt + validate-license)

- **Secrets (via CLI):** Configurar com `supabase secrets set` (não usar apenas o Dashboard). Ex.: `supabase secrets set JWT_SECRET=xxx PROMPTX_LICENSE_KEY=TDH8-3XO7-P9MC-PY3Y PROMPTX_DEVICE_ID=xxx PROMPTX_GATEWAY_URL=xxx PROMPTX_ANON_KEY=xxx --project-ref svjglgrxqxqtonoobcdi`.
- **Deploy (via CLI):** `npx supabase functions deploy validate-license send-prompt --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi`.
- **Banco:** Tabelas `licenses`, `session_cache` e `usage_logs` existem; RLS habilitado (service_role acessa). Ver `supabase/setup-proxy-funil.sql`.
- **Extensão:** Após login, o storage tem `licenseKey`; o popup permite entrada com licenseKey mesmo sem sessionToken; ao enviar mensagem, o body inclui `licenseKey`.

## Comunicação com o painel

- O painel usa **Supabase Auth** (login) e chama a **API na Vercel** com o JWT (Authorization / X-Auth-Token).
- A Vercel usa **SUPABASE_URL** e **SUPABASE_SERVICE_ROLE_KEY** para acessar Postgres e Auth Admin.
- Garantir que essas variáveis na Vercel apontem para este projeto (svjglgrxqxqtonoobcdi).
