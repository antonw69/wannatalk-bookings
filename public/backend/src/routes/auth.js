import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { publicUser, signToken } from '../auth.js';
import { authRequired } from '../middleware/authRequired.js';

export const authRouter = Router();

const roleMap = new Set(['admin', 'provider', 'patient']);
const registrationAttempts = new Map();

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
    const registered = await withTransaction(async (client) => {
      const passwordHash = await bcrypt.hash(password, 12);
      const userResult = await client.query(
        `INSERT INTO app_users (full_name, email, mobile, password_hash, role, preferred_contact, is_active, registration_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, full_name, email, mobile, role, preferred_contact, is_active, registration_status`,
        [fullName, email, mobile, passwordHash, role, preferredContact, isPatient, isPatient ? 'approved' : 'pending']
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

    if (!isPatient) {
      return res.status(202).json({ status: 'pending', message: 'Registration submitted for administrator approval' });
    }
    return res.status(201).json({ status: 'approved', token: signToken(registered), user: publicUser(registered) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account already exists for this email address' });
    return next(error);
  }
});

// POST /api/auth/login { email, password, role }
authRouter.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '').trim();

  if (!email || !password || !roleMap.has(role)) {
    return res.status(400).json({ error: 'Email, password and valid role are required' });
  }

  const result = await query(
    `SELECT u.id, u.full_name, u.email, u.mobile, u.password_hash, u.role,
            u.preferred_contact, u.is_active, COALESCE(p.id, pat.id) AS entity_id
     FROM app_users u
     LEFT JOIN providers p ON p.user_id = u.id
     LEFT JOIN patients pat ON pat.user_id = u.id
     WHERE lower(u.email) = $1 AND u.role = $2 AND u.is_active = true`,
    [email, role]
  );

  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Incorrect email, password, or account type' });
  if (!user.password_hash) return res.status(401).json({ error: 'Password not set for this account' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect login details' });

  res.json({ token: signToken(user), user: publicUser(user) });
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
