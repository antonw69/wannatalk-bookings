# WannaTalk Bookings API

Backend API for the WannaTalk booking dashboard. The browser must call this API instead of connecting directly to PostgreSQL.

## Setup

```bash
cd backend
cp .env.example .env
npm install
npm run start
```

Update `.env` with the real PostgreSQL password and a long random `JWT_SECRET`.

## First Passwords

The seed migration creates demo users without passwords. Set passwords like this:

```bash
node scripts/set-password.js admin@wannatalk.co.za "new-password"
node scripts/set-password.js louw@wannatalk.co.za "new-password"
node scripts/set-password.js sarah@test.co.za "new-password"
```

## Main Endpoints

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/providers`
- `GET /api/providers/:id/availability`
- `PUT /api/providers/:id/availability`
- `PATCH /api/providers/:id/status`
- `GET /api/patients`
- `GET /api/locations`
- `GET /api/appointments`
- `POST /api/appointments`
- `PATCH /api/appointments/:id/reschedule`
- `PATCH /api/appointments/:id/status`
- `DELETE /api/appointments/:id`
- `GET /api/audit-logs`
- `GET /api/registrations`
- `PATCH /api/registrations/:id/approve`
- `PATCH /api/registrations/:id/reject`
