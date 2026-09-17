BEGIN;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS meeting_url TEXT;

CREATE INDEX IF NOT EXISTS appointments_meeting_url_idx
  ON appointments(meeting_url)
  WHERE meeting_url IS NOT NULL;

UPDATE appointments
SET meeting_url = 'https://webrtc.wannatalk.co.za/wannatalk-' || replace(gen_random_uuid()::text, '-', '')
WHERE lower(mode) = 'online'
  AND meeting_url IS NULL;

COMMIT;
