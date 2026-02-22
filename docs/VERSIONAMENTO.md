# Versionamento da extensão Lovable Infinity

## SemVer (MAJOR.MINOR.PATCH)

- **MAJOR (5.x.x)**: mudanças que quebram compatibilidade ou marco importante do produto (ex.: nova arquitetura, migração de API).
- **MINOR (x.1.x)**: novas funcionalidades compatíveis com versões anteriores (ex.: novo recurso, nova tela).
- **PATCH (x.x.1)**: correções, ajustes, refatorações que não mudam o contrato (ex.: bugfix, texto, estilo).

## Como o build altera a versão

O script `scripts/build.js` lê a versão de `package.json` e pode incrementá-la antes de gerar o ZIP.

| Comando | Efeito | Exemplo |
|--------|--------|--------|
| `npm run build` | Incrementa **PATCH** (padrão) | 5.0.0 → 5.0.1 |
| `npm run build -- minor` | Incrementa **MINOR**, zera PATCH | 5.0.1 → 5.1.0 |
| `npm run build -- major` | Incrementa **MAJOR**, zera MINOR e PATCH | 5.1.0 → 6.0.0 |
| `npm run build -- skip` | **Não altera** a versão | 5.0.0 → 5.0.0 |

A versão é propagada para `extension/manifest.json` e para o nome do ZIP (`LOVABLE_INFINITY_vX.X.X.zip`).

## Por que ficamos em 4.0.14?

O **padrão** do build é sempre incrementar só o PATCH. Quem roda só `npm run build` (sem `-- minor` ou `-- major`) faz a versão subir assim: 4.0.1, 4.0.2, … 4.0.14. Não há falha no script: o desenho é “cada build sobe um número” para rastreabilidade. O que acontece é que, se ninguém passar `minor` ou `major` nas mudanças maiores, o número não reflete isso — fica tudo em 4.0.x.

Para refletir melhor o que mudou:

- **Muitas mudanças / novo marco** → rodar `npm run build -- major` (ex.: ir para 5.0.0).
- **Nova funcionalidade** → rodar `npm run build -- minor` (ex.: 5.0.14 → 5.1.0).
- **Só correção ou ajuste** → `npm run build` (sobe só o PATCH).

## Vercel (CI)

Em ambiente Vercel o build usa sempre **skip**: a versão não é alterada no deploy automático.
