#!/usr/bin/env bash
set -euo pipefail

systemctl disable --now airview-aihot.service || true
rm -f /etc/nginx/sites-enabled/aihot.muchu.cloud
nginx -t
systemctl reload nginx

echo "Rolled back aihot.muchu.cloud route and stopped airview-aihot.service."
