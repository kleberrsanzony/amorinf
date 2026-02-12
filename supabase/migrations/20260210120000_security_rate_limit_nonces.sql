-- Tabela para rate limit (20 req/min por licença)
CREATE TABLE IF NOT EXISTS rate_limit_log (
  id BIGSERIAL PRIMARY KEY,
  license_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_license_created ON rate_limit_log(license_key, created_at);

-- Tabela para anti-replay (nonces usados)
CREATE TABLE IF NOT EXISTS used_nonces (
  nonce TEXT PRIMARY KEY,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para limpeza de nonces antigos (opcional, para DELETE ... WHERE used_at < ...)
CREATE INDEX IF NOT EXISTS idx_used_nonces_used_at ON used_nonces(used_at);
