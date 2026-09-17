import 'dotenv/config';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pool, withTransaction } from '../src/db.js';

const manifestPath = process.argv[2];
const commit = process.argv.includes('--commit');
if (!manifestPath) {
  console.error('Usage: node scripts/import-legacy-appointments.js <manifest.json> [--commit]');
  process.exit(1);
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const source = 'legacy-practice-calendar';
const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 18);
const timeMinutes = (value) => Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5));
const providerTokens = (name) => normalise(name).split(' ').filter((token) => token.length > 2 && !['mrs', 'mnr', 'doctor'].includes(token));

const duplicateSlots = new Set();
const slotCounts = new Map();
for (const item of manifest.appointments) {
  const key = `${item.provider}|${item.date}|${item.startTime}`;
  slotCounts.set(key, (slotCounts.get(key) || 0) + 1);
}
for (const [key, count] of slotCounts) if (count > 1) duplicateSlots.add(key);

const result = await withTransaction(async (client) => {
  const providerResult = await client.query(
    `SELECT p.id, u.full_name, u.email,
            COALESCE(json_agg(json_build_object('id', l.id, 'name', l.name)) FILTER (WHERE l.id IS NOT NULL), '[]') AS locations
     FROM providers p
     JOIN app_users u ON u.id = p.user_id
     LEFT JOIN provider_locations pl ON pl.provider_id = p.id
     LEFT JOIN locations l ON l.id = pl.location_id
     GROUP BY p.id, u.full_name, u.email`
  );
  const providers = providerResult.rows;
  const providerMap = new Map();
  for (const sourceName of new Set([...manifest.appointments, ...manifest.blocks].map((item) => item.provider))) {
    const tokens = providerTokens(sourceName);
    const ranked = providers.map((provider) => ({ provider, score: tokens.filter((token) => normalise(provider.full_name).includes(token)).length })).sort((left, right) => right.score - left.score);
    if (!ranked[0] || ranked[0].score < 1 || ranked[0].score === ranked[1]?.score) throw new Error(`Could not uniquely match provider: ${sourceName}`);
    providerMap.set(sourceName, ranked[0].provider);
  }

  const duplicateRecordsSkipped = manifest.appointments.filter((item) => duplicateSlots.has(`${item.provider}|${item.date}|${item.startTime}`)).length;
  const report = { mode: commit ? 'commit' : 'dry-run', providers: Object.fromEntries([...providerMap].map(([key, value]) => [key, value.full_name])), appointmentsFound: manifest.appointments.length, blocksFound: manifest.blocks.length, appointmentsImported: 0, blocksImported: 0, patientsCreated: 0, duplicateRecordsSkipped, existingOrConflictingSkipped: 0 };
  if (!commit) return report;

  for (const item of manifest.appointments) {
    const slotKey = `${item.provider}|${item.date}|${item.startTime}`;
    if (duplicateSlots.has(slotKey)) continue;
    const provider = providerMap.get(item.provider);
    let patientResult = await client.query(`SELECT id FROM patients WHERE external_source = $1 AND external_patient_ref = $2`, [source, item.personNumber]);
    let patientId = patientResult.rows[0]?.id;
    if (!patientId) {
      const userResult = await client.query(
        `INSERT INTO app_users (full_name, email, role, preferred_contact, is_active, registration_status)
         VALUES ($1, $2, 'patient', 'Email', false, 'approved')
         RETURNING id`,
        [item.patient, `legacy.${hash(item.personNumber)}@import.invalid`]
      );
      patientResult = await client.query(
        `INSERT INTO patients (user_id, external_source, external_patient_ref) VALUES ($1, $2, $3) RETURNING id`,
        [userResult.rows[0].id, source, item.personNumber]
      );
      patientId = patientResult.rows[0].id;
      report.patientsCreated += 1;
    }
    const online = item.mode === 'Online';
    const locations = Array.isArray(provider.locations) ? provider.locations : [];
    const location = locations.find((entry) => online ? entry.name === 'Online' : entry.name !== 'Online') || null;
    const duration = Math.max(15, timeMinutes(item.endTime) - timeMinutes(item.startTime));
    const inserted = await client.query(
      `INSERT INTO appointments (provider_id, patient_id, location_id, appointment_date, appointment_time, duration_minutes,
                                 appointment_type, mode, status, payment_status, note, external_source, external_appointment_ref)
       VALUES ($1,$2,$3,$4,$5,$6,'Imported appointment',$7,$8,$9,'Imported from previous calendar',$10,$11)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [provider.id, patientId, location?.id || null, item.date, item.startTime, duration, item.mode, item.status, item.paymentStatus, source, item.reference]
    );
    if (inserted.rowCount) report.appointmentsImported += 1;
    else report.existingOrConflictingSkipped += 1;
  }

  for (const item of manifest.blocks) {
    const provider = providerMap.get(item.provider);
    const inserted = await client.query(
      `INSERT INTO provider_time_blocks (provider_id, block_date, start_time, end_time, reason, external_source, external_block_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING RETURNING id`,
      [provider.id, item.date, item.startTime, item.endTime, item.reason, source, item.reference]
    );
    if (inserted.rowCount) report.blocksImported += 1;
  }
  await client.query(
    `INSERT INTO audit_logs (user_name, user_role, action, details)
     VALUES ('Legacy calendar import', 'system', 'Imported provider calendars', $1::jsonb)`,
    [JSON.stringify(report)]
  );
  return report;
});

console.log(JSON.stringify(result, null, 2));
await pool.end();
