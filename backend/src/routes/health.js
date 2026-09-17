import { Router } from 'express';
import { query } from '../db.js';
import { verifyMailTransport } from '../mail.js';
import { authRequired } from '../middleware/authRequired.js';

export const healthRouter = Router();

healthRouter.get('/', authRequired(['admin']), async (req, res, next) => {
  try {
    const databaseStartedAt = Date.now();
    const databaseResult = await query(
      `SELECT current_database() AS database_name,
              (SELECT count(*)::int FROM app_users WHERE is_active = true) AS active_accounts,
              (SELECT count(*)::int FROM appointments WHERE appointment_date >= current_date) AS upcoming_appointments`
    );
    const database = {
      ok: true,
      responseMs: Date.now() - databaseStartedAt,
      ...databaseResult.rows[0],
    };
    const email = await verifyMailTransport();
    const smsConfigured = Boolean(process.env.SMS_API_URL && process.env.SMS_API_KEY);

    res.json({
      checkedAt: new Date().toISOString(),
      api: {
        ok: true,
        service: 'wannatalk-bookings-api',
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development',
      },
      database,
      email,
      sms: {
        ok: smsConfigured,
        configured: smsConfigured,
        status: smsConfigured ? 'Configured' : 'Not configured',
      },
    });
  } catch (error) {
    next(error);
  }
});
