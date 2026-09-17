import { Router } from 'express';
import { query } from '../db.js';
import { cleanChannels, sendPatientCommunication } from '../communications.js';
import { authRequired } from '../middleware/authRequired.js';

export const communicationsRouter = Router();

async function providerForUser(userId) {
  const result = await query(`SELECT id FROM providers WHERE user_id = $1`, [userId]);
  return result.rows[0]?.id || null;
}

async function providerMayContactPatient(providerId, patientId) {
  const result = await query(`SELECT 1 FROM appointments WHERE provider_id = $1 AND patient_id = $2 LIMIT 1`, [providerId, patientId]);
  return Boolean(result.rows[0]);
}

communicationsRouter.get('/', authRequired(['admin', 'provider']), async (req, res) => {
  const params = [];
  let where = '';
  if (req.user.role === 'provider') {
    params.push(req.user.id);
    where = `WHERE EXISTS (SELECT 1 FROM providers p WHERE p.id = d.provider_id AND p.user_id = $1)`;
  }
  const result = await query(
    `SELECT d.id, d.patient_id, d.provider_id, d.channel, d.recipient, d.subject, d.message_text,
            d.status, d.error_message, d.sent_at, d.created_at, pu.full_name AS patient_name,
            pru.full_name AS provider_name
     FROM communication_deliveries d
     JOIN patients pat ON pat.id = d.patient_id
     JOIN app_users pu ON pu.id = pat.user_id
     LEFT JOIN providers pro ON pro.id = d.provider_id
     LEFT JOIN app_users pru ON pru.id = pro.user_id
     ${where}
     ORDER BY d.created_at DESC LIMIT 250`,
    params
  );
  res.json({ deliveries: result.rows });
});

communicationsRouter.post('/send', authRequired(['admin', 'provider']), async (req, res) => {
  const patientId = String(req.body.patientId || '');
  let providerId = req.body.providerId ? String(req.body.providerId) : null;
  const channels = cleanChannels(req.body.channels);
  const subject = String(req.body.subject || 'Message from WannaTalk').trim().slice(0, 160);
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (!patientId || !message || !channels.length) return res.status(400).json({ error: 'Patient, message, and delivery channel are required' });
  if (req.user.role === 'provider') {
    providerId = await providerForUser(req.user.id);
    if (!providerId || !(await providerMayContactPatient(providerId, patientId))) return res.status(403).json({ error: 'You may only contact your own patients' });
  }
  const result = await sendPatientCommunication({ patientId, providerId, sentByUserId: req.user.id, channels, subject, message });
  await query(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
     VALUES ($1,$2,$3,'Sent patient communication',$4::jsonb)`,
    [req.user.id, req.user.name, req.user.role, JSON.stringify({ patientId, providerId, channels, deliveryStatuses: result.deliveries.map((item) => item.status) })]
  );
  res.status(201).json({ deliveries: result.deliveries });
});
