/**
 * Lista e, opcionalmente, remove licenças por owner_id (ex.: ex-sócios).
 * Uso: FORMER_OWNER_IDS=uid1,uid2 node scripts/remove-licenses-by-owner.js [--delete]
 * Requer .env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const idsEnv = process.env.FORMER_OWNER_IDS || '';
const ownerIds = idsEnv.split(',').map(s => s.trim()).filter(Boolean);
const shouldDelete = process.argv.includes('--delete');

if (ownerIds.length === 0) {
    console.log('Uso: FORMER_OWNER_IDS=uid1,uid2 node scripts/remove-licenses-by-owner.js [--delete]');
    console.log('  Sem --delete: apenas lista as licenças.');
    console.log('  Com --delete: remove as licenças cujo owner_id está em FORMER_OWNER_IDS.');
    process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

async function main() {
    const { data: rows, error } = await supabase
        .from('licenses')
        .select('key, user_name, owner_id, active, created_at')
        .in('owner_id', ownerIds);

    if (error) {
        console.error('Erro ao listar licenças:', error.message);
        process.exit(1);
    }

    const list = rows || [];
    console.log('Owner IDs:', ownerIds.join(', '));
    console.log('Licenças encontradas:', list.length);
    if (list.length === 0) {
        console.log('Nada a fazer.');
        return;
    }
    list.forEach(l => {
        console.log('  -', l.key, '|', l.user_name || '-', '| owner:', l.owner_id);
    });

    if (!shouldDelete) {
        console.log('\nPara remover estas licenças, rode com --delete:');
        console.log('FORMER_OWNER_IDS=' + ownerIds.join(',') + ' node scripts/remove-licenses-by-owner.js --delete');
        return;
    }

    const keys = list.map(l => l.key);
    const { error: delError } = await supabase.from('licenses').delete().in('key', keys);
    if (delError) {
        console.error('Erro ao deletar:', delError.message);
        process.exit(1);
    }
    console.log('\nRemovidas', keys.length, 'licenças.');
}

main();
