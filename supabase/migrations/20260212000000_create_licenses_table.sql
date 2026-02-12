-- Tabela de licenças (migração do Firebase RTDB)
CREATE TABLE IF NOT EXISTS licenses (
  key TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT true,
  lifetime BOOLEAN NOT NULL DEFAULT false,
  expiry_date TIMESTAMPTZ,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  user_name TEXT NOT NULL DEFAULT '',
  activated_device_fingerprint TEXT,
  activated_date TIMESTAMPTZ,
  last_access_date TIMESTAMPTZ,
  active_session_device TEXT,
  active_session_last_ping TIMESTAMPTZ,
  activated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para busca por device fingerprint
CREATE INDEX IF NOT EXISTS idx_licenses_device ON licenses(activated_device_fingerprint);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para updated_at
DROP TRIGGER IF EXISTS update_licenses_updated_at ON licenses;
CREATE TRIGGER update_licenses_updated_at
  BEFORE UPDATE ON licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Habilitar RLS (Row Level Security) mas sem políticas restritivas
-- As Edge Functions usam service_role que bypassa RLS
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
