-- Proxy Funil: session_cache e usage_logs (licenses já existe)
CREATE TABLE IF NOT EXISTS session_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  license_key TEXT NOT NULL,
  session_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_valid BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_session_cache_license ON session_cache(license_key, is_valid);

CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_license TEXT NOT NULL,
  project_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'success',
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_logs_client ON usage_logs(client_license, created_at);

ALTER TABLE session_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
