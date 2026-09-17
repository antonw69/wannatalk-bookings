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
  const result = await query(
    `SELECT day_of_week, is_available, start_time, end_time
     FROM provider_availability
     WHERE provider_id = $1
     ORDER BY day_of_week`,
    [req.params.id]
  );
  res.json({ availability: result.rows });
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
      `UPDATE app_users SET is_active = false, updated_at = now() WHERE id = $1`,
      [account.user_id]
    );
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
