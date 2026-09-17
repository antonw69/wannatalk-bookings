import { Router } from 'express';
import { query } from '../db.js';
import { authRequired } from '../middleware/authRequired.js';

export const auditLogsRouter = Router();

auditLogsRouter.get('/', authRequired(['admin']), async (req, res) => {
  const result = await query(
    `SELECT id, user_name, user_role, action, location_name, appointment_id, details, created_at
     FROM audit_logs
     ORDER BY created_at DESC
     LIMIT 200`
  );
  res.json({ auditLogs: result.rows });
});
