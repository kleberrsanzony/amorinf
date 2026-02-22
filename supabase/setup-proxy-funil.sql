-- ============================================
-- SETUP: Tabelas para o Proxy Funil
-- Execute no Supabase Dashboard → SQL Editor
--
-- NOTA: A tabela `licenses` JÁ EXISTE (criada pelo painel admin Vercel)
-- Aqui criamos SOMENTE as tabelas novas necessárias.
-- ============================================

-- Tabela: session_cache (NOVA)
-- Cache do sessionToken do PromptX (1 sessão ativa por vez)
CREATE TABLE IF NOT EXISTS session_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  license_key TEXT NOT NULL,
  session_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_valid BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_session_cache_license 
  ON session_cache(license_key, is_valid);

-- Tabela: usage_logs (NOVA)
-- Log de todas as requisições do proxy (auditoria e controle)
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_license TEXT NOT NULL,
  project_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'success',
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_client 
  ON usage_logs(client_license, created_at);

-- RLS: Somente service_role (Edge Functions) acessa
ALTER TABLE session_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy pública = apenas service_role acessa
-- (Edge Functions usam SUPABASE_SERVICE_ROLE_KEY automaticamente)

-- ============================================
-- VERIFICAÇÃO: Execute após criar as tabelas
-- ============================================
-- SELECT * FROM session_cache LIMIT 1;
-- SELECT * FROM usage_logs LIMIT 1;
-- SELECT count(*) FROM licenses;  -- deve retornar suas licenças existentes
