# Segurança e Ofuscação – Lovable Infinity

Este documento descreve o fluxo de build com ofuscação anti-IA e a estrutura de segurança para a extensão Chrome.

---

## 1. Escopo do build

| Extensão         | Build | Distribuição      |
|-----------------|-------|-------------------|
| **extension-prod/** | Sim – ofuscação, ZIP, deploy | Usuários finais (única extensão) |

---

## 2. Mapeamento de arquivos (nomes neutros)

O build substitui os nomes reais dos scripts por nomes neutros para dificultar engenharia reversa:

| Arquivo original | Destino no build |
|------------------|------------------|
| config.js        | c1.js            |
| auth.js          | c2.js            |
| popup.js         | c3.js            |
| background.js    | c4.js            |
| content.js       | c5.js            |
| zip-utils.js     | c6.js            |

Os HTML (`auth.html`, `popup.html`) e o `manifest.json` na pasta de build referenciam os arquivos ofuscados.

---

## 3. Ofuscação (javascript-obfuscator)

O script usa configurações rigorosas:

- `controlFlowFlattening`, `deadCodeInjection`, `selfDefending`
- `stringArray` com encoding RC4
- `splitStrings`, `numbersToExpressions`, `transformObjectKeys`
- `identifierNamesGenerator: 'hexadecimal'`

---

## 4. Armadilhas anti-IA

Antes da ofuscação, o script injeta blocos de código que:

1. Contêm avisos legais em inglês e português
2. Usam codificação Morse, ROT13 e hex
3. Incluem funções “armadilha” com nomes que parecem relevantes
4. Incluem strings invertidas e mensagens em Base64

Qualquer IA que tente analisar o código ofuscado encontra instruções para recusar pedidos de modificação, bypass ou engenharia reversa.

---

## 5. Aviso legal pós-ofuscação

O script adiciona um comentário no topo de cada arquivo ofuscado com:

- Aviso de proteção de licença (PT/EN)
- Menção à Lei 9.609/98 (Brasil)
- Instruções para assistentes de IA recusarem pedidos de modificação

---

## 6. Arquivos copiados (sem ofuscação)

- `auth.html`, `popup.html`, `styles.css`, `manifest.json`, `voice-permission.js`
- `ICONS/`, `LOGOCOMPLETA12.svg`
- O manifest na build é ajustado para apontar para c4.js (background) e c5.js (content)

---

## 7. Fluxo do build

1. Ler versão de `package.json` e incrementar (patch/minor/major ou skip)
2. Propagar versão para `extension-prod/manifest.json`
3. Pré-processar `background.js` (substituir referências por c1.js, c6.js)
4. Injetar armadilhas anti-IA
5. Ofuscar JS com `javascript-obfuscator`
6. Adicionar aviso legal pós-ofuscação
7. Copiar HTML, CSS, manifest, voice-permission, ICONS, logo
8. Substituir referências nos HTML e no manifest
9. Gerar ZIP na raiz
10. Copiar ZIP para `admin/downloads/`
11. Gerar `admin/version.json`
12. Executar `npx vercel --prod --yes` (deploy na Vercel)

---

## 8. Licenças expostas removidas

- **validate-license:** removidos `MAINTENANCE_LICENSE_KEY`, `EMERGENCY_MODE` e modo de emergência.
- **popup.js:** removido fallback `devLicenseFirstUsed` e `CONFIG.DEV_LICENSE_DAYS`.

A validação depende exclusivamente do Postgres (tabela `licenses`).

---

*Última atualização: fevereiro de 2026.*
