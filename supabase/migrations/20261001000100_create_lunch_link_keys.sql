-- Slice 4-S3: daily HMAC signing keys for Lunch Link tokens.
-- Service-role only — no user-accessible RLS policy.

CREATE TABLE IF NOT EXISTS lunch_link_keys (
  key_date   date PRIMARY KEY,
  hmac_key   text NOT NULL,  -- 64 hex chars (32-byte random key)
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lunch_link_keys ENABLE ROW LEVEL SECURITY;
-- Intentionally no user policy: only the service-role client reads/writes this table.
