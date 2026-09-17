import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired } from '../middleware/authRequired.js';

export const providersRouter = Router();

providersRouter.get('/', authRequired(), async (req, res) => {
  const result = await query(
    `SELECT p.id, u.full_name, u.email, u.mobile, u.is_active, p.professional_title, p.default_duration_minutes,
            p.bio, p.is_online,
            COALESCE(json_agg(l.name ORDER BY l.name) FILTER (WHERE l.id IS NOT NULL), '[]') AS locations
     FROM providers p
     JOIN app_users u ON u.id = p.user_id
     LEFT JOIN provider_locations pl ON pl.provider_id = p.id
     LEFT JOIN locations l ON l.id = pl.location_id
     WHERE u.registration_status = 'approved'
     GROUP BY p.id, u.full_name, u.email, u.mobile, u.is_active
     ORDER BY u.full_name`
  );
  res.json({ providers: result.rows });
});

providersRouter.get('/:id/availability', authRequired(), async (req, res) => {
  const [availabilityResult, blocksResult, busyResult] = await Promise.all([
    query(
      `SELECT day_of_week, is_available, start_time, end_time
       FROM provider_availability
       WHERE provider_id = $1
       ORDER BY day_of_week`,
      [req.params.id]
    ),
    query(
      `SELECT id, block_date, start_time, end_time, reason
       FROM provider_time_blocks
       WHERE provider_id = $1 AND block_date >= current_date
       ORDER BY block_date, start_time`,
      [req.params.id]
    ),
    query(
      `SELECT appointment_date, appointment_time,
              (appointment_time + (duration_minutes * interval '1 minute'))::time AS end_time
       FROM appointments
       WHERE provider_id = $1 AND appointment_date >= current_date
         AND status = ANY($2::text[])
       ORDER BY appointment_date, appointment_time`,
      [req.params.id, ['Booked', 'Confirmed', 'Arrived', 'Completed']]
    ),
  ]);
  res.json({ availability: availabilityResult.rows, blocks: blocksResult.rows, busy: busyResult.rows });
});

providersRouter.patch('/:id/status', authRequired(['provider', 'admin']), async (req, res) => {
  const online = Boolean(req.body.isOnline);
  if (req.user.role === 'provider') {
    const owner = await query(`SELECT id FROM providers WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!owner.rows[0]) return res.status(403).json({ error: 'Not allowed' });
  }
  const result = await query(
    `UPDATE providers SET is_online = $1, updated_at = now()
     WHERE id = $2
     RETURNING id, is_online`,
    [online, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Provider not found' });
  await query(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [req.user.id, req.user.name || req.user.email || req.user.role, req.user.role, online ? 'Provider went online' : 'Provider went offline', JSON.stringify({ providerId: req.params.id })]
  );
  res.json({ provider: result.rows[0] });
});

providersRouter.patch('/:id/profile', authRequired(['provider', 'admin']), async (req, res) => {
  const fullName = String(req.body.fullName || '').trim().slice(0, 100);
  const requestedEmail = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
  const mobile = String(req.body.mobile || '').trim().slice(0, 30);
  const professionalTitle = String(req.body.professionalTitle || '').trim().slice(0, 100) || 'Provider';
  const duration = [45, 60, 90].includes(Number(req.body.durationMinutes)) ? Number(req.body.durationMinutes) : 60;
  const bio = String(req.body.bio || '').trim().slice(0, 500) || null;
  const requestedLocations = Array.isArray(req.body.locations) ? [...new Set(req.body.locations.map((value) => String(value || '').trim()).filter(Boolean))] : [];
  if (!fullName || !requestedLocations.length) return res.status(400).json({ error: 'Name and at least one practice location are required' });
  if (req.user.role === 'admin' && (!requestedEmail || !requestedEmail.includes('@'))) return res.status(400).json({ error: 'A valid email address is required' });

  const provider = await withTransaction(async (client) => {
    const currentResult = await client.query(
      `SELECT p.id, p.user_id, u.email, u.mobile
       FROM providers p JOIN app_users u ON u.id = p.user_id
       WHERE p.id = $1
       FOR UPDATE`,
      [req.params.id]
    );
    const current = currentResult.rows[0];
    if (!current) return null;
    if (req.user.role === 'provider' && current.user_id !== req.user.id) {
      const error = new Error('Not allowed');
      error.statusCode = 403;
      throw error;
    }
    const email = req.user.role === 'admin' ? requestedEmail : current.email;
    const duplicate = await client.query(`SELECT id FROM app_users WHERE lower(email) = lower($1) AND id <> $2`, [email, current.user_id]);
    if (duplicate.rows[0]) {
      const error = new Error('That email address is already registered');
      error.statusCode = 409;
      throw error;
    }
    const locations = await client.query(`SELECT id, name FROM locations WHERE name = ANY($1::text[]) AND is_active = true`, [requestedLocations]);
    if (locations.rows.length !== requestedLocations.length) {
      const error = new Error('One or more practice locations are invalid');
      error.statusCode = 400;
      throw error;
    }
    const emailChanged = current.email.toLowerCase() !== email;
    const mobileChanged = String(current.mobile || '') !== mobile;
    const adminContactChanged = req.user.role === 'admin' && (emailChanged || mobileChanged);
    await client.query(
      `UPDATE app_users
       SET full_name = $1, email = $2, mobile = $3,
           email_verified_at = CASE WHEN lower(email) <> lower($2) THEN NULL ELSE email_verified_at END,
           mobile_verified_at = CASE WHEN COALESCE(mobile, '') <> $3 THEN NULL ELSE mobile_verified_at END,
           auth_version = auth_version + CASE WHEN $5 THEN 1 ELSE 0 END,
           updated_at = now()
       WHERE id = $4`,
      [fullName, email, mobile, current.user_id, adminContactChanged]
    );
    await client.query(
      `UPDATE providers SET professional_title = $1, default_duration_minutes = $2, bio = $3, updated_at = now() WHERE id = $4`,
      [professionalTitle, duration, bio, current.id]
    );
    await client.query(`DELETE FROM provider_locations WHERE provider_id = $1`, [current.id]);
    for (const location of locations.rows) await client.query(`INSERT INTO provider_locations (provider_id, location_id) VALUES ($1, $2)`, [current.id, location.id]);
    if (emailChanged || mobileChanged) await client.query(`UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [current.user_id]);
    if (adminContactChanged) await client.query(`UPDATE auth_otp_challenges SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`, [current.user_id]);
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
       VALUES ($1, $2, $3, 'Updated provider profile', $4::jsonb)`,
      [req.user.id, req.user.name || req.user.email || req.user.role, req.user.role, JSON.stringify({ providerId: current.id, emailChanged, mobileChanged })]
    );
    return { id: current.id };
  });
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  res.json({ provider });
});

providersRouter.patch('/:id/deactivate', authRequired(['admin']), async (req, res) => {
  const provider = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT p.id, p.user_id, u.full_name, u.email, u.is_active
       FROM providers p
       JOIN app_users u ON u.id = p.user_id
       WHERE p.id = $1
       FOR UPDATE`,
      [req.params.id]
    );
    const account = result.rows[0];
    if (!account) return null;

    await client.query(
      `UPDATE app_users SET is_active = false, auth_version = auth_version + 1, updated_at = now() WHERE id = $1`,
      [account.user_id]
    );
    await client.query(`UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [account.user_id]);
    await client.query(`UPDATE auth_otp_challenges SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`, [account.user_id]);
    await client.query(
      `UPDATE providers SET is_online = false, updated_at = now() WHERE id = $1`,
      [account.id]
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
       VALUES ($1, $2, $3, 'Deactivated provider', $4::jsonb)`,
      [req.user.id, req.user.name || req.user.email || 'Administrator', req.user.role,
        JSON.stringify({ providerId: account.id, providerUserId: account.user_id, email: account.email })]
    );

    return { id: account.id, fullName: account.full_name, email: account.email, isActive: false };
  });

  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  res.json({ provider });
});

