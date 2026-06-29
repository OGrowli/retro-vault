#!/usr/bin/env bash
set -e

INSTALL_DIR="/home/pi/retro-vault"
SERVICE_FILE="/etc/systemd/system/retrovault-api.service"
AUTOSTART_FILE="/opt/retropie/configs/all/autostart.sh"

echo "==> Installing RetroVault startup..."

# 1. Install systemd service for the API
echo "Installing API systemd service..."
sudo cp "$INSTALL_DIR/scripts/retrovault-api.service" "$SERVICE_FILE"
sudo systemctl daemon-reload
sudo systemctl enable retrovault-api
sudo systemctl start retrovault-api

# 2. Make kiosk script executable
chmod +x "$INSTALL_DIR/scripts/retrovault-kiosk.sh"

# 3. Hook into RetroPie autostart
echo "Configuring RetroPie autostart..."
sudo mkdir -p "$(dirname "$AUTOSTART_FILE")"

# Backup existing autostart if present
if [ -f "$AUTOSTART_FILE" ]; then
  sudo cp "$AUTOSTART_FILE" "${AUTOSTART_FILE}.bak"
  echo "Backed up existing autostart to ${AUTOSTART_FILE}.bak"
fi

sudo tee "$AUTOSTART_FILE" > /dev/null << 'EOF'
#!/bin/bash
# RetroVault kiosk — launched by RetroPie autostart
/home/pi/retro-vault/scripts/retrovault-kiosk.sh &
EOF

sudo chmod +x "$AUTOSTART_FILE"

echo ""
echo "Done. RetroVault will launch on next boot."
echo ""
echo "Useful commands:"
echo "  sudo systemctl status retrovault-api   # check API status"
echo "  sudo systemctl restart retrovault-api  # restart API"
echo "  sudo journalctl -u retrovault-api -f   # tail API logs"
echo "  sudo systemctl disable retrovault-api  # uninstall autostart"
