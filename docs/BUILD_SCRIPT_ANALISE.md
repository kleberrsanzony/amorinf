# Análise do script de build (scripts/build.js)

## O que o script faz com a versão (ordem exata)

1. **Leitura**  
   - Lê `package.json` (ROOT = pasta do projeto).  
   - `currentVersion = pkg.version` (string), ou `'1.0.0'` se não existir.

2. **Tipo de incremento**  
   - Chama `getVersionType()`:
     - Se existir `process.env.VERCEL` → retorna `'skip'` (não incrementa).
     - Senão: `args = process.argv.slice(2)` (argumentos após o nome do script).
     - `arg = (args[0] || '').toLowerCase().trim()`.
     - Se `arg === 'major'` → `'major'`.  
     - Se `arg === 'minor'` → `'minor'`.  
     - Se `arg === 'patch'` → `'patch'`.  
     - Se `arg === 'skip'` ou `'none'` ou `'0'` → `'skip'`.  
     - **Em qualquer outro caso (incluindo nenhum argumento) → `'minor'`.**

3. **Cálculo da nova versão**  
   - Se `versionType !== 'skip'`:  
     - `newVersion = incrementVersion(currentVersion, versionType)` (SemVer: major sobe e zera minor/patch; minor sobe e zera patch; patch sobe 1).  
     - Escreve `pkg.version = newVersion` em `package.json`.  
   - Se `versionType === 'skip'`:  
     - `newVersion = currentVersion` (não grava em package.json).

4. **Propagação**  
   - Lê `extension/manifest.json`.  
   - Atribui `manifest.version = newVersion`.  
   - Escreve `extension/manifest.json`.

5. **Uso da versão**  
   - `ZIP_NAME = LOVABLE_INFINITY_v${newVersion}.zip`.  
   - `admin/version.json` é gerado com `version: newVersion` e `filename: ZIP_NAME`.

6. **Git (apenas fora da Vercel)**  
   - Se `!process.env.VERCEL` e existir `.git`:  
   - `git add package.json extension/manifest.json admin/version.json` → `git commit -m "chore: build vX.Y.Z"` → `git push`.  
   - Se falhar (ex.: nada a commitar), só registra aviso.

## Comando npm

No `package.json`: `"build": "node scripts/build.js"`.

- `npm run build` → executa `node scripts/build.js` **sem argumentos** → `getVersionType()` retorna **`'minor'`** (comportamento automático).
- `npm run build -- patch` → retorna **`'patch'`**.
- `npm run build -- minor` → retorna **`'minor'`**.
- `npm run build -- major` → retorna **`'major'`**.
- `npm run build -- skip` → retorna **`'skip'`**.

## Conclusão objetiva

- **Fonte de verdade da versão:** `package.json` (campo `version`).  
- **Comportamento automático (sem argumentos):** incremento **MINOR** (ex.: 5.0.0 → 5.1.0).  
- **Patch/Major/Skip:** use `npm run build -- patch`, `-- major` ou `-- skip` quando quiser.  
- **Git:** fora da Vercel, o script faz commit + push dos arquivos de versão (package.json, manifest, version.json).  
- **Nada no script** lê git ou commits; a decisão é: existe `VERCEL`? → skip; senão, argumento é major/minor/patch/skip/0/none? → usa isso; senão → minor.

Não há, no código atual, lógica que “escolha” automaticamente entre patch, minor e major conforme o tipo de mudança.
