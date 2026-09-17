import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { query, withTransaction } from './db.js';
import { mailConfigurationStatus, sendOtpEmail } from './mail.js';
import { sendSms, smsConfigurationStatus } from './sms.js';

const otpTtlMinutes = Math.min(15, Math.max(5, Number(process.env.OTP_TTL_MINUTES || 10)));
const trustedDeviceDays = Math.min(30, Math.max(1, Number(process.env.TRUSTED_DEVICE_DAYS || 14)));
const otpPepper = process.env.OTP_PEPPER || process.env.JWT_SECRET;
const trustedCookieName = 'wt_trusted_device';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function otpHash(challengeId, code) {
  if (!otpPepper) throw new Error('OTP_PEPPER or JWT_SECRET is required');
  return createHmac('sha256', otpPepper).update(`${challengeId}:${code}`).digest('hex');
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return 'your email';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
}

function maskMobile(mobile) {
  const value = String(mobile || '');
  return value.length > 4 ? `${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}` : 'your mobile';
}

export function availableMfaMethods(user) {
  const methods = [];
  if (mailConfigurationStatus().configured && user.email) methods.push({ method: 'email', label: 'Email', destination: maskEmail(user.email) });
  if (smsConfigurationStatus().configured && user.mobile) methods.push({ method: 'sms', label: 'SMS', destination: maskMobile(user.mobile) });
  return methods;
}

function unavailableMfaMethods(user) {
  const unavailable = [];
  if (!mailConfigurationStatus().configured) unavailable.push({ method: 'email', label: 'Email', reason: 'Email delivery is not configured' });
  if (!smsConfigurationStatus().configured) unavailable.push({ method: 'sms', label: 'SMS', reason: 'SMS delivery is not configured' });
  else if (!user.mobile) unavailable.push({ method: 'sms', label: 'SMS', reason: 'No mobile number is saved for this account' });
  return unavailable;
}

