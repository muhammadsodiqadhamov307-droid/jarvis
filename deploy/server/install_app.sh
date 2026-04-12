#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/jarvis"
ARCHIVE="/tmp/jarvis-server.tar.gz"
UPLOADED_ENV="/tmp/jarvis.env"
DATABASE_URL_FILE="/home/ubuntu/.jarvis_database_url"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Missing deployment archive: $ARCHIVE" >&2
  exit 1
fi

sudo mkdir -p "$APP_DIR"
sudo tar -xzf "$ARCHIVE" -C "$APP_DIR"
sudo chown -R ubuntu:ubuntu "$APP_DIR"

if [[ -f "$UPLOADED_ENV" ]]; then
  cp "$UPLOADED_ENV" "$APP_DIR/.env"
elif [[ -f "$APP_DIR/.env" ]]; then
  true
else
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi

upsert_env() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')"
  if grep -q "^${key}=" "$APP_DIR/.env"; then
    sed -i "s/^${key}=.*/${key}=${escaped}/" "$APP_DIR/.env"
  else
    printf '%s=%s\n' "$key" "$value" >> "$APP_DIR/.env"
  fi
}

DATABASE_URL_VALUE="$(cat "$DATABASE_URL_FILE")"
upsert_env "NODE_ENV" "production"
upsert_env "JARVIS_SERVE_FRONTEND" "true"
upsert_env "DATABASE_PROVIDER" "postgres"
upsert_env "DATABASE_URL" "$DATABASE_URL_VALUE"
upsert_env "DATABASE_SSL" "false"
upsert_env "PORT" "3001"
upsert_env "FRONTEND_ORIGIN" "https://jarvis12345.duckdns.org"
upsert_env "USER_TIMEZONE" "Asia/Tashkent"

chmod 600 "$APP_DIR/.env"

cd "$APP_DIR/backend"
npm ci --omit=dev
node --check server.js
node --check db.js
node --check memory.js
node --check notes.js
node --check gemini.js

echo "APP_INSTALLED"
