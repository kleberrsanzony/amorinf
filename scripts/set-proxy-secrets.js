/**
 * Aplica os secrets do proxy funil (PromptX) a partir do .env.
 * Único lugar para atualizar: edite o .env e rode este script.
 *
 * Uso: node scripts/set-proxy-secrets.js
 *      ou: npm run set-secrets
 *
 * No .env, defina (para atualizar PROMPTX_DEVICE_ID é aqui):
 *   PROMPTX_DEVICE_ID=valor_do_deviceId_da_maquina_onde_a_licenca_foi_ativada
 *   JWT_SECRET=opcional_se_quiser_atualizar_tambem
 */

const { execSync } = require('child_process');
const path = require('path');

const PROJECT_REF = 'svjglgrxqxqtonoobcdi';

function main() {
    try {
        require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    } catch (_) {}
    const deviceId = (process.env.PROMPTX_DEVICE_ID || '').trim();
    const jwtSecret = (process.env.JWT_SECRET || '').trim();

    const toSet = [];
    if (deviceId) {
        toSet.push(`PROMPTX_DEVICE_ID=${JSON.stringify(deviceId)}`);
    } else {
        console.warn('AVISO: PROMPTX_DEVICE_ID não está definido no .env. Edite o .env e coloque o deviceId da máquina onde a licença PromptX foi ativada.');
    }
    if (jwtSecret) toSet.push(`JWT_SECRET=${JSON.stringify(jwtSecret)}`);

    if (toSet.length === 0) {
        console.error('Nada para atualizar. Defina PROMPTX_DEVICE_ID (e opcionalmente JWT_SECRET) no .env e rode de novo.');
        process.exit(1);
    }

    const cmd = `npx supabase secrets set ${toSet.join(' ')} --project-ref ${PROJECT_REF}`;
    console.log('Executando:', cmd.replace(/\b(JWT_SECRET|PROMPTX_DEVICE_ID)=[^ ]+/g, (m) => m.slice(0, m.indexOf('=')+1) + '***'));
    execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log('Secrets atualizados.');
}

main();
