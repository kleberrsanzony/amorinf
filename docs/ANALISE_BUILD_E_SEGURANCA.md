# Análise: fluxo de build e segurança – Lovable Infinity

**Data:** 2026-02-14  
**Escopo:** script de build (`scripts/build.js`), Vercel, API, painel admin, extensão.

---

## Parte 1 – Análise do fluxo de build

### 1.1 Visão geral

| Item | Valor |
|------|--------|
| Comando | `npm run build` → `node scripts/build.js` |
| Entrada | `package.json` (versão), pasta `extension/` |
| Saída | `extension/build/`, `LOVABLE_INFINITY_vX.X.X.zip`, `admin/downloads/`, `admin/version.json` |
| Ambiente Vercel | `buildCommand: "npm run build"`, `outputDirectory: "admin"` |

### 1.2 Dependências do build

- **Node:** `>=14.0.0` (package.json engines).
- **Pacotes (devDependencies):** `javascript-obfuscator`, `archiver` (e de produção usados pela API, não pelo build).
- **Arquivos obrigatórios em `extension/`:**
  - Para ofuscar: `config.js`, `auth.js`, `popup.js`, `background.js`, `content.js`, `zip-utils.js`.
  - Para copiar: `auth.html`, `popup.html`, `styles.css`, `manifest.json`, `voice-permission.js`.
  - Opcionais: `ICONS/` (se existir), `LOGOCOMPLETA12.svg`.

Se qualquer arquivo da lista de ofuscação faltar, o script encerra com `process.exit(1)`.

### 1.3 Convenção de nomes (dev vs build)

- **Em `extension/`** use sempre os **nomes de desenvolvimento**: `config.js`, `auth.js`, `popup.js`, `background.js`, `content.js`, `zip-utils.js`. Nenhum arquivo de código deve referenciar `c1.js`, `c2.js`, etc.
- **Na pasta build** (`extension/build/`) o script aplica o mapeamento único (`OBFUSCATE_LIST` / `DEV_TO_BUILD` em `scripts/build.js`): todos os scripts viram `c1.js` … `c6.js`, e todas as referências (em JS, HTML e manifest) são substituídas por esse mesmo mapeamento. Assim as referências ficam sempre corretas.

### 1.4 Ordem das etapas (sem quebrar)

1. **Versão** – Lê `package.json` e `extension/manifest.json`. Em ambiente Vercel (`process.env.VERCEL`), mantém versão (`skip`). Caso contrário, incrementa conforme argumento (patch/minor/major/skip) e persiste em ambos os arquivos.
2. **Obfuscator** – `require('javascript-obfuscator')`. Se falhar, encerra com mensagem para rodar `npm install`.
3. **Limpeza** – Remove `extension/build/` se existir (rimraf).
4. **Ofuscação** – Para cada par em `OBFUSCATE_LIST`: lê arquivo, aplica `applyBuildNames(code)` (substitui todos os nomes de dev por c1..c6), injeta armadilhas anti-IA, ofusca, adiciona aviso legal, grava em `extension/build/` com nome destino (c1.js … c6.js). Qualquer falha → exit(1).
5. **Cópia** – Copia `COPY_FILES` de `extension/` para `extension/build/`. Se um arquivo não existir, só loga aviso e continua.
6. **HTML** – Aplica o mesmo `OBFUSCATE_LIST` em `popup.html` e `auth.html` (referências a scripts viram c1, c2, c3).
7. **Manifest** – Ajusta `manifest.json` do build usando `DEV_TO_BUILD`: `background.service_worker` = valor de `background.js` (c4.js), `content_scripts[0].js` = valor de `content.js` (c5.js).
8. **Validação** – Verifica se a build não contém referências aos nomes de dev em HTML e manifest; se encontrar, falha com mensagem clara.
9. **ICONS e logo** – `copyDirSync(extension/ICONS, build/ICONS)`; se `LOGOCOMPLETA12.svg` existir, copia. Se `ICONS` não existir, a função só retorna (não falha).
10. **ZIP** – Remove ZIPs antigos na raiz; cria `LOVABLE_INFINITY_v{VERSION}.zip` com conteúdo `extension/build/` (nome interno da pasta: "Lovable Infinity"); nível de compressão 9.
11. **admin/downloads** – Cria `admin/downloads` se necessário; remove ZIPs antigos nessa pasta; copia o novo ZIP; gera `admin/version.json` (version, date, publishedAt, filename).
12. **Deploy** – Se `process.env.VERCEL` estiver definido, apenas loga e retorna (deploy fica a cargo da Vercel). Senão, executa `npx vercel --prod --yes --name lovable-infinity-panel`.

### 1.5 Pontos de falha e mitigação

