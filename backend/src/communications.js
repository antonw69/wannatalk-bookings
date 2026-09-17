import { query } from './db.js';
import { sendCommunicationEmail } from './mail.js';
import { sendSms } from './sms.js';

export function cleanChannels(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).toLowerCase()).filter((item) => ['email', 'sms'].includes(item)))];
}

export async function sendPatientCommunication({
  patientId,
  providerId = null,
  appointmentId = null,
  followUpId = null,
  waitingListEntryId = null,
  sentByUserId,
  channels,
  subject,
  message,
}) {
  const selectedChannels = cleanChannels(channels);
  if (!selectedChannels.length) {
    const error = new Error('Choose Email, SMS, or both');
    error.statusCode = 400;
    throw error;
  }
  const patientResult = await query(
    `SELECT pat.id, u.full_name, u.email, u.mobile
     FROM patients pat JOIN app_users u ON u.id = pat.user_id
     WHERE pat.id = $1 AND u.is_active = true`,
    [patientId]
  );
  const patient = patientResult.rows[0];
  if (!patient) {
    const error = new Error('Patient not found or inactive');
    error.statusCode = 404;
    throw error;
  }
  const deliveries = [];
  for (const channel of selectedChannels) {
    const recipient = channel === 'email' ? patient.email : patient.mobile;
    let status = 'sent';
    let errorMessage = null;
    try {
      if (!recipient) throw new Error(channel === 'email' ? 'Patient has no email address' : 'Patient has no mobile number');
      if (channel === 'email') await sendCommunicationEmail({ email: recipient, fullName: patient.full_name, subject, message });
      else await sendSms({ phoneNumber: recipient, message });
    } catch (error) {
      status = 'failed';
      errorMessage = String(error.message || 'Delivery failed').slice(0, 500);
    }
    const delivery = await query(
      `INSERT INTO communication_deliveries
         (patient_id, provider_id, appointment_id, follow_up_id, waiting_list_entry_id, sent_by_user_id,
          channel, recipient, subject, message_text, status, error_message, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $11 = 'sent' THEN now() ELSE NULL END)
       RETURNING id, channel, status, error_message, sent_at, created_at`,
      [patient.id, providerId, appointmentId, followUpId, waitingListEntryId, sentByUserId, channel, recipient || 'unavailable', subject || null, message, status, errorMessage]
    );
    deliveries.push(delivery.rows[0]);
  }
  return { patient, deliveries };
}
