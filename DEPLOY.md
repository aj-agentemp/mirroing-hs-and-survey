# Deploy to Ubuntu — mir.agentemp.com

## 0. DNS
Point `mir.agentemp.com` → your EC2 public IP (A record, TTL 60).

---

## 1. SSH into the server
```bash
ssh ubuntu@<YOUR_EC2_PUBLIC_IP>
# enter password when prompted
```

---

## 2. Install Node.js + PM2 + Nginx (first time only)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2
```

---

## 3. Add GitHub deploy key (first time only)
```bash
ssh-keygen -t ed25519 -C "deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
# → copy the output, add it as a Deploy Key in:
# GitHub → mirroing-hs-and-survey → Settings → Deploy keys
```

---

## 4. Clone & configure
```bash
cd /home/ubuntu
git clone git@github.com:aj-agentemp/mirroing-hs-and-survey.git
cd mirroing-hs-and-survey

npm install

# Create .env from example, then fill YOUR values
cp .env.example .env
nano .env
# ── must set ──────────────────────────────────────────
# PORT=9000
# NODE_ENV=production
# OTHER_SERVER_BASE_URL=https://...
# OTHER_SERVER_SESSION_INIT_PATH=...
# OTHER_SERVER_OTP_SUBMIT_PATH=...
# INTERNAL_API_SECRET=<strong random string>
# SERVER_PUBLIC_URL=https://mir.agentemp.com
# CORS_ALLOWED_ORIGINS=https://link.msgsndr.com,https://api.leadconnectorhq.com
# (AWS keys are already in .env.example — update if needed)
```

---

## 5. Start with PM2
```bash
pm2 start server.js --name mirror-survey
pm2 save
pm2 startup   # copy & run the printed command to survive reboots
```

---

## 6. Nginx reverse proxy
```bash
sudo nano /etc/nginx/sites-available/mir.agentemp.com
```
Paste:
```nginx
server {
    listen 80;
    server_name mir.agentemp.com;

    location / {
        proxy_pass         http://localhost:9000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/mir.agentemp.com \
           /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7. SSL (HTTPS) with Certbot
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mir.agentemp.com
# follow prompts — auto-renews via cron
```

---

## 8. Verify
```bash
curl https://mir.agentemp.com/health
# → {"status":"ok","service":"ghl-survey-mirror",...}
```

---

## Updates (future deploys)
```bash
cd /home/ubuntu/mirroing-hs-and-survey
git pull
npm install          # only if package.json changed
pm2 restart mirror-survey
```

---

## Useful PM2 commands
```bash
pm2 logs mirror-survey       # live logs
pm2 status                   # running processes
pm2 restart mirror-survey    # restart
pm2 stop mirror-survey       # stop
```