providersRouter.patch('/:id/reactivate', authRequired(['admin']), async (req, res) => {
  const provider = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT p.id, p.user_id, u.full_name, u.email
       FROM providers p
       JOIN app_users u ON u.id = p.user_id
       WHERE p.id = $1 AND u.registration_status = 'approved'
       FOR UPDATE`,
      [req.params.id]
    );
    const account = result.rows[0];
    if (!account) return null;

    await client.query(
      `UPDATE app_users SET is_active = true, updated_at = now() WHERE id = $1`,
      [account.user_id]
    );
    await client.query(
      `UPDATE providers SET is_online = false, updated_at = now() WHERE id = $1`,
      [account.id]
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
       VALUES ($1, $2, $3, 'Reactivated provider', $4::jsonb)`,
      [req.user.id, req.user.name || req.user.email || 'Administrator', req.user.role,
        JSON.stringify({ providerId: account.id, providerUserId: account.user_id, email: account.email })]
    );

    return { id: account.id, fullName: account.full_name, email: account.email, isActive: true };
  });

  if (!provider) return res.status(404).json({ error: 'Approved provider not found' });
  res.json({ provider });
});

providersRouter.put('/:id/availability', authRequired(['provider', 'admin']), async (req, res) => {
  const availability = Array.isArray(req.body.availability) ? req.body.availability : [];
  if (availability.length !== 7) return res.status(400).json({ error: 'All seven availability days are required' });

  if (req.user.role === 'provider') {
    const owner = await query(`SELECT id FROM providers WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!owner.rows[0]) return res.status(403).json({ error: 'Not allowed' });
  }

  await withTransaction(async (client) => {
    for (const item of availability) {
      const day = Number(item.dayOfWeek);
      if (!Number.isInteger(day) || day < 0 || day > 6 || !item.startTime || !item.endTime) {
        const error = new Error('Invalid availability entry');
        error.statusCode = 400;
        throw error;
      }
      await client.query(
        `INSERT INTO provider_availability (provider_id, day_of_week, is_available, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (provider_id, day_of_week)
         DO UPDATE SET is_available = EXCLUDED.is_available, start_time = EXCLUDED.start_time,
                       end_time = EXCLUDED.end_time, updated_at = now()`,
        [req.params.id, day, Boolean(item.isAvailable), item.startTime, item.endTime]
      );
    }
  });

  res.json({ ok: true });
});
