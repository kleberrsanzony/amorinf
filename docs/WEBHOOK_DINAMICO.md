# Webhook Dinâmico via Firebase — Relatório e Guia

> **Data de implementação:** 10 de Fevereiro de 2026
> **Versão da extensão:** Aplicado no código-fonte (pre-build)
> **Objetivo:** Permitir atualização remota da URL do webhook N8N sem precisar redistribuir a extensão.

---

## 1. Relatório da Implementação

### 1.1. Problema

Toda vez que a URL pública do webhook N8N mudava, era necessário:
1. Editar o `popup.js` manualmente
2. Rodar o build com ofuscação
3. Gerar novo ZIP
4. Enviar o novo ZIP para todos os usuários

Isso gerava downtime, retrabalho e dependência de distribuição manual.

### 1.2. Solução Implementada

A extensão agora busca a configuração do webhook **remotamente** no Firebase Realtime Database ao abrir. Se a busca falhar (rede fora, Firebase indisponível, etc.), ela usa os valores **hardcoded como fallback seguro**, garantindo que nunca quebre.

### 1.3. Arquitetura

```
┌─────────────────┐     GET /config/webhook.json     ┌────────────────────┐
│   Extensão      │ ──────────────────────────────▶   │ Firebase RTDB      │
│   (popup.js)    │                                   │ (lovable2-e6f7f)   │
│                 │ ◀──────────────────────────────   │                    │
│  Se OK → usa    │     { url, salt, scramble }       │ /config/webhook    │
│  Se falha →     │                                   │   .read: true      │
│  usa fallback   │                                   │   .write: false    │
└─────────────────┘                                   └────────────────────┘
```

### 1.4. Arquivos Modificados

| Arquivo | O que foi feito |
|---------|----------------|
| `extension/popup.js` | Adicionado fetch ao Firebase com fallback para valores hardcoded |
| `database.rules.json` | Adicionada regra `.read: true` para `/config/webhook` |
| Firebase RTDB | Criado nó `/config/webhook` com `url`, `salt` e `scramble` |

### 1.5. Dados Armazenados no Firebase

Caminho: `/config/webhook`

```json
{
  "url": "https://cleanpig-n8n.cloudfy.live/webhook/ccnohallcodesxlo",
  "salt": "PX-V3-HANDSHAKE-@#$",
  "scramble": "PROMPTX-LOCKED-99"
}
```

### 1.6. Lógica no popup.js

```javascript
// Valores hardcoded como fallback seguro
const FALLBACK_WEBHOOK_URL = 'https://cleanpig-n8n.cloudfy.live/webhook/ccnohallcodesxlo';
const FALLBACK_SALT = 'PX-V3-HANDSHAKE-@#$';
const FALLBACK_SCRAMBLE = 'PROMPTX-LOCKED-99';

let WEBHOOK_URL = FALLBACK_WEBHOOK_URL;
let SECRET_SALT = FALLBACK_SALT;
let SCRAMBLE_KEY = FALLBACK_SCRAMBLE;

try {
    const cfgResp = await fetch('https://lovable2-e6f7f-default-rtdb.firebaseio.com/config/webhook.json');
    if (cfgResp.ok) {
        const cfgData = await cfgResp.json();
        if (cfgData && cfgData.url) WEBHOOK_URL = cfgData.url;
        if (cfgData && cfgData.salt) SECRET_SALT = cfgData.salt;
        if (cfgData && cfgData.scramble) SCRAMBLE_KEY = cfgData.scramble;
    }
} catch (_) {
    // Falha silenciosa - usa fallback hardcoded
}
```

---

## 2. Passo a Passo para Próximas Trocas de Webhook

### Cenário: O webhook do N8N mudou e precisa ser atualizado

**Tempo estimado: 2 minutos. Não precisa gerar novo build nem redistribuir extensão.**

#### Passo 1 — Preparar o comando

Na raiz do projeto (`Github-Lovable_Infinity`), abra o terminal e execute:

```bash
node -e "const admin = require('firebase-admin'); const sa = require('./docs/lovable2-e6f7f-firebase-adminsdk-fbsvc-20c33e3d94.json'); admin.initializeApp({credential: admin.credential.cert(sa), databaseURL: 'https://lovable2-e6f7f-default-rtdb.firebaseio.com'}); admin.database().ref('config/webhook').set({url: 'NOVA_URL_AQUI', salt: 'PX-V3-HANDSHAKE-@#$', scramble: 'PROMPTX-LOCKED-99'}).then(() => {console.log('Webhook atualizado com sucesso!'); process.exit(0);}).catch(e => {console.error('Erro:', e.message); process.exit(1);});"
```

> **Substitua `NOVA_URL_AQUI` pela nova URL do webhook.**
> Os campos `salt` e `scramble` só mudem se a nova extensão-base usar valores diferentes.

#### Passo 2 — Verificar se atualizou

```bash
node -e "fetch('https://lovable2-e6f7f-default-rtdb.firebaseio.com/config/webhook.json').then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))"
```

