import { verifyToken } from '../auth.js';
import { query } from '../db.js';

export function authRequired(allowedRoles = []) {
  return async (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Login required' });

    let claims;
    try {
      claims = verifyToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired login' });
    }

    try {
      const result = await query(
        `SELECT id, full_name, email, role, auth_version
         FROM app_users
         WHERE id = $1 AND is_active = true`,
        [claims.id]
      );
      const account = result.rows[0];
      if (!account || Number(account.auth_version) !== Number(claims.authVersion || 0)) {
        return res.status(401).json({ error: 'Invalid or expired login' });
      }
      req.user = { ...claims, role: account.role, name: account.full_name, email: account.email };
      if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Not allowed' });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
