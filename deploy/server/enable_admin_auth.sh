#!/usr/bin/env bash
set -euo pipefail

ADMIN_USER="${JARVIS_ADMIN_USER:-admin}"
ADMIN_PASSWORD="${JARVIS_ADMIN_PASSWORD:-$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 24)}"
HTPASSWD_FILE="/etc/nginx/.jarvis_htpasswd"
NGINX_SITE="/etc/nginx/sites-available/jarvis"
PASSWORD_FILE="/home/ubuntu/jarvis_admin_password.txt"

HASH="$(openssl passwd -apr1 "$ADMIN_PASSWORD")"
printf '%s:%s\n' "$ADMIN_USER" "$HASH" | sudo tee "$HTPASSWD_FILE" >/dev/null
sudo chown root:www-data "$HTPASSWD_FILE"
sudo chmod 640 "$HTPASSWD_FILE"

sudo cp "$NGINX_SITE" "${NGINX_SITE}.bak.$(date +%Y%m%d%H%M%S)"

if ! sudo grep -q 'auth_basic "JARVIS Admin";' "$NGINX_SITE"; then
  sudo sed -i '/client_max_body_size 20m;/a\
    auth_basic "JARVIS Admin";\
    auth_basic_user_file /etc/nginx/.jarvis_htpasswd;' "$NGINX_SITE"
fi

sudo nginx -t
sudo systemctl reload nginx

printf '%s\n' "$ADMIN_PASSWORD" > "$PASSWORD_FILE"
chmod 600 "$PASSWORD_FILE"

echo "JARVIS_ADMIN_USER=$ADMIN_USER"
echo "JARVIS_ADMIN_PASSWORD=$ADMIN_PASSWORD"
echo "ADMIN_AUTH_ENABLED"
