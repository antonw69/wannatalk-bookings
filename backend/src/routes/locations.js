import { Router } from 'express';
import { query } from '../db.js';
import { authRequired } from '../middleware/authRequired.js';

export const locationsRouter = Router();

locationsRouter.get('/', authRequired(), async (req, res) => {
  const result = await query(`SELECT id, name FROM locations WHERE is_active = true ORDER BY name`);
  res.json({ locations: result.rows });
});
