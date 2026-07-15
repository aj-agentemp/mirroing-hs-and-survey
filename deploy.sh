#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  deploy.sh  — Deploy mirroing-hs-and-survey to 35.153.179.34
#
#  First-time setup:
#    ./deploy.sh --setup
#
#  Subsequent deploys (files + restart only):
#    ./deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

# ── Config ────────────────────────────────────────────────────────────────────
SERVER_IP="35.153.179.34"
REMOTE_USER="ubuntu"
REMOTE_DIR="/home/ubuntu/mirroing-hs-and-survey"
DOMAIN="mir.agentemp.com"
APP_PORT="9000"
PM2_NAME="mirror-survey"
SETUP_MODE=false

# ── Flags ─────────────────────────────────────────────────────────────────────
if [[ "$1" == "--setup" ]]; then
  SETUP_MODE=true
fi

# ── Prompt ────────────────────────────────────────────────────────────────────
read -rsp "  SSH password for ${REMOTE_USER}@${SERVER_IP}: " SSH_PASS
echo ""

# ── Check sshpass ─────────────────────────────────────────────────────────────
if ! command -v sshpass &> /dev/null; then
  echo ""
  echo "  ❌  sshpass is not installed."
  echo "      macOS:  brew install hudochenkov/sshpass/sshpass"
  exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
ssh_run() {
  sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no \
    "${REMOTE_USER}@${SERVER_IP}" "$@"
}
rsync_run() {
  sshpass -p "$SSH_PASS" rsync -az --delete \
    -e "ssh -o StrictHostKeyChecking=no" "$@"
}

echo ""
if $SETUP_MODE; then
  echo "═══════════════════════════════════════════════════════"
  echo "  🔧  FIRST-TIME SETUP  →  ${REMOTE_USER}@${SERVER_IP}"
  echo "═══════════════════════════════════════════════════════"
else
  echo "═══════════════════════════════════════════════════════"
  echo "  🚀  REDEPLOY  →  ${REMOTE_USER}@${SERVER_IP}"
  echo "═══════════════════════════════════════════════════════"
fi

# ════════════════════════════════════════════════════════
#  SETUP STEPS (first time only — ./deploy.sh --setup)
# ════════════════════════════════════════════════════════
if $SETUP_MODE; then

  echo ""
  echo "▶  [setup]  Installing Node.js 20, Nginx, PM2…"
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

  echo ""
  echo "▶  [setup]  Configuring Nginx for ${DOMAIN}…"
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
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
REMOTE
  echo "   ✓ done"

  echo ""
  read -rp "  Install SSL cert with Certbot? (DNS must point to ${SERVER_IP}) [y/N]: " DO_SSL
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
    echo "   ↷ SSL skipped — run later:  sudo certbot --nginx -d ${DOMAIN}"
  fi

fi   # end SETUP_MODE

# ════════════════════════════════════════════════════════
#  DEPLOY STEPS (always run)
# ════════════════════════════════════════════════════════

echo ""
echo "▶  1/3  Uploading files…"
ssh_run "mkdir -p ${REMOTE_DIR}"
rsync_run \
  --exclude='node_modules/' \
  --exclude='.git/' \
  ./ "${REMOTE_USER}@${SERVER_IP}:${REMOTE_DIR}/"
echo "   ✓ done"

echo ""
echo "▶  2/3  Installing dependencies…"
ssh_run "cd ${REMOTE_DIR} && npm install --omit=dev"
echo "   ✓ done"

echo ""
echo "▶  3/3  Copying .env & restarting PM2…"
if [ -f ".env" ]; then
  sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
    .env "${REMOTE_USER}@${SERVER_IP}:${REMOTE_DIR}/.env"
  echo "   ✓ .env copied"
else
  echo "   ⚠️  No local .env found"
fi

ssh_run bash <<REMOTE
cd ${REMOTE_DIR}
if pm2 list | grep -q "${PM2_NAME}"; then
  pm2 restart ${PM2_NAME}
else
  pm2 start server.js --name ${PM2_NAME}
  pm2 save
  pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null || true
fi
REMOTE
echo "   ✓ done"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅  Done!"
echo ""
echo "  Health:  curl http://${SERVER_IP}:${APP_PORT}/health"
if $SETUP_MODE; then
  echo "  Domain:  curl https://${DOMAIN}/health"
fi
echo "  Logs:    ssh ${REMOTE_USER}@${SERVER_IP} 'pm2 logs ${PM2_NAME}'"
echo "═══════════════════════════════════════════════════════"
