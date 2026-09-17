import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired } from '../middleware/authRequired.js';

export const patientsRouter = Router();

patientsRouter.get('/', authRequired(), async (req, res) => {
  const params = [];
  let where = '';

  if (req.user.role === 'patient') {
    params.push(req.user.id);
    where = 'WHERE u.id = $1';
  } else if (req.user.role === 'provider') {
    params.push(req.user.id);
    where = `WHERE EXISTS (
      SELECT 1 FROM appointments a
      JOIN providers pro ON pro.id = a.provider_id
      WHERE a.patient_id = pat.id AND pro.user_id = $1
    )`;
  }

  const result = await query(
    `SELECT pat.id, u.full_name, u.email, u.mobile, u.preferred_contact, u.is_active
     FROM patients pat
     JOIN app_users u ON u.id = pat.user_id
     ${where}
     ORDER BY u.full_name`,
    params
  );
  res.json({ patients: result.rows });
});

patientsRouter.patch('/me', authRequired(['patient']), async (req, res) => {
  const fullName = String(req.body.fullName || '').trim().slice(0, 100);
  const mobile = String(req.body.mobile || '').trim().slice(0, 30);
  const preferredContact = String(req.body.preferredContact || 'Email').trim();
  if (!fullName) return res.status(400).json({ error: 'Full name is required' });
  if (!['Email', 'SMS', 'Both'].includes(preferredContact)) return res.status(400).json({ error: 'Invalid preferred contact method' });
  const patient = await withTransaction(async (client) => {
    const currentResult = await client.query(
      `SELECT pat.id, u.id AS user_id, u.mobile
       FROM patients pat JOIN app_users u ON u.id = pat.user_id
       WHERE u.id = $1 FOR UPDATE`,
      [req.user.id]
    );
    const current = currentResult.rows[0];
    if (!current) return null;
    const mobileChanged = String(current.mobile || '') !== mobile;
    const updated = await client.query(
      `UPDATE app_users
       SET full_name = $1, mobile = $2, preferred_contact = $3,
           mobile_verified_at = CASE WHEN COALESCE(mobile, '') <> $2 THEN NULL ELSE mobile_verified_at END,
           updated_at = now()
       WHERE id = $4
       RETURNING full_name, email, mobile, preferred_contact`,
      [fullName, mobile, preferredContact, current.user_id]
    );
    if (mobileChanged) await client.query(`UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [current.user_id]);
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
       VALUES ($1,$2,$3,'Updated own patient profile',$4::jsonb)`,
      [req.user.id, fullName, req.user.role, JSON.stringify({ patientId: current.id, mobileChanged })]
    );
    return { id: current.id, ...updated.rows[0] };
  });
  if (!patient) return res.status(404).json({ error: 'Patient profile not found' });
  res.json({ patient });
});

patientsRouter.patch('/:id', authRequired(['admin']), async (req, res) => {
  const fullName = String(req.body.fullName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const mobile = String(req.body.mobile || '').trim();
  const preferredContact = String(req.body.preferredContact || 'Email').trim();
  if (!fullName || !email || !email.includes('@')) return res.status(400).json({ error: 'A valid name and email are required' });
  if (!['Email', 'SMS', 'Both'].includes(preferredContact)) return res.status(400).json({ error: 'Invalid preferred contact method' });

  const patient = await withTransaction(async (client) => {
    const currentResult = await client.query(
      `SELECT pat.id, pat.user_id, u.full_name, u.email, u.mobile, u.preferred_contact
       FROM patients pat
       JOIN app_users u ON u.id = pat.user_id
       WHERE pat.id = $1
       FOR UPDATE`,
      [req.params.id]
    );
    const current = currentResult.rows[0];
    if (!current) return null;

    const duplicate = await client.query(
      `SELECT id FROM app_users WHERE lower(email) = lower($1) AND id <> $2`,
      [email, current.user_id]
    );
    if (duplicate.rows[0]) {
      const error = new Error('That email address is already registered');
      error.statusCode = 409;
      throw error;
    }

    const contactChanged = current.email.toLowerCase() !== email || String(current.mobile || '') !== mobile;
    const updatedResult = await client.query(
      `UPDATE app_users
       SET full_name = $1, email = $2, mobile = $3, preferred_contact = $4,
           email_verified_at = CASE WHEN lower(email) <> lower($2) THEN NULL ELSE email_verified_at END,
           mobile_verified_at = CASE WHEN COALESCE(mobile, '') <> $3 THEN NULL ELSE mobile_verified_at END,
           auth_version = auth_version + CASE WHEN $6 THEN 1 ELSE 0 END,
           updated_at = now()
       WHERE id = $5
       RETURNING full_name, email, mobile, preferred_contact, is_active`,
      [fullName, email, mobile || '', preferredContact, current.user_id, contactChanged]
    );
    if (contactChanged) {
      await client.query(`UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [current.user_id]);
      await client.query(`UPDATE auth_otp_challenges SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`, [current.user_id]);
    }
    await client.query(
      `UPDATE patients SET updated_at = now() WHERE id = $1`,
      [current.id]
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
       VALUES ($1, $2, $3, 'Updated patient', $4::jsonb)`,
      [req.user.id, req.user.name || req.user.email || 'Administrator', req.user.role,
        JSON.stringify({ patientId: current.id, email, previousEmail: current.email })]
    );

    return { id: current.id, ...updatedResult.rows[0] };
  });

  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  res.json({ patient });
});

patientsRouter.patch('/:id/deactivate', authRequired(['admin']), async (req, res) => {
  const patient = await setPatientActive(req, false);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  res.json({ patient });
});

patientsRouter.patch('/:id/reactivate', authRequired(['admin']), async (req, res) => {
  const patient = await setPatientActive(req, true);
  if (!patient) return res.status(404).json({ error: 'Approved patient not found' });
  res.json({ patient });
});

async function setPatientActive(req, active) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT pat.id, pat.user_id, u.full_name, u.email
       FROM patients pat
       JOIN app_users u ON u.id = pat.user_id
       WHERE pat.id = $1 AND u.registration_status = 'approved'
       FOR UPDATE`,
      [req.params.id]
    );
    const account = result.rows[0];
    if (!account) return null;

    await client.query(
      `UPDATE app_users
       SET is_active = $1, auth_version = auth_version + 1, updated_at = now()
       WHERE id = $2`,
      [active, account.user_id]
    );
    if (!active) {
      await client.query(`UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [account.user_id]);
      await client.query(`UPDATE auth_otp_challenges SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`, [account.user_id]);
    }
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [req.user.id, req.user.name || req.user.email || 'Administrator', req.user.role,
        active ? 'Reactivated patient' : 'Deactivated patient',
        JSON.stringify({ patientId: account.id, patientUserId: account.user_id, email: account.email })]
    );

    return { id: account.id, fullName: account.full_name, email: account.email, isActive: active };
  });
}
