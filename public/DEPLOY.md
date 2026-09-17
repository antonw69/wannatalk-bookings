# WannaTalk Bookings deployment

This bundle deploys the static booking page through Nginx and runs the Node.js API privately on `127.0.0.1:3100`. PostgreSQL remains local to the Ubuntu server.

## Server paths

- Frontend: `/var/www/bookings.wannatalk.co.za/index.html`
- Backend: `/opt/wannatalk-bookings/backend`
- API settings: `/etc/wannatalk-bookings.env`
- Nginx site: `/etc/nginx/sites-available/bookings.wannatalk.co.za`
- Service: `/etc/systemd/system/wannatalk-bookings.service`

## 1. Check the server

```bash
lsb_release -ds
node --version
npm --version
nginx -v
sudo systemctl is-active nginx
sudo systemctl is-active postgresql
```

Use Node.js 18 or newer.

## 2. Upload and install

Upload and extract the bundle into a temporary directory, then run:

```bash
sudo mkdir -p /var/www/bookings.wannatalk.co.za
sudo mkdir -p /opt/wannatalk-bookings
sudo cp public/index.html /var/www/bookings.wannatalk.co.za/index.html
sudo cp -a backend /opt/wannatalk-bookings/
sudo chown -R root:root /opt/wannatalk-bookings
sudo chown -R www-data:www-data /var/www/bookings.wannatalk.co.za
cd /opt/wannatalk-bookings/backend
sudo npm ci --omit=dev
```

## 3. Create private settings

```bash
sudo cp config/wannatalk-bookings.env.example /etc/wannatalk-bookings.env
sudo chmod 600 /etc/wannatalk-bookings.env
sudo nano /etc/wannatalk-bookings.env
```

Set the PostgreSQL password and generate a JWT secret with:

```bash
openssl rand -hex 64
```

Do not paste the secret or database password into chat.

## 4. Install the API service

```bash
sudo cp systemd/wannatalk-bookings.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wannatalk-bookings
sudo systemctl status wannatalk-bookings --no-pager
curl http://127.0.0.1:3100/api/health
```

The health request should return JSON containing `"ok":true`.

## 5. Enable the Nginx site

```bash
sudo cp nginx/bookings.wannatalk.co.za /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/bookings.wannatalk.co.za /etc/nginx/sites-enabled/bookings.wannatalk.co.za
sudo nginx -t
sudo systemctl reload nginx
curl -I http://bookings.wannatalk.co.za
curl http://bookings.wannatalk.co.za/api/health
```

## 6. Enable HTTPS

After DNS resolves to this server and HTTP works:

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
sudo certbot --nginx -d bookings.wannatalk.co.za
sudo certbot renew --dry-run
```

## Useful checks

```bash
sudo journalctl -u wannatalk-bookings -n 100 --no-pager
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo systemctl status wannatalk-bookings --no-pager
```
