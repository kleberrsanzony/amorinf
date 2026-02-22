# Remoção do badge Lovable (marca d'água)

Este documento descreve como a extensão **Lovable Infinity** remove o badge/marca d'água do Lovable nos projetos, permitindo publicar ou baixar o projeto sem o selo "Made with Lovable".

## Visão geral

O fluxo é **idêntico ao do PromptX 3.1**: a extensão não usa a API de `source-code` (GET/PATCH/PUT), que na prática retorna 405 para atualização. Em vez disso, usa:

1. **GET** do conteúdo do arquivo CSS principal via `files/raw?path=...`
2. **POST** da alteração via endpoint `edit-code` com um único “change” no arquivo CSS

Assim, apenas o arquivo de estilos principal é alterado (adicionando a regra que oculta o badge), sem precisar ler/reescrever todo o projeto.

---

## API utilizada (Lovable)

Base URL: `https://api.lovable.dev/projects/{projectId}`

Todas as requisições exigem o token do usuário no header:

- `Authorization: Bearer {token}`
- `Content-Type: application/json` (onde houver body)
- `Accept: application/json` (onde fizer sentido)

### 1. Ler o arquivo CSS

**GET** `.../files/raw?path={path}`

- **path**: caminho do arquivo no projeto, codificado em URL (ex.: `src%2Findex.css`).
- A extensão tenta, nesta ordem:
  - `src/index.css`
  - `index.css`
  - `src/App.css`
  - `src/styles.css`
- Resposta: corpo da resposta é o **texto** do arquivo (conteúdo do CSS).

Se o GET falhar (404, 401, etc.) ou o path não existir, a extensão tenta o próximo path. Se nenhum funcionar, é exibida mensagem orientando o uso de **Baixar projeto** (o ZIP já é gerado sem o badge).

### 2. Verificar se o badge já está oculto

No conteúdo do CSS lido, a extensão verifica se já existe a lógica de ocultar o badge, procurando no texto:

- `#lovable-badge`
- `display`
- `none`

Se os três estiverem presentes, considera que a marca d'água já está removida e retorna sucesso sem alterar nada.

### 3. Regra CSS adicionada

A regra acrescentada ao final do arquivo CSS é:

```css

#lovable-badge {
  display: none !important;
}
```

(com quebra de linha antes, e sem remover conteúdo existente; apenas append.)

### 4. Aplicar a alteração (edit-code)

**POST** `.../edit-code`

**Body (JSON):**

```json
{
  "changes": [
    {
      "path": "src/index.css",
      "content": "{conteúdo atual do arquivo + regra do badge}"
    }
  ],
  "uploads": [],
  "commit_message": "Hide Lovable badge",
  "file_edit_type": "CodeEdit"
}
```

- **path**: mesmo path usado no GET que deu certo (`src/index.css` ou `index.css`).
- **content**: conteúdo completo do arquivo após o append da regra (trim no final do original + regra acima).
- **file_edit_type**: `"CodeEdit"` (estilo PromptX 3.1).

Se o POST retornar sucesso (2xx), a extensão considera a remoção do badge concluída. O usuário ainda precisa **publicar** o projeto no Lovable para ver o resultado no deploy.

---

## Projeto da aba ativa

Ao clicar em "Remover marca d'água", o **background** obtém de novo o `projectId` da **aba ativa** (e, se faltar, o token do storage). Assim, mesmo ao trocar de projeto/aba, a ação é aplicada sempre ao projeto que está aberto na aba atual, e não a um projeto em cache no popup.

## Fluxo resumido (no código)

1. Obter `projectId` da URL da aba ativa (`/projects/:id`) e token (request ou storage).
2. Para cada path em `['src/index.css', 'index.css', 'src/App.css', 'src/styles.css']`:
   - GET `.../files/raw?path={path}` (com timeout ~12s).
   - Se falhar (rede, 404, etc.) → próximo path.
   - Se sucesso: ler corpo como texto.
   - Se já contém `#lovable-badge` + `display` + `none` → retornar “A marca d'água já está oculta”.
   - Caso contrário: `novoConteudo = conteudo.trimEnd() + regraCss`.
   - POST `.../edit-code` com `changes: [{ path, content: novoConteudo }]`, `uploads: []`, `commit_message`, `file_edit_type: 'CodeEdit'`.
   - Se POST ok → retornar sucesso.
2. Se nenhum path resultar em sucesso no edit-code → exibir mensagem para usar **Baixar projeto** (ZIP já vem sem o badge).

Não há fallback para a API antiga de `source-code` (GET full + PATCH/PUT) nem para envio de prompt pelo chat; o único fluxo é o descrito acima.

---

## Timeouts e erros

- GET raw e POST edit-code: timeout de 12 segundos cada (AbortController).
- Timeout geral da ação “Remover marca d'água”: 25 segundos; ao estourar, é exibida mensagem orientando o uso de “Baixar projeto”.
- Erros comuns:
  - **401**: token expirado ou inválido → usuário deve recarregar a página do Lovable.
  - **404** em `files/raw`: path não existe neste projeto (ex.: estrutura diferente) → tenta o outro path ou mostra mensagem final.
  - Falha no `edit-code`: API pode não aceitar esse endpoint ou formato → mensagem para usar “Baixar projeto”.

---

## Referência

- Comportamento baseado no **PromptX 3.1** (fluxo de “Remove Watermark”).
- Implementação atual: `extension/background.js`, ação `removeWatermarkInLovable`.
- Download do projeto (ZIP) continua usando a lógica própria de limpeza do badge nos arquivos baixados; não usa a API `edit-code`.
