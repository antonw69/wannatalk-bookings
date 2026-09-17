import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { query } from './db.js';
import { auditLogsRouter } from './routes/auditLogs.js';
import { appointmentsRouter } from './routes/appointments.js';
import { authRouter } from './routes/auth.js';
import { communicationsRouter } from './routes/communications.js';
import { followUpsRouter } from './routes/followUps.js';
import { healthRouter } from './routes/health.js';
import { locationsRouter } from './routes/locations.js';
import { patientsRouter } from './routes/patients.js';
import { providersRouter } from './routes/providers.js';
import { registrationsRouter } from './routes/registrations.js';
import { waitingListRouter } from './routes/waitingList.js';
import { errorHandler, notFound } from './middleware/errors.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = String(process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);

app.set('trust proxy', 'loopback');
app.use(helmet());
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/api/health', async (req, res) => {
  await query('SELECT 1');
  res.json({ ok: true, service: 'wannatalk-bookings-api' });
});

app.use('/api/auth', authRouter);
app.use('/api/admin/health', healthRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/providers', providersRouter);
app.use('/api/registrations', registrationsRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/communications', communicationsRouter);
app.use('/api/follow-ups', followUpsRouter);
app.use('/api/waiting-list', waitingListRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`WannaTalk bookings API listening on port ${port}`);
});