#### Passo 3 — Testar a extensão

1. Abra o Chrome
2. Feche e reabra a extensão (para forçar novo fetch)
3. Envie uma mensagem de teste
4. Confirme que funciona

#### Passo 4 — Atualizar o fallback (opcional, mas recomendado)

Após confirmar que funciona, atualize os valores de fallback no `extension/popup.js` para que o hardcoded também fique atualizado:

```javascript
const FALLBACK_WEBHOOK_URL = 'NOVA_URL_AQUI';
```

> **Isso é opcional.** O fallback só é usado se o Firebase estiver inacessível. Mas manter atualizado é uma boa prática.

---

## 3. Passo a Passo Alternativo: Via Console do Firebase

Se preferir interface gráfica:

1. Acesse: https://console.firebase.google.com/project/lovable2-e6f7f/database/lovable2-e6f7f-default-rtdb/data
2. Navegue até `config > webhook`
3. Edite o campo `url` com a nova URL
4. Salve

---

## 4. Análise de Segurança

### 4.1. O que foi exposto publicamente?

| Dado | Público? | Risco |
|------|----------|-------|
| URL do webhook | Sim (leitura pública no Firebase) | **Baixo** — A URL do webhook por si só não permite operação maliciosa; o N8N exige payload com formato e assinatura específicos |
| SECRET_SALT | Sim (leitura pública no Firebase) | **Baixo** — Faz parte da assinatura temporal; sem o código completo, é inútil |
| SCRAMBLE_KEY | Sim (leitura pública no Firebase) | **Baixo** — Usado para XOR do payload; sem saber a estrutura exata, é inútil |
| Escrita no Firebase | **Não** — `.write: false` | Zero risco de alteração externa |

### 4.2. Por que o risco é baixo?

1. **Esses valores já estavam no código-fonte** — Quem já tinha acesso à extensão (mesmo ofuscada) poderia extraí-los via debugging.
2. **A ofuscação continua protegendo** — No build, o fetch ao Firebase e todos os fallbacks são ofuscados com RC4, control flow flattening, self-defending, etc. Um atacante não consegue facilmente encontrar a URL do Firebase no código ofuscado.
3. **O path é somente leitura** — Ninguém de fora pode alterar o webhook via Firebase.
4. **O N8N valida o payload** — Mesmo que alguém descubra a URL, precisa enviar o payload no formato correto com scramble, signature, etc.

### 4.3. Impacto no Build

| Aspecto | Status |
|---------|--------|
| Ofuscação do `popup.js` | ✅ Funciona normalmente — `fetch`, `try/catch`, `let` são JS padrão suportado pelo ofuscador |
| Armadilhas anti-IA | ✅ Continuam sendo injetadas antes da ofuscação |
| Blindagem HTML/CSS | ✅ Não afetada — é injetada no `popup.js` antes da ofuscação |
| `selfDefending` | ✅ Compatível — o código novo não usa nenhum padrão que quebre o self-defending |
| Tamanho do build | ✅ Aumento desprezível (~300 bytes antes da ofuscação) |

### 4.4. Conclusão

> **A segurança do build NÃO foi comprometida.** A implementação adiciona apenas um `fetch` com fallback seguro, que é completamente ofuscado durante o build. Os dados no Firebase são somente-leitura para o público, e os mesmos dados já estavam presentes no código-fonte como fallback.

---

## 5. Histórico de Webhooks

| # | URL | Status | Data |
|---|-----|--------|------|
| 1 | `https://cleanpig-n8n.cloudfy.live/webhook/hahah393dmhash` | ❌ Desativado | ~2026-02 (anterior) |
| 2 | `https://cleanpig-n8n.cloudfy.live/webhook/ccnohallcodesxloyu` | ❌ Desativado | ~2026-02 |
| 3 | `https://cleanpig-n8n.cloudfy.live/webhook/ccnohallcodesxlo` | ✅ **Ativo** | 10/02/2026 |

---

## 6. FAQ

**P: Se eu fizer build agora, o webhook dinâmico vai funcionar no build?**
R: Sim. O `fetch` ao Firebase é código JavaScript padrão e será ofuscado junto com todo o resto. Funciona tanto em modo dev quanto no build.

**P: E se o Firebase cair?**
R: A extensão usa o fallback hardcoded e continua funcionando normalmente.

**P: E se eu mudar o salt ou scramble junto com a URL?**
R: Basta atualizar os 3 campos no Firebase. A extensão vai pegar todos. Mas lembre-se: o N8N precisa estar configurado para aceitar o novo salt/scramble.

**P: Preciso fazer build depois de mudar o webhook no Firebase?**
R: **Não.** Essa é justamente a vantagem. Só faça build se quiser atualizar o fallback no código ou se houver outras mudanças.

**P: Alguém pode hackear o webhook mudando o valor no Firebase?**
R: Não. O path `/config/webhook` tem `.write: false` — só pode ser alterado via Firebase Admin SDK (que exige a chave de serviço privada).
