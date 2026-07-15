#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  deploy.sh  —  Deploy mirroing-hs-and-survey to production
#
#  Regular deploy (upload + install + restart):
#    ./deploy.sh
#
#  First-time server setup (Node, Nginx, PM2, optional SSL):
#    ./deploy.sh --setup
# ─────────────────────────────────────────────────────────────────────────────
set -e

# ── Config ───────────────────────────────────────────────────────────────────
SERVER_IP="35.153.179.34"
REMOTE_USER="ubuntu"
REMOTE_DIR="/home/ubuntu/mirroing-hs-and-survey"
DOMAIN="mir.agentemp.com"
APP_PORT="9000"
PM2_NAME="mirror-survey"

# ── Parse args ───────────────────────────────────────────────────────────────
SETUP_MODE=false
[[ "$1" == "--setup" ]] && SETUP_MODE=true

# ── Check sshpass ────────────────────────────────────────────────────────────
if ! command -v sshpass &>/dev/null; then
  echo "❌  sshpass not found.  Install: brew install hudochenkov/sshpass/sshpass"
  exit 1
fi

# ── Auth ─────────────────────────────────────────────────────────────────────
read -rsp "SSH password for ${REMOTE_USER}@${SERVER_IP}: " SSH_PASS
echo ""

# ── Helpers ───────────────────────────────────────────────────────────────────
ssh_run()   { sshpass -p "$SSH_PASS" ssh  -o StrictHostKeyChecking=no "${REMOTE_USER}@${SERVER_IP}" "$@"; }
rsync_run() { sshpass -p "$SSH_PASS" rsync -az --delete -e "ssh -o StrictHostKeyChecking=no" "$@"; }
scp_run()   { sshpass -p "$SSH_PASS" scp  -o StrictHostKeyChecking=no "$@"; }

# ════════════════════════════════════════════════════════════════
#  FIRST-TIME SETUP  (./deploy.sh --setup)
# ════════════════════════════════════════════════════════════════
if $SETUP_MODE; then
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  🔧  FIRST-TIME SETUP  →  ${REMOTE_USER}@${SERVER_IP}"
  echo "═══════════════════════════════════════════════════════"

  echo ""
  echo "▶  Installing Node.js 20, Nginx, PM2…"
  ssh_run bash <<'REMOTE'
set -e
command -v node &>/dev/null || {
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
}
command -v nginx &>/dev/null || sudo apt-get install -y nginx
command -v pm2   &>/dev/null || sudo npm install -g pm2
REMOTE
  echo "   ✓ done"

  echo ""
  echo "▶  Configuring Nginx reverse proxy for ${DOMAIN}…"
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
sudo ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
REMOTE
  echo "   ✓ done"

  echo ""
  read -rp "Install SSL cert with Certbot? (DNS must point to ${SERVER_IP}) [y/N]: " DO_SSL
  if [[ "$DO_SSL" =~ ^[Yy]$ ]]; then
    ssh_run bash <<REMOTE
command -v certbot &>/dev/null || sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos \
  -m admin@agentemp.com --redirect
REMOTE
    echo "   ✓ SSL installed"
  else
    echo "   ↷ SSL skipped — run later: sudo certbot --nginx -d ${DOMAIN}"
  fi

  echo ""
  echo "   Setup complete. Run ./deploy.sh to deploy the code."
  exit 0
fi

# ════════════════════════════════════════════════════════════════
#  REGULAR DEPLOY
# ════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  🚀  DEPLOY  →  ${REMOTE_USER}@${SERVER_IP}"
echo "═══════════════════════════════════════════════════════"

# 1. Ensure remote dir exists
ssh_run "mkdir -p ${REMOTE_DIR}"

# 2. Upload code (exclude node_modules and .git)
echo ""
echo "▶  1/4  Uploading files…"
rsync_run \
  --exclude='node_modules/' \
  --exclude='.git/' \
  ./ "${REMOTE_USER}@${SERVER_IP}:${REMOTE_DIR}/"
echo "   ✓ done"

# 3. Copy .env files
echo ""
echo "▶  2/4  Copying .env files…"
for envfile in .env .env.production .env.local; do
  if [ -f "$envfile" ]; then
    scp_run "$envfile" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_DIR}/$envfile"
    echo "   ✓ $envfile copied"
  fi
done

# 4. Install dependencies
echo ""
echo "▶  3/4  Installing dependencies…"
ssh_run "cd ${REMOTE_DIR} && npm install --omit=dev"
echo "   ✓ done"

# 5. Restart or start PM2
echo ""
echo "▶  4/4  Restarting PM2 (${PM2_NAME})…"
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
echo "  ✅  Deploy complete!"
echo ""
echo "  Health:  curl https://${DOMAIN}/health"
echo "  Logs:    ssh ${REMOTE_USER}@${SERVER_IP} 'pm2 logs ${PM2_NAME}'"
echo "═══════════════════════════════════════════════════════"
