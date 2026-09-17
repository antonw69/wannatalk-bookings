import { verifyToken } from '../auth.js';

export function authRequired(allowedRoles = []) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Login required' });

    try {
      req.user = verifyToken(token);
      if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Not allowed' });
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired login' });
    }
  };
}
