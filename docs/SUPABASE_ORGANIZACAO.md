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
| **N8N_WEBHOOK_URL** | send-prompt, send-message | URL do webhook N8N que recebe mensagens/arquivos. |

Outros (se usados pelo código): OPENROUTER_API_KEY (enhance-prompt), HMAC_SIGNING_SECRET ou WEBHOOK_URL (send-message), etc.

## Deploy das Edge Functions

```powershell
$env:SUPABASE_ACCESS_TOKEN = "seu_token"
npx supabase functions deploy --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi
```

Ou por função:

```powershell
npx supabase functions deploy validate-license --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi
npx supabase functions deploy send-prompt --no-verify-jwt --project-ref svjglgrxqxqtonoobcdi
# ... demais funções
```

`--no-verify-jwt` é usado porque a extensão envia `apikey` (anon) e a validação é feita por body/header próprio (licenseKey + deviceFingerprint ou JWT de sessão).

## Comunicação com o painel

- O painel usa **Supabase Auth** (login) e chama a **API na Vercel** com o JWT (Authorization / X-Auth-Token).
- A Vercel usa **SUPABASE_URL** e **SUPABASE_SERVICE_ROLE_KEY** para acessar Postgres e Auth Admin.
- Garantir que essas variáveis na Vercel apontem para este projeto (svjglgrxqxqtonoobcdi).
