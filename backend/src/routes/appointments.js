import { Router } from 'express';
import crypto from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { authRequired } from '../middleware/authRequired.js';

export const appointmentsRouter = Router();

const activeStatuses = ['Booked', 'Confirmed', 'Arrived', 'Completed'];
const validStatuses = new Set(['Booked', 'Confirmed', 'Arrived', 'Completed', 'Cancelled', 'No-show']);

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function isPast(date, time) {
  return new Date(`${date}T${time}`) <= new Date();
}

function meetingBaseUrl() {
  return String(process.env.JITSI_BASE_URL || 'https://webrtc.wannatalk.co.za').replace(/\/+$/, '');
}

function isOnlineMode(value) {
  return String(value || '').trim().toLowerCase() === 'online';
}

function createMeetingUrl() {
  return `${meetingBaseUrl()}/wannatalk-${crypto.randomBytes(9).toString('hex')}`;
}

async function assertProviderAvailable(client, { providerId, appointmentDate, appointmentTime, durationMinutes, excludeAppointmentId = null }) {
  const duration = Number(durationMinutes);
  if (!Number.isInteger(duration) || duration < 15 || duration > 240) {
    const error = new Error('Invalid appointment duration');
    error.statusCode = 400;
    throw error;
  }

  const provider = await client.query(
    `SELECT p.id
     FROM providers p JOIN app_users u ON u.id = p.user_id
     WHERE p.id = $1 AND u.is_active = true
     FOR UPDATE OF p`,
    [providerId]
  );
  if (!provider.rows[0]) {
    const error = new Error('Provider not found or inactive');
    error.statusCode = 404;
    throw error;
  }

  const weeklyAvailability = await client.query(
    `SELECT 1 FROM provider_availability
     WHERE provider_id = $1
       AND day_of_week = EXTRACT(DOW FROM $2::date)::integer
       AND is_available = true
       AND start_time <= $3::time
       AND end_time >= ($3::time + ($4 * interval '1 minute'))::time`,
    [providerId, appointmentDate, appointmentTime, duration]
  );
  if (!weeklyAvailability.rows[0]) {
    const error = new Error('No availability for this provider at the selected time');
    error.statusCode = 409;
    throw error;
  }

  const blocked = await client.query(
    `SELECT id FROM provider_time_blocks
     WHERE provider_id = $1 AND block_date = $2
       AND start_time < ($3::time + ($4 * interval '1 minute'))::time
       AND end_time > $3::time
     LIMIT 1`,
    [providerId, appointmentDate, appointmentTime, duration]
  );
  if (blocked.rows[0]) {
    const error = new Error('The provider is unavailable during that time');
    error.statusCode = 409;
    throw error;
  }

  const params = [providerId, appointmentDate, appointmentTime, duration, activeStatuses];
  let exclusion = '';
  if (excludeAppointmentId) {
    params.push(excludeAppointmentId);
    exclusion = `AND id <> $6`;
  }
  const conflict = await client.query(
    `SELECT id FROM appointments
     WHERE provider_id = $1 AND appointment_date = $2
       AND appointment_time < ($3::time + ($4 * interval '1 minute'))::time
       AND (appointment_time + (duration_minutes * interval '1 minute'))::time > $3::time
       AND status = ANY($5::text[])
       ${exclusion}
     LIMIT 1`,
    params
  );
  if (conflict.rows[0]) {
    const error = new Error('That booking time is not available');
    error.statusCode = 409;
    throw error;
  }
}

async function audit(client, user, action, appointmentId, details = {}) {
  await client.query(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, appointment_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [user.id, user.name || user.email || user.role, user.role, action, appointmentId, JSON.stringify(details)]
  );
}

appointmentsRouter.get('/', authRequired(), asyncHandler(async (req, res) => {
  const params = [];
  const where = [];

  if (req.user.role === 'provider') {
    params.push(req.user.id);
    where.push(`pro.user_id = $${params.length}`);
  } else if (req.user.role === 'patient') {
    params.push(req.user.id);
    where.push(`pat.user_id = $${params.length}`);
  }

  if (req.query.providerId) {
    params.push(req.query.providerId);
    where.push(`a.provider_id = $${params.length}`);
  }
  if (req.query.patientId) {
    params.push(req.query.patientId);
    where.push(`a.patient_id = $${params.length}`);
  }
  if (req.query.from) {
    params.push(req.query.from);
    where.push(`a.appointment_date >= $${params.length}`);
  }
  if (req.query.to) {
    params.push(req.query.to);
    where.push(`a.appointment_date <= $${params.length}`);
  }

  const result = await query(
    `SELECT a.*, pu.full_name AS patient_name, pu.email AS patient_email, pu.mobile AS patient_mobile,
            pr.full_name AS provider_name, pr.email AS provider_email, pr.mobile AS provider_mobile,
            pro.professional_title, l.name AS location_name
     FROM appointments a
     JOIN patients pat ON pat.id = a.patient_id
     JOIN app_users pu ON pu.id = pat.user_id
     JOIN providers pro ON pro.id = a.provider_id
     JOIN app_users pr ON pr.id = pro.user_id
     LEFT JOIN locations l ON l.id = a.location_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.appointment_date, a.appointment_time`,
    params
  );
  res.json({ appointments: result.rows });
}));

