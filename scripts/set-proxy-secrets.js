/**
 * Aplica os secrets do Supabase a partir do .env.
 * Único lugar para atualizar: edite o .env e rode este script.
 *
 * Uso: node scripts/set-proxy-secrets.js
 *      ou: npm run set-secrets
 *
 * No .env, defina o que quiser atualizar:
 *   PROMPTX_DEVICE_ID=...   (proxy funil)
 *   JWT_SECRET=...
 *   OPENROUTER_API_KEY=... (enhance-prompt: melhorar prompt + transcrição por voz)
 *   OPENROUTER_MODEL=...   (opcional; default: google/gemini-2.5-flash-lite)
 */

const { execSync } = require('child_process');
const path = require('path');

const PROJECT_REF = 'svjglgrxqxqtonoobcdi';
const MASK_KEYS = ['JWT_SECRET', 'PROMPTX_DEVICE_ID', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'];

function main() {
    try {
        require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    } catch (_) {}
    const deviceId = (process.env.PROMPTX_DEVICE_ID || '').trim();
    const jwtSecret = (process.env.JWT_SECRET || '').trim();
    const openRouterKey = (process.env.OPENROUTER_API_KEY || '').trim();
    const openRouterModel = (process.env.OPENROUTER_MODEL || '').trim();

    const toSet = [];
    if (deviceId) {
        toSet.push(`PROMPTX_DEVICE_ID=${JSON.stringify(deviceId)}`);
    } else {
        console.warn('AVISO: PROMPTX_DEVICE_ID não está definido no .env (proxy funil).');
    }
    if (jwtSecret) toSet.push(`JWT_SECRET=${JSON.stringify(jwtSecret)}`);
    if (openRouterKey) {
        toSet.push(`OPENROUTER_API_KEY=${JSON.stringify(openRouterKey)}`);
    } else {
        console.warn('AVISO: OPENROUTER_API_KEY não está no .env. Melhorar prompt e transcrição por voz vão falhar até configurar.');
    }
    if (openRouterModel) toSet.push(`OPENROUTER_MODEL=${JSON.stringify(openRouterModel)}`);

    if (toSet.length === 0) {
        console.error('Nada para atualizar. Defina no .env: PROMPTX_DEVICE_ID e/ou OPENROUTER_API_KEY (e opcionalmente JWT_SECRET, OPENROUTER_MODEL) e rode de novo.');
        process.exit(1);
    }

    const mask = (s) => MASK_KEYS.reduce((acc, k) => acc.replace(new RegExp(`\\b${k}=[^ ]+`, 'g'), (m) => m.slice(0, m.indexOf('=')+1) + '***'), s);
    const cmd = `npx supabase secrets set ${toSet.join(' ')} --project-ref ${PROJECT_REF}`;
    console.log('Executando:', mask(cmd));
    execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log('Secrets atualizados no Supabase.');
}

main();
