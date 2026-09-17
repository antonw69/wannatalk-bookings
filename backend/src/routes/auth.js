import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { publicUser, signToken, verifyToken } from '../auth.js';
import { sendPasswordResetEmail } from '../mail.js';
import { authRequired } from '../middleware/authRequired.js';
import {
  createMfaChallenge,
  rememberTrustedDevice,
  sendMfaCode,
  trustedDeviceIsValid,
  verifyMfaCode,
} from '../mfa.js';

export const authRouter = Router();

const roleMap = new Set(['admin', 'provider', 'patient']);
const registrationAttempts = new Map();
const passwordResetAttempts = new Map();
const loginAttempts = new Map();
const passwordResetMessage = 'If an active account exists for that email address, a password reset link has been sent.';
const resetTokenTtlMinutes = Math.min(120, Math.max(10, Number(process.env.RESET_TOKEN_TTL_MINUTES || 30)));

function registrationRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const recent = (registrationAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Too many registration attempts. Try again later.' });
  recent.push(now);
  registrationAttempts.set(key, recent);
  next();
}

function cleanText(value, maxLength = 120) {
  const text = String(value || '').trim().slice(0, maxLength);
  return /[<>]/.test(text) ? '' : text;
}

function passwordResetRateLimit(req, res, next) {
  const now = Date.now();
  const email = String(req.body.email || '').trim().toLowerCase();
  const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${email}`;
  const recent = (passwordResetAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Too many password reset attempts. Try again later.' });
  recent.push(now);
  passwordResetAttempts.set(key, recent);
  next();
}

function resetTokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function loginRateLimit(req, res, next) {
  const now = Date.now();
  const email = String(req.body.email || '').trim().toLowerCase();
  const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${email}`;
  const recent = (loginAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  recent.push(now);
  loginAttempts.set(key, recent);
  next();
}

async function requestIsAdmin(req) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return false;
  try {
    const claims = verifyToken(header.slice(7));
    const result = await query(
      `SELECT id FROM app_users
       WHERE id = $1 AND role = 'admin' AND is_active = true AND auth_version = $2`,
      [claims.id, Number(claims.authVersion || 0)]
    );
    return Boolean(result.rows[0]);
  } catch {
    return false;
  }
}

