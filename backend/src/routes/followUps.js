import { Router } from 'express';
import { query } from '../db.js';
import { cleanChannels, sendPatientCommunication } from '../communications.js';
import { authRequired } from '../middleware/authRequired.js';

export const followUpsRouter = Router();

async function ownProviderId(userId) {
  const result = await query(`SELECT id FROM providers WHERE user_id = $1`, [userId]);
  return result.rows[0]?.id || null;
}

async function providerOwnsPatient(providerId, patientId) {
  const result = await query(`SELECT 1 FROM appointments WHERE provider_id = $1 AND patient_id = $2 LIMIT 1`, [providerId, patientId]);
  return Boolean(result.rows[0]);
}

followUpsRouter.get('/', authRequired(['admin', 'provider']), async (req, res) => {
  const params = [];
  let where = '';
  if (req.user.role === 'provider') {
    params.push(req.user.id);
    where = `WHERE pro.user_id = $1`;
  }
  const result = await query(
    `SELECT f.*, pu.full_name AS patient_name, pu.email AS patient_email, pu.mobile AS patient_mobile,
            pru.full_name AS provider_name
     FROM follow_ups f
     JOIN patients pat ON pat.id = f.patient_id
     JOIN app_users pu ON pu.id = pat.user_id
     JOIN providers pro ON pro.id = f.provider_id
     JOIN app_users pru ON pru.id = pro.user_id
     ${where}
     ORDER BY CASE WHEN f.status = 'open' THEN 0 ELSE 1 END, f.due_at, f.created_at DESC`,
    params
  );
  res.json({ followUps: result.rows });
});

followUpsRouter.post('/', authRequired(['admin', 'provider']), async (req, res) => {
  const patientId = String(req.body.patientId || '');
  let providerId = String(req.body.providerId || '');
  const dueAt = new Date(req.body.dueAt);
  const internalNote = String(req.body.internalNote || '').trim().slice(0, 2000);
  const reminderMessage = String(req.body.reminderMessage || '').trim().slice(0, 1000);
  const reminderChannels = cleanChannels(req.body.reminderChannels);
  if (req.user.role === 'provider') {
    providerId = await ownProviderId(req.user.id);
    if (!providerId || !(await providerOwnsPatient(providerId, patientId))) return res.status(403).json({ error: 'You may only create follow-ups for your own patients' });
  }
  if (!patientId || !providerId || Number.isNaN(dueAt.getTime())) return res.status(400).json({ error: 'Patient, provider, follow-up date, and time are required' });
  const result = await query(
    `INSERT INTO follow_ups (patient_id, provider_id, created_by_user_id, due_at, internal_note, reminder_message, reminder_channels)
     VALUES ($1,$2,$3,$4,$5,$6,$7::text[])
     RETURNING *`,
    [patientId, providerId, req.user.id, dueAt.toISOString(), internalNote || null, reminderMessage || null, reminderChannels]
  );
  await query(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
     VALUES ($1,$2,$3,'Created follow-up',$4::jsonb)`,
    [req.user.id, req.user.name, req.user.role, JSON.stringify({ followUpId: result.rows[0].id, patientId, providerId, dueAt: dueAt.toISOString() })]
  );
  res.status(201).json({ followUp: result.rows[0] });
});

followUpsRouter.patch('/:id/status', authRequired(['admin', 'provider']), async (req, res) => {
  const status = String(req.body.status || '');
  if (!['open', 'completed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid follow-up status' });
  const params = [status, req.params.id];
  let access = '';
  if (req.user.role === 'provider') {
    params.push(req.user.id);
    access = `AND EXISTS (SELECT 1 FROM providers p WHERE p.id = follow_ups.provider_id AND p.user_id = $3)`;
  }
  const result = await query(
    `UPDATE follow_ups SET status = $1, completed_at = CASE WHEN $1 = 'completed' THEN now() ELSE NULL END, updated_at = now()
     WHERE id = $2 ${access} RETURNING *`,
    params
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Follow-up not found' });
  res.json({ followUp: result.rows[0] });
});

followUpsRouter.post('/:id/send', authRequired(['admin', 'provider']), async (req, res) => {
  const params = [req.params.id];
  let access = '';
  if (req.user.role === 'provider') {
    params.push(req.user.id);
    access = `AND pro.user_id = $2`;
  }
  const followUpResult = await query(
    `SELECT f.*, pu.full_name AS patient_name
     FROM follow_ups f
     JOIN providers pro ON pro.id = f.provider_id
     JOIN patients pat ON pat.id = f.patient_id
     JOIN app_users pu ON pu.id = pat.user_id
     WHERE f.id = $1 ${access}`,
    params
  );
  const followUp = followUpResult.rows[0];
  if (!followUp) return res.status(404).json({ error: 'Follow-up not found' });
  const channels = cleanChannels(req.body.channels?.length ? req.body.channels : followUp.reminder_channels);
  const message = String(req.body.message || followUp.reminder_message || 'WannaTalk reminder: please contact us to arrange your recommended follow-up session.').trim().slice(0, 1000);
  const delivery = await sendPatientCommunication({ patientId: followUp.patient_id, providerId: followUp.provider_id, followUpId: followUp.id, sentByUserId: req.user.id, channels, subject: 'WannaTalk follow-up reminder', message });
  if (delivery.deliveries.some((item) => item.status === 'sent')) await query(`UPDATE follow_ups SET reminder_sent_at = now(), updated_at = now() WHERE id = $1`, [followUp.id]);
  await query(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
     VALUES ($1,$2,$3,'Sent follow-up reminder',$4::jsonb)`,
    [req.user.id, req.user.name, req.user.role, JSON.stringify({ followUpId: followUp.id, channels, deliveryStatuses: delivery.deliveries.map((item) => item.status) })]
  );
  res.json({ deliveries: delivery.deliveries });
});
