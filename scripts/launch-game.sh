#!/usr/bin/env bash
# Launch a game with exclusive console access.
#
# The API runs as a systemd service with no TTY, and the kiosk (X + Chromium)
# owns the display — an emulator spawned directly has nowhere to render.
# So: stop the kiosk's getty session (kills X), run the game on tty1 via
# openvt, then restart getty — autologin + .bash_profile bring the kiosk back.
#
# Usage: launch-game.sh <system> <rom_path> [core_path]
# Logs:  ~/.retrovault/launch.log

LOG="$HOME/.retrovault/launch.log"
mkdir -p "$(dirname "$LOG")"
exec >> "$LOG" 2>&1

SYSTEM="$1"
ROM="$2"
CORE="${3:-}"
RUNCOMMAND="/opt/retropie/supplementary/runcommand/runcommand.sh"

echo "=== $(date -Is) launching [$SYSTEM] $ROM"

restore_kiosk() {
  echo "=== $(date -Is) restoring kiosk"
  sudo systemctl start getty@tty1
}
trap restore_kiosk EXIT

# Free the display. Autologin re-runs the kiosk when getty comes back.
sudo systemctl stop getty@tty1
sleep 1

if [ -f "$RUNCOMMAND" ]; then
  sudo openvt -c 1 -s -w -- bash "$RUNCOMMAND" 0 _SYS_ "$SYSTEM" "$ROM"
  RC=$?
elif [ -n "$CORE" ]; then
  RETROARCH="$(command -v retroarch || echo /opt/retropie/emulators/retroarch/bin/retroarch)"
  sudo openvt -c 1 -s -w -- "$RETROARCH" -L "$CORE" "$ROM"
  RC=$?
else
  echo "ERROR: no runcommand.sh and no core path given — cannot launch"
  exit 1
fi

echo "=== $(date -Is) game exited (code $RC)"
exit "$RC"
