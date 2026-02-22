# Proxy Funil — Colocar no ar

## 1. Secrets (obrigatório, via CLI)

Se aparecer **"Serviço de envio indisponível"**, falta configurar os secrets do Supabase do projeto **Github-Lovable_Infinity** (não do PromptX).

| Secret | Onde obter | Exemplo |
|--------|------------|--------|
| **JWT_SECRET** | Qualquer string longa e segura (gera os JWTs da validate-license) | `minha_chave_jwt_secreta_32chars` |
| **PROMPTX_LICENSE_KEY** | A licença única PromptX 3.1 usada no funil | `TDH8-3XO7-P9MC-PY3Y` |
| **PROMPTX_GATEWAY_URL** | URL da Edge Function **secure-gateway** do projeto Supabase do **PromptX** | `https://XXXX.supabase.co/functions/v1/secure-gateway` |
| **PROMPTX_ANON_KEY** | No Supabase do PromptX: Project Settings → API → **anon public** | `eyJhbGciOiJIUzI1NiIs...` |
| **PROMPTX_DEVICE_ID** | DeviceId da máquina em que essa licença foi **ativada** no PromptX 3.1 (não inventar) | Ex.: valor que o PromptX usa ao validar a licença nessa máquina |

Comando (troque os valores e o `--project-ref` pelo do **seu** projeto Supabase — Lovable/Infinity):

```bash
supabase secrets set ^
  JWT_SECRET="sua_chave_jwt" ^
  PROMPTX_LICENSE_KEY="TDH8-3XO7-P9MC-PY3Y" ^
  PROMPTX_DEVICE_ID="deviceId_da_maquina_onde_a_licenca_foi_ativada" ^
  PROMPTX_GATEWAY_URL="https://SEU_PROJETO_PROMPTX.supabase.co/functions/v1/secure-gateway" ^
  PROMPTX_ANON_KEY="eyJhbGci..." ^
  --project-ref SEU_PROJECT_REF
```

- No **Windows (PowerShell)** use `` ` `` no fim de cada linha em vez de `^`.
- **PROMPTX_DEVICE_ID**: tem de ser **exatamente** o deviceId da máquina onde a licença PromptX foi ativada (formato **HWID_CPU_GPU**). **Forma mais fácil:** abra a extensão Lovable Infinity → tela de login (auth). Na parte de baixo aparece "Proxy Funil: DeviceId desta máquina"; copie esse valor, cole no `.env` como `PROMPTX_DEVICE_ID=` e rode `npm run set-secrets`. (A extensão gera o mesmo formato que o PromptX 3.1 usa nesta máquina.) O send-prompt usa só esse valor para falar com o gateway.

**Se aparecer "A licença PromptX está vinculada a outro computador"**  
Atualize o deviceId em **um único lugar**: o arquivo **`.env`** na raiz do projeto. Coloque o deviceId correto (da máquina onde a licença foi ativada) na variável `PROMPTX_DEVICE_ID` e rode:
```bash
npm run set-secrets
```
Isso aplica o valor do `.env` nos secrets do Supabase. O script está em `scripts/set-proxy-secrets.js`.

## 2. Tabelas (se ainda não existirem)

```bash
cd C:\Users\luan9\OneDrive\Documentos\Github-Lovable_Infinity
supabase db push --project-ref SEU_PROJECT_REF
```

Ou execute o SQL de `supabase/migrations/` (session_cache, usage_logs, licenses) no SQL Editor do Supabase.

## 3. Edge Functions

Deploy das functions (validate-license, send-prompt):

```bash
supabase functions deploy validate-license --project-ref SEU_PROJECT_REF
supabase functions deploy send-prompt --project-ref SEU_PROJECT_REF
```

Depois de configurar os secrets, a mensagem de erro da extensão passará a mostrar o motivo exato (ex.: "Gateway PromptX: ...", "Validate recusou: ...", "Erro de conexão: ...") para facilitar o ajuste.
