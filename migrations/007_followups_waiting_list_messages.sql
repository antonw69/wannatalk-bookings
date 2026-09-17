BEGIN;

CREATE TABLE IF NOT EXISTS follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ NOT NULL,
  internal_note TEXT,
  reminder_message TEXT,
  reminder_channels TEXT[] NOT NULL DEFAULT ARRAY['email']::TEXT[],
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  reminder_sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reminder_channels <@ ARRAY['email', 'sms']::TEXT[])
);

CREATE INDEX IF NOT EXISTS follow_ups_provider_due_idx ON follow_ups(provider_id, status, due_at);
CREATE INDEX IF NOT EXISTS follow_ups_patient_due_idx ON follow_ups(patient_id, due_at);

CREATE TABLE IF NOT EXISTS waiting_list_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  time_preference TEXT NOT NULL DEFAULT 'any' CHECK (time_preference IN ('any', 'morning', 'afternoon')),
  notification_channels TEXT[] NOT NULL DEFAULT ARRAY['email']::TEXT[],
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'fulfilled', 'expired')),
  notification_count INTEGER NOT NULL DEFAULT 0,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from),
  CHECK (notification_channels <@ ARRAY['email', 'sms']::TEXT[])
);

CREATE INDEX IF NOT EXISTS waiting_list_active_dates_idx ON waiting_list_entries(status, date_from, date_to);
CREATE INDEX IF NOT EXISTS waiting_list_provider_idx ON waiting_list_entries(provider_id, status);
CREATE INDEX IF NOT EXISTS waiting_list_patient_idx ON waiting_list_entries(patient_id, status);

CREATE TABLE IF NOT EXISTS communication_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  follow_up_id UUID REFERENCES follow_ups(id) ON DELETE SET NULL,
  waiting_list_entry_id UUID REFERENCES waiting_list_entries(id) ON DELETE SET NULL,
  sent_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient TEXT NOT NULL,
  subject TEXT,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communication_deliveries_patient_idx ON communication_deliveries(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS communication_deliveries_provider_idx ON communication_deliveries(provider_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE follow_ups TO anton;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE waiting_list_entries TO anton;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE communication_deliveries TO anton;

COMMIT;