authRouter.post('/register', registrationRateLimit, async (req, res, next) => {
  const role = String(req.body.role || '').trim();
  const fullName = cleanText(req.body.fullName, 100);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
  const mobile = cleanText(req.body.mobile, 30) || null;
  const password = String(req.body.password || '');
  const preferredContact = cleanText(req.body.preferredContact, 30) || 'Email';

  if (!roleMap.has(role) || !fullName || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Valid name, email and account type are required' });
  }
  if (role === 'admin') return res.status(403).json({ error: 'Administrator accounts cannot be registered publicly' });
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 12 and 128 characters' });
  }

  const isPatient = role === 'patient';
  const professionalTitle = cleanText(req.body.professionalTitle, 100) || 'Provider';
  const duration = [45, 60, 90].includes(Number(req.body.durationMinutes)) ? Number(req.body.durationMinutes) : 60;
  const bio = cleanText(req.body.bio, 500) || null;
  const requestedLocations = Array.isArray(req.body.locations)
    ? [...new Set(req.body.locations.map((value) => cleanText(value, 50)).filter(Boolean))]
    : [];
  if (role === 'provider' && !requestedLocations.length) {
    return res.status(400).json({ error: 'Choose at least one practice location' });
  }

  try {
    const createdByAdmin = await requestIsAdmin(req);
    const registered = await withTransaction(async (client) => {
      const passwordHash = await bcrypt.hash(password, 12);
      const userResult = await client.query(
        `INSERT INTO app_users (full_name, email, mobile, password_hash, role, preferred_contact, is_active, registration_status, registration_verification_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, full_name, email, mobile, role, preferred_contact, is_active, registration_status, auth_version`,
        [fullName, email, mobile, passwordHash, role, preferredContact, createdByAdmin && isPatient, isPatient ? 'approved' : 'pending', !createdByAdmin]
      );
      const user = userResult.rows[0];
      let entityId = null;

      if (role === 'patient') {
        const patient = await client.query(`INSERT INTO patients (user_id) VALUES ($1) RETURNING id`, [user.id]);
        entityId = patient.rows[0].id;
      } else if (role === 'provider') {
        const provider = await client.query(
          `INSERT INTO providers (user_id, professional_title, default_duration_minutes, bio, is_online)
           VALUES ($1, $2, $3, $4, false) RETURNING id`,
          [user.id, professionalTitle, duration, bio]
        );
        entityId = provider.rows[0].id;
        const locations = await client.query(`SELECT id, name FROM locations WHERE name = ANY($1::text[]) AND is_active = true`, [requestedLocations]);
        if (locations.rows.length !== requestedLocations.length) {
          const error = new Error('One or more practice locations are invalid');
          error.statusCode = 400;
          throw error;
        }
        for (const location of locations.rows) {
          await client.query(`INSERT INTO provider_locations (provider_id, location_id) VALUES ($1, $2)`, [entityId, location.id]);
        }
        for (let day = 1; day <= 5; day += 1) {
          await client.query(
            `INSERT INTO provider_availability (provider_id, day_of_week, is_available, start_time, end_time)
             VALUES ($1, $2, true, '09:00', '17:00')`,
            [entityId, day]
          );
        }
      }

      await client.query(
        `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [user.id, user.full_name, user.role, isPatient ? 'Patient registered' : 'Registration requested', JSON.stringify({ registrationStatus: user.registration_status })]
      );
      return { ...user, entity_id: entityId };
    });

    if (createdByAdmin) {
      return res.status(isPatient ? 201 : 202).json({
        status: isPatient ? 'approved' : 'pending',
        message: isPatient ? 'Patient account created. Multi-factor authentication will be required at login.' : 'Registration submitted for administrator approval',
      });
    }

    const challenge = await createMfaChallenge({
      user: registered,
      purpose: 'registration',
      requestedIp: req.ip || req.socket.remoteAddress || null,
    });
    return res.status(202).json({
      status: 'verification_required',
      verificationRequired: true,
      purpose: 'registration',
      role,
      ...challenge,
      message: 'Verify your email address or mobile number to complete registration.',
    });

  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account already exists for this email address' });
    return next(error);
  }
});

authRouter.post('/forgot-password', passwordResetRateLimit, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);

  try {
    const result = await query(
      `SELECT id, full_name, email, role
       FROM app_users
       WHERE lower(email) = $1 AND is_active = true`,
      [email]
    );
    const user = result.rows[0];

    if (user) {
      const token = randomBytes(32).toString('base64url');
      const tokenHash = resetTokenHash(token);
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE password_reset_tokens SET used_at = now()
           WHERE user_id = $1 AND used_at IS NULL`,
          [user.id]
        );
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, requested_ip, expires_at)
           VALUES ($1, $2, $3, now() + ($4 * interval '1 minute'))`,
          [user.id, tokenHash, req.ip || req.socket.remoteAddress || null, resetTokenTtlMinutes]
        );
        await client.query(
          `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
           VALUES ($1, $2, $3, 'Requested password reset', $4::jsonb)`,
          [user.id, user.full_name, user.role, JSON.stringify({ requestedIp: req.ip || req.socket.remoteAddress || null })]
        );
      });

      sendPasswordResetEmail({ email: user.email, fullName: user.full_name, token, expiresMinutes: resetTokenTtlMinutes })
        .catch((error) => console.error('Password reset email failed:', error.message));
    }

    res.json({ message: passwordResetMessage });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/reset-password', passwordResetRateLimit, async (req, res, next) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  if (!token || token.length > 200) return res.status(400).json({ error: 'Invalid or expired password reset link' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 12 and 128 characters' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const tokenHash = resetTokenHash(token);
    const resetUser = await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT t.id AS token_id, u.id, u.full_name, u.email, u.role
         FROM password_reset_tokens t
         JOIN app_users u ON u.id = t.user_id
         WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.is_active = true
         FOR UPDATE OF t, u`,
        [tokenHash]
      );
      const user = result.rows[0];
      if (!user) return null;

      await client.query(
        `UPDATE app_users
         SET password_hash = $1, auth_version = auth_version + 1, updated_at = now()
         WHERE id = $2`,
        [passwordHash, user.id]
      );
      await client.query(
        `UPDATE password_reset_tokens SET used_at = now()
         WHERE user_id = $1 AND used_at IS NULL`,
        [user.id]
      );
      await client.query(
        `UPDATE trusted_devices SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [user.id]
      );
      await client.query(
        `UPDATE auth_otp_challenges SET consumed_at = now()
         WHERE user_id = $1 AND consumed_at IS NULL`,
        [user.id]
      );
      await client.query(
        `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
         VALUES ($1, $2, $3, 'Reset password', '{}'::jsonb)`,
        [user.id, user.full_name, user.role]
      );
      return user;
    });

    if (!resetUser) return res.status(400).json({ error: 'Invalid or expired password reset link' });
    res.json({ message: 'Password updated successfully', email: resetUser.email, role: resetUser.role });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login { email, password, role }
authRouter.post('/login', loginRateLimit, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '').trim();

  if (!email || !password || !roleMap.has(role)) {
    return res.status(400).json({ error: 'Email, password and valid role are required' });
  }

  try {
    const result = await query(
      `SELECT u.id, u.full_name, u.email, u.mobile, u.password_hash, u.role, u.auth_version,
              u.preferred_contact, u.is_active, u.registration_status, u.registration_verification_required,
              COALESCE(p.id, pat.id) AS entity_id
       FROM app_users u
       LEFT JOIN providers p ON p.user_id = u.id
       LEFT JOIN patients pat ON pat.user_id = u.id
       WHERE lower(u.email) = $1 AND u.role = $2`,
      [email, role]
    );

    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Incorrect email, password, or account type' });
    if (!user.password_hash) return res.status(401).json({ error: 'Password not set for this account' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect login details' });
    if (user.registration_verification_required) {
      const challenge = await createMfaChallenge({
        user,
        purpose: 'registration',
        requestedIp: req.ip || req.socket.remoteAddress || null,
      });
      return res.json({ mfaRequired: true, purpose: 'registration', role: user.role, ...challenge });
    }
    if (!user.is_active) {
      const message = user.registration_status === 'pending' ? 'Your registration is awaiting administrator approval' : 'This account is not active';
      return res.status(403).json({ error: message });
    }
    if (await trustedDeviceIsValid(req, user.id)) {
      return res.json({ token: signToken(user), user: publicUser(user), trustedDevice: true });
    }

    const challenge = await createMfaChallenge({
      user,
      purpose: 'login',
      requestedIp: req.ip || req.socket.remoteAddress || null,
    });
    res.json({ mfaRequired: true, purpose: 'login', ...challenge });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/mfa/send', async (req, res, next) => {
  try {
    const challengeId = String(req.body.challengeId || '');
    const method = String(req.body.method || '');
    if (!challengeId || !['email', 'sms'].includes(method)) return res.status(400).json({ error: 'Challenge and delivery method are required' });
    const delivery = await sendMfaCode({ challengeId, method });
    res.json({ message: `Verification code sent by ${method === 'sms' ? 'SMS' : 'email'}`, ...delivery });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/mfa/verify', async (req, res, next) => {
  try {
    const challengeId = String(req.body.challengeId || '');
    const code = String(req.body.code || '').replace(/\D/g, '').slice(0, 8);
    const trustDevice = Boolean(req.body.trustDevice);
    if (!challengeId || code.length < 6) return res.status(400).json({ error: 'Enter the verification code' });
    const verification = await verifyMfaCode({ challengeId, code });
    const { challenge, user } = verification;

    if (challenge.purpose === 'registration' && user.role === 'provider' && user.registration_status !== 'approved') {
      return res.json({ status: 'pending', role: user.role, email: user.email, message: 'Contact verified. Your provider registration is awaiting administrator approval.' });
    }
    if (!user.is_active) return res.status(403).json({ error: 'This account is not active' });
    if (trustDevice) await rememberTrustedDevice({ req, res, userId: user.id });
    res.json({ status: 'approved', token: signToken(user), user: publicUser(user), trustedDevice: trustDevice });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', authRequired(), async (req, res) => {
  const result = await query(
    `SELECT u.id, u.full_name, u.email, u.mobile, u.role, u.preferred_contact,
            u.is_active, COALESCE(p.id, pat.id) AS entity_id
     FROM app_users u
     LEFT JOIN providers p ON p.user_id = u.id
     LEFT JOIN patients pat ON pat.user_id = u.id
     WHERE u.id = $1`,
    [req.user.id]
  );
  res.json({ user: publicUser(result.rows[0]) });
});
