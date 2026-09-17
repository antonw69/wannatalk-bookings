BEGIN;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mobile_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_verification_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS auth_otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'registration')),
  delivery_method TEXT CHECK (delivery_method IN ('email', 'sms')),
  destination_masked TEXT,
  code_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_ip TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_otp_challenges_user_idx
  ON auth_otp_challenges (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_otp_challenges_active_idx
  ON auth_otp_challenges (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  user_agent TEXT,
  last_ip TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trusted_devices_user_idx
  ON trusted_devices (user_id, expires_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_otp_challenges TO anton;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE trusted_devices TO anton;

COMMIT;
