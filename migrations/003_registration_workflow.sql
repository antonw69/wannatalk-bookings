BEGIN;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'approved';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_users_registration_status_check'
  ) THEN
    ALTER TABLE app_users
      ADD CONSTRAINT app_users_registration_status_check
      CHECK (registration_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

UPDATE app_users
SET registration_status = 'approved'
WHERE registration_status IS NULL;

CREATE INDEX IF NOT EXISTS app_users_registration_status_idx
  ON app_users (registration_status, created_at DESC);

COMMIT;
