# Regras do Projeto Lovable Infinity

## Processo de Build e Deploy
Sempre que for solicitado um "build", o seguinte procedimento deve ser seguido rigorosamente, utilizando o script automatizado existente:

1. **Comando**: Executar `npm run build` na raiz do projeto.
   - Este comando invoca `scripts/build.js`.

2. **O que o script faz (e deve ser verificado)**:
   - **Versionamento**: Incrementa a versão no `package.json` e `extension/manifest.json`.
   - **Ofuscação e Build**: Gera a pasta `extension/build` com código ofuscado e assets.
   - **Empacotamento**: Cria o arquivo ZIP `LOVABLE_INFINITY_vX.X.X.zip`.
   - **Admin Assets**: Copia o ZIP para `admin/downloads/` e atualiza `admin/version.json`.
   - **Git Automation**:
     - `git add` dos arquivos de versão.
     - `git commit -m "chore: build vX.X.X"`.
     - `git push` para o repositório remoto.
   - **Deploy Vercel**:
     - Executa `npx vercel --prod --yes` para atualizar o painel administrativo e a API.

## Observações
- Não fazer commit manual de versões ou builds sem passar pelo script, para manter a sincronia.
- Certificar-se de que as credenciais do Git e Vercel estão configuradas no ambiente antes do build.
