# Arquitetura – Lovable Infinity

Documentação dos fluxos e variáveis de ambiente (Fase 2 da revisão geral).

## Fluxo: Extensão → Supabase → N8N → Lovable

```mermaid
sequenceDiagram
    participant Ext as Extensao
    participant Val as validate-license
    participant DB as Postgres_licenses
    participant Send as send-prompt
    participant N8N as N8N
    participant Lovable as Lovable

    Ext->>Val: POST licenseKey + deviceFingerprint
    Val->>DB: getLicense(key)
    DB-->>Val: license
    Val->>Val: validar active, expiry, max_uses, sessao
    Val->>DB: updateLicense (activated, session)
    Val-->>Ext: sessionToken, refreshToken, expiresAt
    Ext->>Send: POST Authorization Bearer sessionToken, message, projectId, token, files
    Send->>Send: requireSession (JWT)
    Send->>N8N: POST JSON ou FormData
    N8N->>Lovable: integracao
```

## Fluxo: Painel → Vercel → Supabase

```mermaid
sequenceDiagram
    participant User as Navegador
    participant Panel as Painel_admin
    participant Vercel as Vercel_estatico_API
    participant Auth as Supabase_Auth
    participant DB as Supabase_Postgres

    User->>Panel: acessa lovable-infinity-panel.vercel.app
    Panel->>Vercel: HTML/JS/CSS (admin/)
    Panel->>Auth: signInWithPassword (Supabase Client)
    Auth-->>Panel: session (access_token)
    Panel->>Vercel: GET/POST/PUT/DELETE /api/listLicenses, createLicense, ...
    Vercel->>Vercel: verifyToken(req) JWKS ou JWT Secret
    Vercel->>DB: getSupabase().from('licenses') ou auth.admin
    DB-->>Vercel: dados
    Vercel-->>Panel: JSON
```

## Variáveis de ambiente

### Vercel (Production)

| Variável | Uso |
|----------|-----|
| **SUPABASE_URL** | api/_lib/supabaseClient.js, verifyToken (verifyViaAuthServer), verifyJwks (JWKS URL). Ex.: https://svjglgrxqxqtonoobcdi.supabase.co |
| **SUPABASE_SERVICE_ROLE_KEY** | supabaseClient (createClient), verifyViaAuthServer (apikey). Obrigatório para API de licenças e panel users. |
| **JWT_SECRET** ou **SUPABASE_JWT_SECRET** | api/_lib/verifyJwtSecret.js (fallback HS256). Opcional se JWKS estiver ok; recomendado para evitar chamada ao Auth em toda request. |

### Supabase Edge Functions (Secrets)

| Secret | Função | Uso |
|--------|--------|-----|
| **SUPABASE_URL** | (injetado) | getSupabaseClient |
| **SUPABASE_SERVICE_ROLE_KEY** | (injetado) | getSupabaseClient |
| **JWT_SECRET** | _shared/jwt.ts | Assinar e validar JWT de sessão (validate-license, verify-session, refresh-session, send-prompt). |
| **N8N_WEBHOOK_URL** | send-prompt, send-message | URL do webhook N8N. Obrigatório para envio de mensagens. |

Outros (se usados por send-message ou enhance-prompt): OPENROUTER_API_KEY, HMAC_SIGNING_SECRET, etc., conforme código de cada função.

## Onde aparecem “clientes e sócios”

No repositório atual:

- **Licenças** = tabela `licenses` (key, user_name, user_phone, owner_id, …). Exibidas na aba Licenças do painel.
- **Usuários do painel** = Supabase Auth (auth.admin.listUsers, createUser, updateUserById, deleteUser). Exibidos na aba Administração (apenas master).

Não há tabelas `clientes` ou `socios` nas migrations. Se existirem no projeto Supabase fora do repo, devem ser documentadas e incluídas no painel (nova aba ou seção) conforme decisão do produto.
