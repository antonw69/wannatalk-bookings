const smsApiUrl = process.env.SMS_API_URL;
const smsApiKey = process.env.SMS_API_KEY;

export function smsConfigurationStatus() {
  return { configured: Boolean(smsApiUrl && smsApiKey), url: smsApiUrl || null };
}

export async function sendSms({ phoneNumber, message }) {
  if (!smsApiUrl || !smsApiKey) throw new Error('SMS configuration is incomplete');
  const response = await fetch(smsApiUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'X-API-KEY': smsApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phoneNumber, message }),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `SMS service failed (${response.status})`);
  }
  return payload;
}
