# Remoção de ex-sócios e licenças associadas

## Comportamento automático (a partir de agora)

Quando você **apaga um sócio** no painel (aba "Usuários do painel" → botão "Apagar" ao lado do usuário):

1. **A API remove primeiro** todas as licenças cujo `owner_id` é o UID desse sócio.
2. **Em seguida** remove o usuário do Supabase Auth (revoga o acesso ao painel).

Ou seja: **não é preciso fazer limpeza manual** ao excluir um sócio. O fluxo "Apagar" já faz a limpeza das licenças daquele sócio.

---

## Limpeza de licenças órfãs (ex-sócios já removidos no passado)

Se você **já excluiu sócios antes** de existir essa lógica, podem ter ficado licenças com `owner_id` apontando para usuários que não existem mais no Auth (licenças "órfãs").

**No painel:** aba "Usuários do painel" → botão **"Limpar licenças de ex-sócios"**.

- A API lista todos os usuários atuais do Auth e remove todas as licenças cujo `owner_id` **não** está nessa lista.
- Assim, licenças de ex-sócios já apagados são removidas de uma vez.
- Se não houver licenças órfãs, a mensagem será "Nenhuma licença órfã encontrada."

Recomendado rodar **uma vez** se você está "sem sócio nenhum" e quer garantir que não sobrou licença de ex-sócio.

---

## Uso avançado (script e SQL)

Para conferência ou automação fora do painel:

- **Script:** `FORMER_OWNER_IDS=uid1,uid2 node scripts/remove-licenses-by-owner.js` (listar) ou `... --delete` (remover). Requer `.env` com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
- **SQL (Supabase):** `DELETE FROM licenses WHERE owner_id IN ('uid1','uid2');`

O script e o SQL são opcionais; o fluxo normal é **Apagar no painel** (limpeza automática) e **Limpar licenças de ex-sócios** (uma vez, se precisar).
