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

# pam_systemd moves the kiosk session (X, Chromium) into its own session
# scope, so stopping getty does not kill it — and while anything still has
# tty1 as its controlling terminal, openvt aborts with "vt 1 is in use".
# Terminate the session processes and wait for the VT to come free.
sudo pkill -TERM -t tty1 2>/dev/null
for _ in $(seq 1 20); do
  [ -z "$(ps -t tty1 -o pid=)" ] && break
  sleep 0.5
done
sudo pkill -KILL -t tty1 2>/dev/null

if [ -f "$RUNCOMMAND" ]; then
  # -f: systemd-logind keeps /dev/tty1 open for VT tracking, so the VT always
  # looks "in use" to openvt even once the kiosk session is dead.
  sudo openvt -c 1 -s -w -f -- bash "$RUNCOMMAND" 0 _SYS_ "$SYSTEM" "$ROM"
  RC=$?
elif [ -n "$CORE" ]; then
  RETROARCH="$(command -v retroarch || echo /opt/retropie/emulators/retroarch/bin/retroarch)"
  sudo openvt -c 1 -s -w -f -- "$RETROARCH" -L "$CORE" "$ROM"
  RC=$?
else
  echo "ERROR: no runcommand.sh and no core path given — cannot launch"
  exit 1
fi

echo "=== $(date -Is) game exited (code $RC)"
exit "$RC"
