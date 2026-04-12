#!/usr/bin/env bash
set -euo pipefail

PASS="$(openssl rand -hex 32)"

sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'jarvis') THEN
    ALTER ROLE jarvis WITH LOGIN PASSWORD '${PASS}';
  ELSE
    CREATE ROLE jarvis WITH LOGIN PASSWORD '${PASS}';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'jarvis'" | grep -q 1; then
  sudo -u postgres createdb -O jarvis jarvis
fi

sudo -u postgres psql -d jarvis <<SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT ALL ON DATABASE jarvis TO jarvis;
GRANT ALL ON SCHEMA public TO jarvis;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO jarvis;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO jarvis;
SQL

printf 'postgresql://jarvis:%s@localhost:5432/jarvis\n' "$PASS" > /home/ubuntu/.jarvis_database_url
chmod 600 /home/ubuntu/.jarvis_database_url
sudo systemctl enable --now postgresql

echo "POSTGRES_READY"
