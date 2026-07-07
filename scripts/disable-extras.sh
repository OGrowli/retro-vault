#!/usr/bin/env bash
set -e

# Disable non-essential services that eat RAM on the Pi 3B+ kiosk.
# Run on the Pi: bash scripts/disable-extras.sh

SERVICES=(bluetooth triggerhappy avahi-daemon hciuart)

echo "==> Disabling non-essential services..."
for svc in "${SERVICES[@]}"; do
  if systemctl list-unit-files | grep -q "^${svc}.service"; then
    sudo systemctl disable --now "$svc" 2>/dev/null || true
    echo "Disabled: $svc"
  else
    echo "Skipped (not present): $svc"
  fi
done
