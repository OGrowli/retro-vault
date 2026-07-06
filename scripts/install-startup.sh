#!/usr/bin/env bash
set -e

INSTALL_DIR="/home/pi/retro-vault"
SERVICE_FILE="/etc/systemd/system/retrovault-api.service"
AUTOSTART_FILE="/opt/retropie/configs/all/autostart.sh"
BASH_PROFILE="/home/pi/.bash_profile"

echo "==> Installing/updating RetroVault startup..."

# 0. Install X + kiosk dependencies (idempotent)
echo "Checking X and kiosk packages..."
PKGS_NEEDED=""
command -v Xorg   > /dev/null 2>&1 || PKGS_NEEDED="$PKGS_NEEDED xserver-xorg xinit x11-xserver-utils"
command -v unclutter > /dev/null 2>&1 || PKGS_NEEDED="$PKGS_NEEDED unclutter"
if ! command -v chromium-browser > /dev/null 2>&1 && ! command -v chromium > /dev/null 2>&1; then
  PKGS_NEEDED="$PKGS_NEEDED chromium-browser"
fi
if [ -n "$PKGS_NEEDED" ]; then
  echo "Installing:$PKGS_NEEDED"
  # shellcheck disable=SC2086
  sudo apt-get install -y $PKGS_NEEDED || sudo apt-get install -y $PKGS_NEEDED chromium
fi

# 1. Find Node.js binary
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  # NVM fallback
  NODE_BIN="$(find "$HOME/.nvm/versions/node" -maxdepth 3 -name node 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node not found. Install Node.js (or NVM) first." >&2
  exit 1
fi
echo "Node.js: $NODE_BIN"

# 2. Write systemd service with the correct node path
echo "Installing API systemd service..."
sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=RetroVault API
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
ExecStart=$NODE_BIN $INSTALL_DIR/packages/api/dist/index.js
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable retrovault-api
sudo systemctl restart retrovault-api || sudo systemctl start retrovault-api

# 3. Make kiosk scripts executable
chmod +x "$INSTALL_DIR/scripts/retrovault-kiosk.sh"
chmod +x "$INSTALL_DIR/scripts/launch-chromium.sh"

# 4. Configure console autologin for tty1 (idempotent)
echo "Configuring console autologin..."
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf > /dev/null << 'EOF'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin pi --noclear %I $TERM
EOF
sudo systemctl daemon-reload

# 5. Add kiosk launch to .bash_profile (idempotent, TTY1 only)
if ! grep -q 'RetroVault kiosk' "$BASH_PROFILE" 2>/dev/null; then
  echo "Adding kiosk autostart to $BASH_PROFILE..."
  cat >> "$BASH_PROFILE" << 'EOF'

# RetroVault kiosk — auto-launch on TTY1
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec /home/pi/retro-vault/scripts/retrovault-kiosk.sh
fi
EOF
fi

# 6. Also hook RetroPie autostart.sh as a fallback (foreground, no &)
echo "Configuring RetroPie autostart..."
sudo mkdir -p "$(dirname "$AUTOSTART_FILE")"
if [ -f "$AUTOSTART_FILE" ] && ! grep -q 'RetroVault' "$AUTOSTART_FILE" 2>/dev/null; then
  sudo cp "$AUTOSTART_FILE" "${AUTOSTART_FILE}.bak"
  echo "Backed up existing autostart to ${AUTOSTART_FILE}.bak"
fi
sudo tee "$AUTOSTART_FILE" > /dev/null << 'EOF'
#!/bin/bash
# RetroVault kiosk — launched by RetroPie autostart (foreground)
exec /home/pi/retro-vault/scripts/retrovault-kiosk.sh
EOF
sudo chmod +x "$AUTOSTART_FILE"

echo ""
echo "==> Startup install complete."
echo ""
echo "Useful commands:"
echo "  sudo systemctl status retrovault-api        # API status"
echo "  sudo journalctl -u retrovault-api -f        # API logs"
echo "  sudo systemctl restart retrovault-api       # restart API"
