/**
 * CLI: Reset do Auth (remove todos os usuários), opcionalmente limpa licenças,
 * e recadastra o usuário master do painel.
 *
 * Uso (na raiz do projeto):
 *   node scripts/reset-and-create-master.js
 *
 * Variáveis de ambiente obrigatórias:
 *   SUPABASE_URL=https://svjglgrxqxqtonoobcdi.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<sua service_role key>
 *
 * Opcional: criar arquivo .env na raiz com essas variáveis.
 */

const { createClient } = require('@supabase/supabase-js');

const MASTER_EMAIL = 'luan93dutra@gmail.com';
const MASTER_PASSWORD = '210293';

async function main() {
    try {
        require('dotenv').config();
    } catch (e) {
        // dotenv opcional
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.error('ERRO: Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente ou em .env');
        process.exit(1);
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });

    console.log('1. Listando usuários do Auth...');
    const allUsers = [];
    let page = 1;
    const perPage = 1000;
    while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) {
            console.error('Erro ao listar usuários:', error.message);
            process.exit(1);
        }
        const users = data.users || [];
        if (users.length === 0) break;
        allUsers.push(...users);
        if (users.length < perPage) break;
        page++;
    }

    console.log('   Encontrados:', allUsers.length, 'usuário(s)');

    if (allUsers.length > 0) {
        console.log('2. Removendo todos os usuários do Auth...');
        for (const u of allUsers) {
            const { error } = await supabase.auth.admin.deleteUser(u.id);
            if (error) console.error('   Aviso ao remover', u.email, ':', error.message);
            else console.log('   Removido:', u.email);
        }
    }

    console.log('3. Limpando tabela de licenças...');
    let deleted = 0;
    while (true) {
        const { data: rows } = await supabase.from('licenses').select('key').limit(500);
        if (!rows || rows.length === 0) break;
        const keys = rows.map((r) => r.key);
        const { error } = await supabase.from('licenses').delete().in('key', keys);
        if (error) {
            console.log('   Aviso:', error.message);
            break;
        }
        deleted += keys.length;
    }
    console.log('   Licenças removidas:', deleted);

    console.log('4. Criando usuário master:', MASTER_EMAIL);
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: MASTER_EMAIL,
        password: MASTER_PASSWORD,
        email_confirm: true,
        user_metadata: {
            display_name: 'Luan Dutra',
            email_verified: true
        }
    });

    if (createError) {
        console.error('Erro ao criar master:', createError.message);
        process.exit(1);
    }

    console.log('   Master criado. UID:', newUser.user.id);
    console.log('');
    console.log('Pronto. Faça login no painel com:');
    console.log('   E-mail:', MASTER_EMAIL);
    console.log('   Senha: ', MASTER_PASSWORD);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
