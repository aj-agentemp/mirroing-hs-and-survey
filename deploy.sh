#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  deploy.sh  — Deploy mirroing-hs-and-survey to Ubuntu via password SSH
#  Usage (run from your local machine inside this project folder):
#    chmod +x deploy.sh
#    ./deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

# ── Config ────────────────────────────────────────────────────────────────────
REMOTE_USER="ubuntu"
REMOTE_DIR="/home/ubuntu/mirroing-hs-and-survey"
DOMAIN="mir.agentemp.com"
APP_PORT="9000"
PM2_NAME="mirror-survey"

# ── Prompt ────────────────────────────────────────────────────────────────────
read -rp "  Server IP or hostname: " SERVER_IP
read -rsp "  SSH password: " SSH_PASS
echo ""

# ── Check sshpass is available ─────────────────────────────────────────────────
if ! command -v sshpass &> /dev/null; then
  echo ""
  echo "  ❌  sshpass is not installed."
  echo "      macOS:  brew install hudochenkov/sshpass/sshpass"
  echo "      Ubuntu: sudo apt-get install -y sshpass"
  exit 1
fi

# Helpers
ssh_run() {
  sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no \
    "${REMOTE_USER}@${SERVER_IP}" "$@"
}

scp_run() {
  sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no -r "$@"
}

rsync_run() {
  sshpass -p "$SSH_PASS" rsync -avz --delete \
    -e "ssh -o StrictHostKeyChecking=no" "$@"
}

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Deploying to ${REMOTE_USER}@${SERVER_IP}  →  ${DOMAIN}"
echo "═══════════════════════════════════════════════════════"

# ── Step 1: Install deps on server (idempotent) ───────────────────────────────
echo ""
echo "▶  1/6  Installing Node.js 20, Nginx, PM2 (if not already installed)…"
ssh_run bash <<'REMOTE'
set -e
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
if ! command -v nginx &>/dev/null; then
  sudo apt-get install -y nginx
fi
if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
fi
REMOTE
echo "   ✓ done"

# ── Step 2: Sync project files (excludes node_modules + .git) ────────────────
echo ""
echo "▶  2/6  Uploading project files…"
ssh_run "mkdir -p ${REMOTE_DIR}"
rsync_run \
  --exclude='node_modules/' \
  --exclude='.git/' \
  ./ "${REMOTE_USER}@${SERVER_IP}:${REMOTE_DIR}/"
echo "   ✓ done"

# ── Step 3: npm install on server ─────────────────────────────────────────────
echo ""
echo "▶  3/6  Installing npm dependencies on server…"
ssh_run "cd ${REMOTE_DIR} && npm install --omit=dev"
echo "   ✓ done"

# ── Step 4: Copy .env to server ───────────────────────────────────────────────
echo ""
echo "▶  4/6  Copying .env to server…"
if [ -f ".env" ]; then
  sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
    .env "${REMOTE_USER}@${SERVER_IP}:${REMOTE_DIR}/.env"
  echo "   ✓ .env copied"
else
  echo "   ⚠️  No local .env found — skipping (server will use existing .env if present)"
fi

# ── Step 5: Start / restart PM2 ───────────────────────────────────────────────
echo ""
echo "▶  5/6  Starting PM2 process…"
ssh_run bash <<REMOTE
cd ${REMOTE_DIR}
if pm2 list | grep -q "${PM2_NAME}"; then
  pm2 restart ${PM2_NAME}
else
  pm2 start server.js --name ${PM2_NAME}
fi
pm2 save
# Enable PM2 to start on boot (ignore output — user may need to run the printed command)
pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null || true
REMOTE
echo "   ✓ done"

# ── Step 6: Nginx config ───────────────────────────────────────────────────────
echo ""
echo "▶  6/6  Configuring Nginx for ${DOMAIN}…"
ssh_run bash <<REMOTE
sudo tee /etc/nginx/sites-available/${DOMAIN} > /dev/null <<'NGINX'
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass         http://localhost:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/${DOMAIN} \
            /etc/nginx/sites-enabled/${DOMAIN}

# Remove default Nginx site if present
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t && sudo systemctl reload nginx
REMOTE
echo "   ✓ done"

# ── SSL (optional — requires DNS to be pointing already) ──────────────────────
echo ""
read -rp "  Install SSL cert with Certbot? (DNS must already point to this IP) [y/N]: " DO_SSL
if [[ "$DO_SSL" =~ ^[Yy]$ ]]; then
  ssh_run bash <<REMOTE
if ! command -v certbot &>/dev/null; then
  sudo apt-get install -y certbot python3-certbot-nginx
fi
sudo certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos \
  -m admin@agentemp.com --redirect
REMOTE
  echo "   ✓ SSL installed"
else
  echo "   ↷ Skipped — run later: sudo certbot --nginx -d ${DOMAIN}"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅  Deploy complete!"
echo ""
echo "  Health check:"
PROTO="http"
[[ "$DO_SSL" =~ ^[Yy]$ ]] && PROTO="https"
echo "    curl ${PROTO}://${DOMAIN}/health"
echo ""
echo "  Server logs:"
echo "    ssh ${REMOTE_USER}@${SERVER_IP}"
echo "    pm2 logs ${PM2_NAME}"
echo ""
echo "  ⚠️  If .env was just created, edit it then run:"
echo "    pm2 restart ${PM2_NAME}"
echo "═══════════════════════════════════════════════════════"
