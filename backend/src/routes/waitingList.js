import { Router } from 'express';
import { query } from '../db.js';
import { cleanChannels, sendPatientCommunication } from '../communications.js';
import { authRequired } from '../middleware/authRequired.js';

export const waitingListRouter = Router();

async function patientForUser(userId) {
  const result = await query(`SELECT id FROM patients WHERE user_id = $1`, [userId]);
  return result.rows[0]?.id || null;
}

async function providerForUser(userId) {
  const result = await query(`SELECT id FROM providers WHERE user_id = $1`, [userId]);
  return result.rows[0]?.id || null;
}

waitingListRouter.get('/', authRequired(), async (req, res) => {
  const params = [];
  let where = '';
  if (req.user.role === 'patient') {
    params.push(req.user.id);
    where = `WHERE pat.user_id = $1`;
  } else if (req.user.role === 'provider') {
    params.push(req.user.id);
    where = `WHERE (pro.user_id = $1 OR w.provider_id IS NULL)`;
  }
  const result = await query(
    `SELECT w.*, pu.full_name AS patient_name, pru.full_name AS provider_name, l.name AS location_name
     FROM waiting_list_entries w
     JOIN patients pat ON pat.id = w.patient_id
     JOIN app_users pu ON pu.id = pat.user_id
     LEFT JOIN providers pro ON pro.id = w.provider_id
     LEFT JOIN app_users pru ON pru.id = pro.user_id
     LEFT JOIN locations l ON l.id = w.location_id
     ${where}
     ORDER BY CASE WHEN w.status = 'active' THEN 0 ELSE 1 END, w.date_from, w.created_at DESC`,
    params
  );
  res.json({ entries: result.rows });
});

