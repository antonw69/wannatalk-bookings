import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired } from '../middleware/authRequired.js';

export const registrationsRouter = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

registrationsRouter.get('/', authRequired(['admin']), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.full_name, u.email, u.mobile, u.role, u.registration_status, u.created_at,
            p.professional_title, p.default_duration_minutes,
            COALESCE(json_agg(l.name ORDER BY l.name) FILTER (WHERE l.id IS NOT NULL), '[]') AS locations
     FROM app_users u
     LEFT JOIN providers p ON p.user_id = u.id
     LEFT JOIN provider_locations pl ON pl.provider_id = p.id
     LEFT JOIN locations l ON l.id = pl.location_id
     WHERE u.registration_status = 'pending'
     GROUP BY u.id, p.id
     ORDER BY u.created_at DESC`
  );
  res.json({ registrations: result.rows });
}));

registrationsRouter.patch('/:id/approve', authRequired(['admin']), asyncHandler(async (req, res) => {
  const approved = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE app_users
       SET is_active = true, registration_status = 'approved', updated_at = now()
       WHERE id = $1 AND registration_status = 'pending'
       RETURNING id, full_name, email, role`,
      [req.params.id]
    );
    if (!result.rows[0]) return null;
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
       VALUES ($1, $2, $3, 'Approved registration', $4::jsonb)`,
      [req.user.id, req.user.name || req.user.email || 'Administrator', req.user.role, JSON.stringify({ approvedUserId: req.params.id, email: result.rows[0].email, role: result.rows[0].role })]
    );
    return result.rows[0];
  });
  if (!approved) return res.status(404).json({ error: 'Pending registration not found' });
  res.json({ registration: approved });
}));

registrationsRouter.patch('/:id/reject', authRequired(['admin']), asyncHandler(async (req, res) => {
  const rejected = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE app_users
       SET is_active = false, registration_status = 'rejected', updated_at = now()
       WHERE id = $1 AND registration_status = 'pending'
       RETURNING id, full_name, email, role`,
      [req.params.id]
    );
    if (!result.rows[0]) return null;
    await client.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, details)
       VALUES ($1, $2, $3, 'Rejected registration', $4::jsonb)`,
      [req.user.id, req.user.name || req.user.email || 'Administrator', req.user.role, JSON.stringify({ rejectedUserId: req.params.id, email: result.rows[0].email, role: result.rows[0].role })]
    );
    return result.rows[0];
  });
  if (!rejected) return res.status(404).json({ error: 'Pending registration not found' });
  res.json({ registration: rejected });
}));
