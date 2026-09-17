# Live registration update

This update adds live patient registration plus administrator approval for provider and admin access requests. It does not change existing accounts, appointments, or passwords.

## Upload from the Mac

```bash
scp "/Users/AntonW/Documents/Codex/2026-09-16/referenced-chatgpt-conversation-this-is-an/outputs/wannatalk-bookings-deploy.zip" anton@102.220.100.152:/home/anton/
ssh anton@102.220.100.152
```

## Extract and back up

```bash
mkdir -p /home/anton/wannatalk-registration-update
cd /home/anton/wannatalk-registration-update
unzip -o /home/anton/wannatalk-bookings-deploy.zip

sudo cp -a /opt/wannatalk-bookings/backend /opt/wannatalk-bookings/backend.before-registration
sudo cp /var/www/bookings.wannatalk.co.za/index.html /var/www/bookings.wannatalk.co.za/index.html.before-registration
```

## Apply the database migration

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -d wannatalk -f /home/anton/wannatalk-registration-update/migrations/003_registration_workflow.sql
```

The final migration line should be `COMMIT`.

## Install the updated API and page

```bash
sudo systemctl stop wannatalk-bookings
sudo cp -a /home/anton/wannatalk-registration-update/backend/. /opt/wannatalk-bookings/backend/
cd /opt/wannatalk-bookings/backend
sudo npm ci --omit=dev
sudo install -o www-data -g www-data -m 0644 /home/anton/wannatalk-registration-update/public/index.html /var/www/bookings.wannatalk.co.za/index.html
sudo systemctl start wannatalk-bookings
sudo systemctl status wannatalk-bookings --no-pager
curl http://127.0.0.1:3100/api/health
```

## Test

1. Hard-refresh `https://bookings.wannatalk.co.za`.
2. Register a patient. The patient should enter immediately.
3. Register a provider or administrator. The page should show that approval is pending.
4. Sign in as the existing administrator, open **Registrations**, and approve the request.
5. Sign in with the approved account.
