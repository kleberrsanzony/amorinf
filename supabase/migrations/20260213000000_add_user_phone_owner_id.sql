-- Campos para o painel admin (user_phone) e multi-tenant (owner_id)
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS user_phone TEXT DEFAULT '';
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS owner_id TEXT;
CREATE INDEX IF NOT EXISTS idx_licenses_owner ON licenses(owner_id);
