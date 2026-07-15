# Deployment Guide — mir.agentemp.com

---

## Step 1 — Set the subdomain (DNS)

1. Log in to wherever `agentemp.com` DNS is managed (e.g. Cloudflare, Route 53, GoDaddy).
2. Add an **A record**:
   - **Name:** `mir`
   - **Value:** your EC2 public IP address
   - **TTL:** 60 (or Auto)
3. Wait 1–5 minutes for DNS to propagate.

Verify:
```bash
ping mir.agentemp.com
# should resolve to your EC2 IP
```

---

## Step 2 — SSH into the server

```bash
ssh ubuntu@35.153.179.34
# enter your SSH password when prompted
```

---

## Step 3 — Install Node.js 20 + PM2 + Nginx (first time only)

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 (process manager — keeps the app alive & restarts on reboot)
sudo npm install -g pm2

# Nginx (reverse proxy — maps mir.agentemp.com → localhost:9000)
sudo apt-get install -y nginx
```

---

## Step 4 — Deploy using the script (from your local machine)

> **Prerequisite:** `sshpass` must be installed locally.
> ```bash
> # macOS
> brew install hudochenkov/sshpass/sshpass
> ```

### First-time setup (installs Node, Nginx, PM2, configures subdomain + SSL)
```bash
chmod +x deploy.sh
./deploy.sh --setup
```

### Every deploy after that (fast — files + .env + PM2 restart only)
```bash
./deploy.sh
```

Both commands will only ask for the **SSH password** (IP `35.153.179.34` is hardcoded).

`--setup` additionally:
1. Installs Node.js 20, Nginx, PM2 on the server
2. Writes the Nginx config for `mir.agentemp.com → localhost:9000`
3. Optionally installs a free SSL cert via Certbot

**Normal redeploy** only does:
1. Rsyncs changed project files
2. Runs `npm install --omit=dev`
3. Copies your local `.env` to the server
4. Restarts the PM2 process `mirror-survey`

---

## Step 5 — Configure Nginx (if not using the script)

SSH into the server and run:

```bash
sudo nano /etc/nginx/sites-available/mir.agentemp.com
```

Paste this config:
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
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable it:
```bash
sudo ln -s /etc/nginx/sites-available/mir.agentemp.com \
           /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## Step 6 — Start the server with PM2 (if not using the script)

```bash
cd /home/ubuntu/mirroing-hs-and-survey
pm2 start server.js --name mirror-survey
pm2 save

# Make PM2 start on reboot — run the command it prints:
pm2 startup
```

---

## Step 7 — Enable HTTPS with a free SSL cert

> DNS must already be pointing to this server before this step.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mir.agentemp.com
# follow the prompts — choose "Redirect" when asked
```

Certbot auto-renews. Verify:
```bash
curl https://mir.agentemp.com/health
# → {"status":"ok","service":"ghl-survey-mirror",...}
```

---

## Future deploys (updates)

From your local machine, just run the script again:
```bash
./deploy.sh
```
It will rsync only changed files and restart PM2.

Or manually on the server:
```bash
cd /home/ubuntu/mirroing-hs-and-survey
# upload new files manually, then:
pm2 restart mirror-survey
```

---

## Useful server commands

```bash
pm2 logs mirror-survey       # live app logs
pm2 status                   # running processes
pm2 restart mirror-survey    # restart app
pm2 stop mirror-survey       # stop app

sudo systemctl status nginx  # check Nginx
sudo nginx -t                # test Nginx config
sudo systemctl reload nginx  # reload Nginx after config changes

sudo certbot renew           # manually renew SSL cert
```

---

## Available open ports (AWS security group)

| Port | Purpose |
|------|---------|
| 9000 | **Node.js app** (internal, proxied by Nginx) |
| 8765 | Spare |
| 38117 | Spare |
| 38111 | Spare |
| 80 | HTTP (Nginx) |
| 443 | HTTPS (Nginx + SSL) |
| 22 | SSH |
