#!/usr/bin/env bash
set -euo pipefail

SITE="/etc/nginx/sites-available/jarvis"

if [[ ! -f "$SITE" ]]; then
  echo "Missing Nginx site: $SITE" >&2
  exit 1
fi

if sudo grep -q "location \^~ /api/agent/" "$SITE"; then
  echo "AGENT_ROUTE_EXISTS"
else
  sudo cp "$SITE" "${SITE}.agent-route.bak.$(date +%Y%m%d%H%M%S)"
  sudo python3 - "$SITE" <<'PY'
from pathlib import Path
import sys

site = Path(sys.argv[1])
text = site.read_text()
route = """    location ^~ /api/agent/ {
        auth_basic off;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

"""

marker = "    client_max_body_size 20m;\n\n"
if marker in text:
    text = text.replace(marker, marker + route, 1)
else:
    location = "    location / {"
    text = text.replace(location, route + location, 1)
site.write_text(text)
PY
  echo "AGENT_ROUTE_ADDED"
fi

sudo nginx -t
sudo systemctl reload nginx
echo "NGINX_RELOADED"
