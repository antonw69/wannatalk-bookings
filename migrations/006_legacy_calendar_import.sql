BEGIN;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_patient_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS patients_external_reference_unique
  ON patients (external_source, external_patient_ref)
  WHERE external_source IS NOT NULL AND external_patient_ref IS NOT NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_appointment_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_external_reference_unique
  ON appointments (external_source, external_appointment_ref)
  WHERE external_source IS NOT NULL AND external_appointment_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS provider_time_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  block_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  reason TEXT NOT NULL DEFAULT 'Unavailable',
  external_source TEXT,
  external_block_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_time_blocks_slot_unique
  ON provider_time_blocks (provider_id, block_date, start_time, end_time);

CREATE UNIQUE INDEX IF NOT EXISTS provider_time_blocks_external_reference_unique
  ON provider_time_blocks (external_source, external_block_ref)
  WHERE external_source IS NOT NULL AND external_block_ref IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE provider_time_blocks TO anton;

COMMIT;
