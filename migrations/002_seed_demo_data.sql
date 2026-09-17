BEGIN;

INSERT INTO app_users (full_name, email, mobile, password_hash, role, preferred_contact)
VALUES
  ('Practice Admin', 'admin@wannatalk.co.za', NULL, NULL, 'admin', 'Email'),
  ('Louw Alberts', 'louw@wannatalk.co.za', '+27 82 555 0101', NULL, 'provider', 'WhatsApp'),
  ('Dr Naledi Mokoena', 'naledi@wannatalk.co.za', '+27 82 555 0102', NULL, 'provider', 'WhatsApp'),
  ('Sarah Jacobs', 'sarah@test.co.za', '+27 82 123 4567', NULL, 'patient', 'WhatsApp')
ON CONFLICT (email) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  mobile = EXCLUDED.mobile,
  role = EXCLUDED.role,
  preferred_contact = EXCLUDED.preferred_contact,
  updated_at = now();

INSERT INTO providers (user_id, professional_title, default_duration_minutes, bio, is_online)
SELECT id, 'Counsellor', 60, 'Individual, couples and family counselling.', TRUE
FROM app_users
WHERE email = 'louw@wannatalk.co.za'
ON CONFLICT (user_id) DO UPDATE SET
  professional_title = EXCLUDED.professional_title,
  default_duration_minutes = EXCLUDED.default_duration_minutes,
  bio = EXCLUDED.bio,
  updated_at = now();

INSERT INTO providers (user_id, professional_title, default_duration_minutes, bio, is_online)
SELECT id, 'Psychologist', 60, 'Psychological assessment and individual therapy.', TRUE
FROM app_users
WHERE email = 'naledi@wannatalk.co.za'
ON CONFLICT (user_id) DO UPDATE SET
  professional_title = EXCLUDED.professional_title,
  default_duration_minutes = EXCLUDED.default_duration_minutes,
  bio = EXCLUDED.bio,
  updated_at = now();

INSERT INTO patients (user_id)
SELECT id
FROM app_users
WHERE email = 'sarah@test.co.za'
ON CONFLICT (user_id) DO UPDATE SET updated_at = now();

INSERT INTO provider_locations (provider_id, location_id)
SELECT p.id, l.id
FROM providers p
JOIN app_users u ON u.id = p.user_id
JOIN locations l ON l.name IN ('Centurion', 'Online')
WHERE u.email = 'louw@wannatalk.co.za'
ON CONFLICT DO NOTHING;

INSERT INTO provider_locations (provider_id, location_id)
SELECT p.id, l.id
FROM providers p
JOIN app_users u ON u.id = p.user_id
JOIN locations l ON l.name IN ('Emalahleni', 'Online')
WHERE u.email = 'naledi@wannatalk.co.za'
ON CONFLICT DO NOTHING;

INSERT INTO provider_availability (provider_id, day_of_week, is_available, start_time, end_time)
SELECT p.id, day_number, TRUE, TIME '09:00', TIME '17:00'
FROM providers p
JOIN app_users u ON u.id = p.user_id
CROSS JOIN generate_series(1, 5) AS day_number
WHERE u.email IN ('louw@wannatalk.co.za', 'naledi@wannatalk.co.za')
ON CONFLICT (provider_id, day_of_week) DO UPDATE SET
  is_available = EXCLUDED.is_available,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  updated_at = now();

INSERT INTO audit_logs (user_name, user_role, action, location_name, details)
VALUES ('System', 'system', 'Seeded demo data', 'Database', '{"source":"002_seed_demo_data.sql"}'::jsonb);

COMMIT;
