#!/usr/bin/env bash
# Launch a Doom source port with exclusive console access.
#
# Same display dance as launch-game.sh: the API has no TTY and the kiosk
# (X + Chromium) owns the screen, so stop getty@tty1 to free the display, run
# the port on tty1 via openvt, then restart getty — autologin + .bash_profile
# bring the kiosk back. Because the API sets NO resume hint for Doom, the
# relaunched kiosk boots to the landing/choice screen.
#
# Usage:
#   launch-doom.sh iwad            # default IWAD, no custom WAD
#   launch-doom.sh wad <file>      # custom PWAD from $DOOM_DIR on top of an IWAD
#   launch-doom.sh online          # jump to the online server browser
# Logs: ~/.retrovault/doom.log

LOG="$HOME/.retrovault/doom.log"
mkdir -p "$(dirname "$LOG")"
exec >> "$LOG" 2>&1

MODE="${1:-iwad}"
WAD="${2:-}"

DOOM_DIR="${RETROVAULT_DOOM_DIR:-/home/pi/RetroPie/roms/doom}"

echo "=== $(date -Is) doom launch mode=$MODE wad=$WAD"

restore_kiosk() {
  echo "=== $(date -Is) restoring kiosk"
  sudo systemctl start getty@tty1
}
trap restore_kiosk EXIT

# --- resolve the local port binary (LZDoom is the ARM/GLES2-friendly choice) ---
# Override with DOOM_PORT_BIN. Search PATH first, then RetroPie's ports install.
find_port() {
  if [ -n "$DOOM_PORT_BIN" ] && [ -x "$DOOM_PORT_BIN" ]; then echo "$DOOM_PORT_BIN"; return; fi
  for c in lzdoom gzdoom dsda-doom prboom-plus chocolate-doom; do
    p="$(command -v "$c" 2>/dev/null)" && { echo "$p"; return; }
    for d in /opt/retropie/ports/lzdoom /opt/retropie/ports/gzdoom /opt/retropie/ports/dsda-doom; do
      [ -x "$d/$c" ] && { echo "$d/$c"; return; }
    done
  done
}

# --- auto-detect an IWAD in $DOOM_DIR (case-insensitive on the known names) ---
find_iwad() {
  for n in doom2.wad DOOM2.WAD doom.wad DOOM.WAD freedoom2.wad freedoom1.wad \
           tnt.wad plutonia.wad heretic.wad hexen.wad strife1.wad chex.wad; do
    [ -f "$DOOM_DIR/$n" ] && { echo "$DOOM_DIR/$n"; return; }
  done
}

run_local() {
  local port iwad
  port="$(find_port)"
  if [ -z "$port" ]; then
    echo "ERROR: no Doom port binary found. Install one (e.g. lzdoom via RetroPie-Setup) or set DOOM_PORT_BIN."
    exit 1
  fi
  iwad="$(find_iwad)"
  if [ -z "$iwad" ]; then
    echo "ERROR: no IWAD in $DOOM_DIR (drop doom2.wad / freedoom2.wad there)."
    exit 1
  fi
  local args=(-iwad "$iwad" -fullscreen)
  if [ -n "$WAD" ]; then args+=(-file "$DOOM_DIR/$WAD"); fi
  echo "=== running: $port ${args[*]}"
  sudo openvt -c 1 -s -w -f -- sudo -u pi -H "$port" "${args[@]}"
  return $?
}

run_online() {
  # The online multiplayer port + server browser is set up separately (build
  # spike). Point DOOM_ONLINE_CMD at that launcher (e.g. doomseeker / odalaunch,
  # or "zandronum -connect ..."). Until then, fail loudly rather than silently.
  if [ -z "$DOOM_ONLINE_CMD" ]; then
    echo "ERROR: online multiplayer not configured yet. Set DOOM_ONLINE_CMD to the server-browser/port launcher once the online port is built."
    exit 1
  fi
  echo "=== running online: $DOOM_ONLINE_CMD"
  # shellcheck disable=SC2086
  sudo openvt -c 1 -s -w -f -- sudo -u pi -H bash -lc "$DOOM_ONLINE_CMD"
  return $?
}

# Free the display (mirrors launch-game.sh).
sudo systemctl stop getty@tty1
sudo pkill -TERM -t tty1 2>/dev/null
for _ in $(seq 1 20); do
  [ -z "$(ps -t tty1 -o pid=)" ] && break
  sleep 0.5
done
sudo pkill -KILL -t tty1 2>/dev/null

case "$MODE" in
  online) run_online; RC=$? ;;
  *)      run_local;  RC=$? ;;
esac

echo "=== $(date -Is) doom exited (code $RC)"
exit "$RC"