export async function createMfaChallenge({ user, purpose, requestedIp }) {
  const methods = availableMfaMethods(user);
  if (!methods.length) {
    const error = new Error('No verification delivery method is configured for this account');
    error.statusCode = 503;
    throw error;
  }
  await query(
    `UPDATE auth_otp_challenges SET consumed_at = now()
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [user.id, purpose]
  );
  const result = await query(
    `INSERT INTO auth_otp_challenges (user_id, purpose, requested_ip, expires_at)
     VALUES ($1, $2, $3, now() + interval '15 minutes')
     RETURNING id`,
    [user.id, purpose, requestedIp || null]
  );
  return { challengeId: result.rows[0].id, methods, unavailableMethods: unavailableMfaMethods(user) };
}

export async function sendMfaCode({ challengeId, method }) {
  const result = await query(
    `SELECT c.id, c.user_id, c.purpose, c.last_sent_at, u.full_name, u.email, u.mobile
     FROM auth_otp_challenges c
     JOIN app_users u ON u.id = c.user_id
     WHERE c.id = $1 AND c.consumed_at IS NULL AND c.expires_at > now()`,
    [challengeId]
  );
  const challenge = result.rows[0];
  if (!challenge) {
    const error = new Error('Verification request has expired. Please start again.');
    error.statusCode = 400;
    throw error;
  }
  if (challenge.last_sent_at && Date.now() - new Date(challenge.last_sent_at).getTime() < 60_000) {
    const error = new Error('Please wait 60 seconds before requesting another code');
    error.statusCode = 429;
    throw error;
  }
  const user = { email: challenge.email, mobile: challenge.mobile };
  const selected = availableMfaMethods(user).find((item) => item.method === method);
  if (!selected) {
    const error = new Error('That verification method is not available');
    error.statusCode = 400;
    throw error;
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await query(
    `UPDATE auth_otp_challenges
     SET delivery_method = $1, destination_masked = $2, code_hash = $3,
         attempts = 0, last_sent_at = now(), expires_at = now() + ($4 * interval '1 minute')
     WHERE id = $5`,
    [method, selected.destination, otpHash(challenge.id, code), otpTtlMinutes, challenge.id]
  );

  try {
    if (method === 'email') {
      await sendOtpEmail({ email: challenge.email, fullName: challenge.full_name, code, expiresMinutes: otpTtlMinutes });
    } else {
      await sendSms({ phoneNumber: challenge.mobile, message: `WannaTalk verification code: ${code}. It expires in ${otpTtlMinutes} minutes. Do not share this code.` });
    }
  } catch (error) {
    await query(
      `UPDATE auth_otp_challenges SET code_hash = NULL, last_sent_at = NULL WHERE id = $1`,
      [challenge.id]
    );
    throw error;
  }

  return { method, destination: selected.destination, expiresMinutes: otpTtlMinutes };
}

export async function verifyMfaCode({ challengeId, code }) {
  const verification = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT c.*, u.id AS account_id, u.full_name, u.email, u.mobile, u.role, u.is_active, u.registration_status,
              u.auth_version, u.preferred_contact, COALESCE(p.id, pat.id) AS entity_id
       FROM auth_otp_challenges c
       JOIN app_users u ON u.id = c.user_id
       LEFT JOIN providers p ON p.user_id = u.id
       LEFT JOIN patients pat ON pat.user_id = u.id
       WHERE c.id = $1
       FOR UPDATE OF c, u`,
      [challengeId]
    );
    const challenge = result.rows[0];
    if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) <= new Date() || !challenge.code_hash) {
      return { error: 'Invalid or expired verification code', statusCode: 400 };
    }
    if (challenge.attempts >= 5) return { error: 'Too many incorrect attempts. Please start again.', statusCode: 429 };

    const expected = Buffer.from(challenge.code_hash, 'hex');
    const received = Buffer.from(otpHash(challenge.id, code), 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      await client.query(`UPDATE auth_otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [challenge.id]);
      return { error: 'Incorrect verification code', statusCode: 400 };
    }

    await client.query(`UPDATE auth_otp_challenges SET consumed_at = now() WHERE id = $1`, [challenge.id]);
    const verificationColumn = challenge.delivery_method === 'sms' ? 'mobile_verified_at' : 'email_verified_at';
    await client.query(`UPDATE app_users SET ${verificationColumn} = now(), updated_at = now() WHERE id = $1`, [challenge.user_id]);
    if (challenge.purpose === 'registration' && challenge.role === 'patient') {
      await client.query(`UPDATE app_users SET is_active = true, registration_verification_required = false, updated_at = now() WHERE id = $1`, [challenge.user_id]);
      challenge.is_active = true;
    } else if (challenge.purpose === 'registration') {
      await client.query(`UPDATE app_users SET registration_verification_required = false, updated_at = now() WHERE id = $1`, [challenge.user_id]);
    }
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [challenge.user_id, challenge.full_name, challenge.role,
        challenge.purpose === 'registration' ? 'Verified registration contact' : 'Completed multi-factor authentication',
        JSON.stringify({ method: challenge.delivery_method })]
    );
    return { challenge, user: { ...challenge, id: challenge.account_id } };
  });

  if (verification.error) {
    const error = new Error(verification.error);
    error.statusCode = verification.statusCode;
    throw error;
  }
  return verification;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? [part, ''] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
  }));
}

export async function trustedDeviceIsValid(req, userId) {
  const token = parseCookies(req)[trustedCookieName];
  if (!token) return false;
  const result = await query(
    `UPDATE trusted_devices
     SET last_used_at = now(), last_ip = $1
     WHERE user_id = $2 AND token_hash = $3 AND revoked_at IS NULL AND expires_at > now()
     RETURNING id`,
    [req.ip || req.socket.remoteAddress || null, userId, sha256(token)]
  );
  return Boolean(result.rows[0]);
}

export async function rememberTrustedDevice({ req, res, userId }) {
  const token = randomBytes(32).toString('base64url');
  const userAgent = String(req.get('user-agent') || '').slice(0, 500);
  const deviceLabel = userAgent.slice(0, 120) || 'Browser';
  await query(
    `INSERT INTO trusted_devices (user_id, token_hash, device_label, user_agent, last_ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 day'))`,
    [userId, sha256(token), deviceLabel, userAgent, req.ip || req.socket.remoteAddress || null, trustedDeviceDays]
  );
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${trustedCookieName}=${encodeURIComponent(token)}; Max-Age=${trustedDeviceDays * 86400}; Path=/api/auth; HttpOnly; SameSite=Strict${secure}`);
}