appointmentsRouter.post('/', authRequired(['patient', 'admin']), asyncHandler(async (req, res) => {
  const { providerId, patientId, locationId, appointmentDate, appointmentTime, durationMinutes = 60, appointmentType, mode, note, intakeRequested = false } = req.body;

  let effectivePatientId = patientId;
  if (req.user.role === 'patient') {
    const patient = await query(`SELECT id FROM patients WHERE user_id = $1`, [req.user.id]);
    effectivePatientId = patient.rows[0]?.id;
  }

  if (!providerId || !effectivePatientId || !appointmentDate || !appointmentTime || !appointmentType || !mode) {
    return res.status(400).json({ error: 'Missing required booking details' });
  }
  if (isPast(appointmentDate, appointmentTime)) {
    return res.status(400).json({ error: 'Past dates and times cannot be booked' });
  }

  const appointment = await withTransaction(async (client) => {
    await assertProviderAvailable(client, { providerId, appointmentDate, appointmentTime, durationMinutes });
    const meetingUrl = isOnlineMode(mode) ? createMeetingUrl() : null;

    const inserted = await client.query(
      `INSERT INTO appointments (provider_id, patient_id, location_id, appointment_date, appointment_time, duration_minutes, appointment_type, mode, note, intake_requested, meeting_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [providerId, effectivePatientId, locationId || null, appointmentDate, appointmentTime, durationMinutes, appointmentType, mode, note || null, Boolean(intakeRequested), meetingUrl]
    );
    await audit(client, req.user, 'Created booking', inserted.rows[0].id, { appointmentDate, appointmentTime, mode, meetingUrl: Boolean(meetingUrl) });
    return inserted.rows[0];
  });

  res.status(201).json({ appointment });
}));

appointmentsRouter.patch('/:id/reschedule', authRequired(['admin', 'provider', 'patient']), asyncHandler(async (req, res) => {
  const { appointmentDate, appointmentTime } = req.body;
  if (!appointmentDate || !appointmentTime) return res.status(400).json({ error: 'New date and time are required' });
  if (isPast(appointmentDate, appointmentTime)) return res.status(400).json({ error: 'Past dates and times cannot be booked' });

  const appointment = await withTransaction(async (client) => {
    const access = req.user.role === 'admin'
      ? ''
      : req.user.role === 'provider'
        ? 'AND EXISTS (SELECT 1 FROM providers p WHERE p.id = appointments.provider_id AND p.user_id = $2)'
        : 'AND EXISTS (SELECT 1 FROM patients p WHERE p.id = appointments.patient_id AND p.user_id = $2)';
    const current = await client.query(
      `SELECT * FROM appointments WHERE id = $1 ${access} FOR UPDATE`,
      req.user.role === 'admin' ? [req.params.id] : [req.params.id, req.user.id]
    );
    if (!current.rows[0]) {
      const error = new Error('Appointment not found');
      error.statusCode = 404;
      throw error;
    }

    await assertProviderAvailable(client, {
      providerId: current.rows[0].provider_id,
      appointmentDate,
      appointmentTime,
      durationMinutes: current.rows[0].duration_minutes,
      excludeAppointmentId: req.params.id,
    });

    const updated = await client.query(
      `UPDATE appointments SET appointment_date = $1, appointment_time = $2, status = 'Booked', updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [appointmentDate, appointmentTime, req.params.id]
    );
    await audit(client, req.user, 'Rescheduled booking', req.params.id, { appointmentDate, appointmentTime });
    return updated.rows[0];
  });

  res.json({ appointment });
}));

appointmentsRouter.patch('/:id/status', authRequired(['admin', 'provider', 'patient']), asyncHandler(async (req, res) => {
  const status = String(req.body.status || '');
  if (!validStatuses.has(status)) return res.status(400).json({ error: 'Invalid status' });
  if (req.user.role === 'patient' && status !== 'Cancelled') return res.status(403).json({ error: 'Patients can only cancel their own appointments' });

  const params = [status, req.params.id];
  let access = '';
  if (req.user.role === 'provider') {
    params.push(req.user.id);
    access = `AND EXISTS (SELECT 1 FROM providers p WHERE p.id = appointments.provider_id AND p.user_id = $${params.length})`;
  } else if (req.user.role === 'patient') {
    params.push(req.user.id);
    access = `AND EXISTS (SELECT 1 FROM patients p WHERE p.id = appointments.patient_id AND p.user_id = $${params.length})`;
  }

  const result = await query(
    `UPDATE appointments SET status = $1, updated_at = now() WHERE id = $2 ${access} RETURNING *`,
    params
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Appointment not found' });
  await query(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, appointment_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [req.user.id, req.user.name || req.user.email || req.user.role, req.user.role, status === 'Cancelled' ? 'Cancelled booking' : 'Changed booking status', req.params.id, JSON.stringify({ status })]
  );
  res.json({ appointment: result.rows[0] });
}));

appointmentsRouter.delete('/:id', authRequired(['admin']), asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    await audit(client, req.user, 'Deleted booking', req.params.id);
    await client.query(`DELETE FROM appointments WHERE id = $1`, [req.params.id]);
  });
  res.status(204).send();
}));