| Risco | Mitigação |
|-------|-----------|
| Falta um JS da lista de ofuscação | Script falha cedo com mensagem clara; garantir que `extension/` tenha todos os 6 arquivos. |
| `javascript-obfuscator` ou `archiver` não instalados | `npm install` na raiz antes do build (Vercel instala por causa do `buildCommand`). |
| Pasta `extension/` inexistente ou renomeada | Script usa `extension/` (não mais `extension-prod/`); manter nome da pasta. |
| ICONS vazia ou inexistente | Build não quebra; extensão pode reclamar de ícones no Chrome. Recomendado: manter ícones em `extension/ICONS/`. |
| Falha ao escrever package.json/manifest | Possível em FS somente leitura; em Vercel normalmente não ocorre. |
| Deploy local falha (rede, credenciais) | Script só avisa e não faz exit; build local já gerou ZIP e version.json. |

### 1.6 Eficiência

- **Idempotência:** Limpar `extension/build/` e ZIPs antigos evita lixo e conflito de versão.
- **Vercel:** Não incrementa versão e não chama `vercel` de dentro do build, evitando loop e deploy duplo.
- **Ofuscação:** Um arquivo por vez, síncrono; para muitos arquivos no futuro, considerar fila ou worker (hoje 6 arquivos é aceitável).
- **ZIP:** `archiver` em stream; nível 9 é o mais pesado mas aceitável para o tamanho atual.

### 1.7 Checklist pré-build

- [ ] `extension/config.js`, `auth.js`, `popup.js`, `background.js`, `content.js`, `zip-utils.js` existem.
- [ ] `extension/auth.html`, `popup.html`, `styles.css`, `manifest.json`, `voice-permission.js` existem.
- [ ] `extension/ICONS/` com ícones (ex.: icon.png) se o manifest referenciar.
- [ ] Na raiz: `npm install` já executado (ou será executado pela Vercel).
- [ ] Comando: `npm run build` ou `npm run build -- skip` para não incrementar versão.

---

## Parte 2 – Análise de segurança

### 2.1 API (Vercel)

| Endpoint | Autenticação | Observação |
|----------|--------------|------------|
| `listLicenses`, `getLicense`, `createLicense`, `updateLicense`, `deleteLicense` | `verifyToken(req)` (Supabase Auth: JWKS, JWT secret, getUser, fallback Auth server) | Acesso só com token válido. |
| `listPanelUsers`, `createPanelUser`, `updatePanelUser`, `deletePanelUser` | `verifyToken(req)` | Idem. |
| `extensionRelease` | Nenhuma | Público; retorna apenas version/filename/publicado. Aceitável para versão da extensão. |
| `authDebug` | Header `X-Debug-Secret` === `AUTH_DEBUG_SECRET` | Debug só com secret em env; em produção não definir ou manter secreto. |

Todos os handlers de licenças e usuários do painel exigem token; sem token retornam 401.

### 2.2 Segredos e ambiente

- **API (Vercel):** Usa `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, opcionalmente `SUPABASE_JWT_SECRET` e `JWT_SECRET`, e `AUTH_DEBUG_SECRET` para authDebug. Nenhum deles deve estar no código nem no repositório.
- **.gitignore:** `.env`, `.env.*`, `.env*.local` estão ignorados; builds não devem expor env no cliente.
- **Extensão (config.js):** Contém apenas `SUPABASE_ANON_KEY` e URLs públicas (Supabase e Edge Functions). Anon key é destinada a uso público; não há `service_role` na extensão.

### 2.3 Painel admin

- Login via Supabase Auth; token enviado em `Authorization`, `X-Auth-Token` e em GET em `access_token`/`token`.
- Chamadas à API usam `getAdminAuthToken()`; refresh com cooldown. Tratamento de erro de refresh (ex.: token inválido) evita travar a tela.
- Não foram encontradas chaves de API ou secrets hardcoded no admin.

### 2.4 Extensão

- Config ofuscada no build (c1.js); armadilhas anti-IA e aviso legal no build.
- Endpoints chamados são Edge Functions e Supabase; anon key é a única credencial no cliente, adequado para o modelo Supabase.
- Nenhum endpoint da API Vercel de licenças (create/update/delete/list) é chamado pela extensão; apenas Supabase/Edge.

### 2.5 Recomendações de segurança

1. Manter `AUTH_DEBUG_SECRET` indefinido em produção ou com valor forte e não commitado.
2. Garantir na Vercel que todas as variáveis sensíveis (service_role, JWT secret, debug secret) estejam apenas em Environment Variables.
3. Supabase: RLS e políticas nas tabelas (ex.: `licenses`) alinhadas ao fato de a API usar service_role (a API é o único backend que acessa; o token do painel já foi validado pela API).
4. Se no futuro a extensão chamar a API Vercel, nunca enviar service_role; manter apenas anon ou token de usuário validado.

---

## Parte 3 – Conclusão

- **Build:** Fluxo linear, dependências claras, falhas tratadas com exit ou aviso. Em Vercel não incrementa versão e não dispara deploy interno. Único ponto de atenção: garantir presença dos 6 JS e dos arquivos copiados em `extension/`, e ícones em `extension/ICONS/` se o manifest exigir.
- **Segurança:** APIs de licenças e usuários protegidas por token; segredos em env; extensão sem secrets sensíveis no cliente; authDebug protegido por secret opcional.

Build pode ser executado com: `npm run build` ou `npm run build -- skip`.