waitingListRouter.post('/', authRequired(['patient', 'admin', 'provider']), async (req, res) => {
  let patientId = String(req.body.patientId || '');
  let providerId = req.body.providerId ? String(req.body.providerId) : null;
  const locationId = req.body.locationId ? String(req.body.locationId) : null;
  const dateFrom = String(req.body.dateFrom || '');
  const dateTo = String(req.body.dateTo || '');
  const timePreference = ['any', 'morning', 'afternoon'].includes(req.body.timePreference) ? req.body.timePreference : 'any';
  const channels = cleanChannels(req.body.channels);
  if (req.user.role === 'patient') patientId = await patientForUser(req.user.id);
  if (req.user.role === 'provider') providerId = await providerForUser(req.user.id);
  if (!patientId || !dateFrom || !dateTo || dateTo < dateFrom || !channels.length) return res.status(400).json({ error: 'Patient, valid date range, and notification channel are required' });
  const result = await query(
    `INSERT INTO waiting_list_entries
       (patient_id, provider_id, location_id, created_by_user_id, date_from, date_to, time_preference, notification_channels)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[]) RETURNING *`,
    [patientId, providerId, locationId, req.user.id, dateFrom, dateTo, timePreference, channels]
  );
  await query(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
     VALUES ($1,$2,$3,'Joined cancellation waiting list',$4::jsonb)`,
    [req.user.id, req.user.name, req.user.role, JSON.stringify({ waitingListEntryId: result.rows[0].id, patientId, providerId, dateFrom, dateTo })]
  );
  res.status(201).json({ entry: result.rows[0] });
});

waitingListRouter.patch('/:id/cancel', authRequired(['patient', 'admin']), async (req, res) => {
  const params = [req.params.id];
  let access = '';
  if (req.user.role === 'patient') {
    params.push(req.user.id);
    access = `AND EXISTS (SELECT 1 FROM patients p WHERE p.id = waiting_list_entries.patient_id AND p.user_id = $2)`;
  }
  const result = await query(`UPDATE waiting_list_entries SET status = 'cancelled', updated_at = now() WHERE id = $1 ${access} RETURNING *`, params);
  if (!result.rows[0]) return res.status(404).json({ error: 'Waiting-list request not found' });
  res.json({ entry: result.rows[0] });
});

waitingListRouter.get('/matches/:appointmentId', authRequired(['admin', 'provider']), async (req, res) => {
  const appointmentResult = await query(
    `SELECT a.*, l.name AS location_name FROM appointments a LEFT JOIN locations l ON l.id = a.location_id WHERE a.id = $1`,
    [req.params.appointmentId]
  );
  const appointment = appointmentResult.rows[0];
  if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
  if (req.user.role === 'provider') {
    const providerId = await providerForUser(req.user.id);
    if (providerId !== appointment.provider_id) return res.status(403).json({ error: 'Not allowed' });
  }
  const result = await query(
    `SELECT w.*, u.full_name AS patient_name
     FROM waiting_list_entries w
     JOIN patients pat ON pat.id = w.patient_id
     JOIN app_users u ON u.id = pat.user_id
     WHERE w.status = 'active'
       AND (w.provider_id IS NULL OR w.provider_id = $1)
       AND (w.location_id IS NULL OR w.location_id = $2)
       AND $3::date BETWEEN w.date_from AND w.date_to
       AND (w.time_preference = 'any'
            OR (w.time_preference = 'morning' AND $4::time < time '12:00')
            OR (w.time_preference = 'afternoon' AND $4::time >= time '12:00'))
     ORDER BY w.created_at`,
    [appointment.provider_id, appointment.location_id, appointment.appointment_date, appointment.appointment_time]
  );
  res.json({ appointment, matches: result.rows });
});

waitingListRouter.post('/:id/notify', authRequired(['admin', 'provider']), async (req, res) => {
  const appointmentId = String(req.body.appointmentId || '');
  if (!appointmentId) return res.status(400).json({ error: 'Choose a cancelled appointment opening' });
  const entryResult = await query(`SELECT * FROM waiting_list_entries WHERE id = $1 AND status = 'active'`, [req.params.id]);
  const entry = entryResult.rows[0];
  if (!entry) return res.status(404).json({ error: 'Active waiting-list request not found' });
  const appointmentResult = await query(
    `SELECT a.*, u.full_name AS provider_name, l.name AS location_name
     FROM appointments a JOIN providers p ON p.id = a.provider_id JOIN app_users u ON u.id = p.user_id
     LEFT JOIN locations l ON l.id = a.location_id WHERE a.id = $1`,
    [appointmentId]
  );
  const appointment = appointmentResult.rows[0];
  if (!appointment || !['Cancelled', 'No-show'].includes(appointment.status)) return res.status(400).json({ error: 'The selected appointment is not an available cancellation opening' });
  if (req.user.role === 'provider') {
    const providerId = await providerForUser(req.user.id);
    if (providerId !== appointment.provider_id) return res.status(403).json({ error: 'Not allowed' });
  }
  const date = new Date(`${String(appointment.appointment_date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  const message = `A WannaTalk cancellation appointment is available with ${appointment.provider_name} on ${date} at ${String(appointment.appointment_time).slice(0, 5)} (${appointment.location_name || appointment.mode}). Sign in to book it. Availability is not guaranteed.`;
  const delivery = await sendPatientCommunication({ patientId: entry.patient_id, providerId: appointment.provider_id, appointmentId: appointment.id, waitingListEntryId: entry.id, sentByUserId: req.user.id, channels: entry.notification_channels, subject: 'WannaTalk cancellation appointment available', message });
  if (delivery.deliveries.some((item) => item.status === 'sent')) await query(`UPDATE waiting_list_entries SET notification_count = notification_count + 1, last_notified_at = now(), updated_at = now() WHERE id = $1`, [entry.id]);
  await query(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, appointment_id, details)
     VALUES ($1,$2,$3,'Sent cancellation waiting-list alert',$4,$5::jsonb)`,
    [req.user.id, req.user.name, req.user.role, appointment.id, JSON.stringify({ waitingListEntryId: entry.id, deliveryStatuses: delivery.deliveries.map((item) => item.status) })]
  );
  res.json({ deliveries: delivery.deliveries });
});
