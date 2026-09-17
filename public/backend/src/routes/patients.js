import { Router } from 'express';
import { query } from '../db.js';
import { authRequired } from '../middleware/authRequired.js';

export const patientsRouter = Router();

patientsRouter.get('/', authRequired(), async (req, res) => {
  const params = [];
  let where = '';

  if (req.user.role === 'patient') {
    params.push(req.user.id);
    where = 'WHERE u.id = $1';
  } else if (req.user.role === 'provider') {
    params.push(req.user.id);
    where = `WHERE EXISTS (
      SELECT 1 FROM appointments a
      JOIN providers pro ON pro.id = a.provider_id
      WHERE a.patient_id = pat.id AND pro.user_id = $1
    )`;
  }

  const result = await query(
    `SELECT pat.id, u.full_name, u.email, u.mobile, u.preferred_contact
     FROM patients pat
     JOIN app_users u ON u.id = pat.user_id
     ${where}
     ORDER BY u.full_name`,
    params
  );
  res.json({ patients: result.rows });
});
