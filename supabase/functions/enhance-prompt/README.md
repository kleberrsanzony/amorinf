# Edge Function: enhance-prompt

Usada pela extensão para **Melhorar prompt** e **Transcrever áudio (voz)**. Ambos só colocam texto no campo de input; o usuário revisa e envia.

- **Melhorar prompt:** `POST` com `{ "text": "..." }` (opcional: `"system_prompt": "..."` ou `"systemPrompt": "..."`) → OpenRouter (Gemini) → `{ "text": "..." }`.
- **Transcrever áudio:** `POST` com `{ "action": "transcribe", "audio": "<base64>", "format": "webm" }` → OpenRouter (áudio) → `{ "text": "..." }`.

Modelo padrão: `google/gemini-2.5-flash-lite`.

**System prompt do Enhanced:** O texto que orienta o modelo ao “melhorar prompt” pode ser definido de duas formas: (1) **Secret** `ENHANCE_SYSTEM_PROMPT` no Supabase (vale para todas as chamadas); (2) **No body** da requisição, campo `system_prompt` ou `systemPrompt` (sobrescreve o secret nessa chamada). Se nenhum for definido, usa o padrão interno da função.

---

## Se aparecer erro na extensão ("Erro ao melhorar prompt" / "Erro ao transcrever áudio")

1. **Configurar a chave no Supabase**  
   - Dashboard do projeto → **Edge Functions** → **Secrets** (ou Project Settings → Edge Functions).  
   - Adicione o secret: **Nome** `OPENROUTER_API_KEY`, **Valor** = sua chave da Open Router.  
   - Chave: https://openrouter.ai (crie conta e gere uma API key).

2. **Fazer deploy da função**  
   - No terminal (na raiz do projeto):  
     `supabase functions deploy enhance-prompt`  
   - Ou pelo Dashboard: Deploy da função `enhance-prompt`.

Sem `OPENROUTER_API_KEY` nos Secrets, a função devolve erro e a extensão mostra "Melhorador de prompt não configurado" ou "Transcrição não configurada".

---

## Segurança

- **Nunca** coloque a API key no código nem em arquivos commitados.
- Use **Supabase Secrets** em produção. Em desenvolvimento local, use `.env` (não commitado).

## Secrets

| Nome | Obrigatório | Uso |
|------|-------------|-----|
| `OPENROUTER_API_KEY` | Sim | Chave Open Router (melhorar prompt + transcrição). |
| `OPENROUTER_MODEL` | Não | Modelo; default: `google/gemini-2.5-flash-lite`. |
| `ENHANCE_SYSTEM_PROMPT` | Não | System prompt usado no “melhorar prompt”. Se não definido, usa o padrão da função; pode ser sobrescrito por `system_prompt` no body. |
