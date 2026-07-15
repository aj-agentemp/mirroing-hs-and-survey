# Deploy to Ubuntu — mir.agentemp.com

## TL;DR — Just run the script
```bash
./deploy.sh
# enter server IP and SSH password when prompted
```
The script handles everything: installs deps, uploads files, copies `.env`, starts PM2, configures Nginx, and optionally installs SSL.

---

## Prerequisites (one time, on your local machine)

### 1. Install `sshpass`
```bash
# macOS
brew install hudochenkov/sshpass/sshpass

# Ubuntu/Debian
sudo apt-get install -y sshpass
```

### 2. Make the script executable
```bash
chmod +x deploy.sh
```

### 3. Point DNS
Add an **A record** for `mir.agentemp.com` → your EC2 public IP (TTL 60).

---

## What `deploy.sh` does

| Step | Action |
|------|--------|
| 1 | Installs Node.js 20, Nginx, PM2 on the server (skips if already installed) |
| 2 | Rsyncs all project files (excludes `node_modules/`, `.git/`) |
| 3 | Runs `npm install --omit=dev` on the server |
| 4 | Copies your local `.env` → server via `scp` |
| 5 | Starts or restarts the PM2 process (`mirror-survey`) |
| 6 | Writes Nginx config for `mir.agentemp.com → localhost:9000` |
| ✨ | Optionally installs SSL via Certbot (answer `y` when prompted) |

---

## Future re-deploys
```bash
./deploy.sh
# same command — it will restart PM2 with updated files
```

---

## Useful commands (on the server)
```bash
pm2 logs mirror-survey       # live logs
pm2 status                   # process list
pm2 restart mirror-survey    # restart
pm2 stop mirror-survey       # stop

# Re-issue SSL cert (if needed)
sudo certbot renew
```

---

## Available ports on this AWS instance
| Port | Use |
|------|-----|
| 9000 | **This app** (Node.js) |
| 8765 | Spare |
| 38117 | Spare |
| 38111 | Spare |
| 80 / 443 | Nginx (HTTP / HTTPS) |
| 22 | SSH |
