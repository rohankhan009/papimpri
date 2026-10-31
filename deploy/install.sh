#!/usr/bin/env bash
###############################################################################
# SMS Lead Blaster — One-shot Ubuntu VPS installer
# Tested on: Ubuntu 22.04 / 24.04 (fresh server, run as root or with sudo)
#
# USAGE:
#   1) Copy the WHOLE project folder to your VPS (git clone OR scp).
#   2) cd into the project root (the folder that has /backend and /frontend).
#   3) Run:   sudo bash deploy/install.sh yourdomain.com
#      - Pass your domain (e.g. app.example.com) OR your server's public IP.
#      - If you pass a domain, SSL (https) is set up automatically via certbot.
###############################################################################
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "❌ Please pass your domain or server IP:  sudo bash deploy/install.sh yourdomain.com"
  exit 1
fi

# Resolve project root = parent of this script's folder
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$APP_ROOT/backend"
FRONTEND_DIR="$APP_ROOT/frontend"
SERVICE_USER="${SUDO_USER:-root}"

echo "==> Project root : $APP_ROOT"
echo "==> Domain/IP    : $DOMAIN"

# Is it a domain (letters) or a bare IP?
if [[ "$DOMAIN" =~ ^[0-9.]+$ ]]; then IS_IP=1; SCHEME="http"; else IS_IP=0; SCHEME="https"; fi
PUBLIC_URL="$SCHEME://$DOMAIN"

############################ 1. System packages ###############################
echo "==> Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl gnupg ca-certificates lsb-release software-properties-common \
                   python3 python3-venv python3-pip nginx

############################ 2. Node.js + Yarn ################################
if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
corepack enable || npm install -g yarn || true

############################ 3. MongoDB ######################################
if ! command -v mongod >/dev/null 2>&1; then
  echo "==> Installing MongoDB 7..."
  curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
  UBU_CODENAME="$(lsb_release -cs)"
  # MongoDB repo uses jammy for 22.04 and noble for 24.04
  case "$UBU_CODENAME" in
    noble) REPO_CN="noble";;
    jammy) REPO_CN="jammy";;
    *)     REPO_CN="jammy";;
  esac
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${REPO_CN}/mongodb-org/7.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-7.0.list
  apt-get update -y
  apt-get install -y mongodb-org
fi
systemctl enable --now mongod

############################ 4. Backend setup #################################
echo "==> Setting up Python backend..."
cd "$BACKEND_DIR"
python3 -m venv venv
# shellcheck disable=SC1091
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

# Create backend/.env if missing (keeps existing secret if present)
if [ ! -f "$BACKEND_DIR/.env" ]; then
  JWT="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
  cat > "$BACKEND_DIR/.env" <<EOF
MONGO_URL="mongodb://localhost:27017"
DB_NAME="leadblaster"
CORS_ORIGINS="$PUBLIC_URL"
JWT_SECRET=$JWT
EOF
  echo "==> Wrote backend/.env (new JWT secret generated)"
else
  echo "==> backend/.env already exists — leaving it as is"
fi

############################ 5. Frontend build ###############################
echo "==> Building React frontend..."
cd "$FRONTEND_DIR"
# Frontend must call the backend through this public URL (/api is proxied by nginx)
echo "REACT_APP_BACKEND_URL=$PUBLIC_URL" > "$FRONTEND_DIR/.env"
yarn install --frozen-lockfile || yarn install
yarn build

############################ 6. systemd service ##############################
echo "==> Creating systemd service for the backend (single worker)..."
cat > /etc/systemd/system/leadblast.service <<EOF
[Unit]
Description=SMS Lead Blaster API (FastAPI)
After=network.target mongod.service
Wants=mongod.service

[Service]
Type=simple
User=root
WorkingDirectory=$BACKEND_DIR
# IMPORTANT: single worker — background blast tasks live in-process.
ExecStart=$BACKEND_DIR/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001 --workers 1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now leadblast
systemctl restart leadblast

############################ 7. Nginx ########################################
echo "==> Configuring Nginx..."
cat > /etc/nginx/sites-available/leadblast <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    # React build (static files)
    root $FRONTEND_DIR/build;
    index index.html;

    # API -> FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    # SPA routing — everything else -> index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    client_max_body_size 20M;
}
EOF

ln -sf /etc/nginx/sites-available/leadblast /etc/nginx/sites-enabled/leadblast
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

############################ 8. SSL (domains only) ###########################
if [ "$IS_IP" -eq 0 ]; then
  echo "==> Setting up HTTPS (Let's Encrypt)..."
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" --redirect || \
    echo "⚠️  Certbot failed (DNS not pointed to this server yet?). App still works on http://$DOMAIN"
fi

echo ""
echo "============================================================"
echo "✅ DONE!  Open:  $PUBLIC_URL"
echo "   First open -> 'Create Admin' screen (set username+password)."
echo ""
echo "Useful commands:"
echo "   systemctl status leadblast     # backend status"
echo "   journalctl -u leadblast -f     # backend logs (live)"
echo "   systemctl restart leadblast    # restart backend"
echo "   systemctl restart nginx        # restart web server"
echo "============================================================"
