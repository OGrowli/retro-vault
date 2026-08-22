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
#   launch-doom.sh iwad            # default (auto-detected) IWAD, no custom WAD
#   launch-doom.sh iwad <file>     # a specific base-game IWAD from $DOOM_DIR
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

# Bail BEFORE any kiosk teardown if online was picked but no online port is set
# up yet — otherwise selecting "Online" just tears down and relaunches the kiosk
# (looks like a restart). Exits nonzero so the API surfaces an error.
if [ "$MODE" = "online" ] && [ -z "$DOOM_ONLINE_CMD" ]; then
  echo "online multiplayer not configured (DOOM_ONLINE_CMD unset) — leaving kiosk up."
  exit 1
fi

restore_kiosk() {
  echo "=== $(date -Is) restoring kiosk"
  sudo systemctl start getty@tty1
}
trap restore_kiosk EXIT

# --- audio output ------------------------------------------------------------
# ALSA's `default` PCM here is card 0, the 3.5mm headphone jack, while the TV is
# on HDMI (card vc4hdmi) — so LZDoom, which plays through OpenAL onto whatever
# ALSA calls default, sends its sound into an unplugged socket and looks like it
# has no audio at all. RetroArch sidesteps this with an explicit audio_device
# per system; the ports need the equivalent steer, which ALSA_CARD provides
# (alsa-lib reads it when resolving `default`).
#
# Override with DOOM_AUDIO_CARD=Headphones (any name from `aplay -l`), or
# DOOM_AUDIO_CARD=- to leave the system default alone.
pick_audio_card() {
  if [ -n "$DOOM_AUDIO_CARD" ]; then
    [ "$DOOM_AUDIO_CARD" = "-" ] || echo "$DOOM_AUDIO_CARD"
    return
  fi
  # Only claim HDMI when a display is actually plugged in — 'HDMI Jack' reports
  # the hotplug state, so a headless/jack-only setup keeps the system default.
  local card
  card="$(awk '/vc4hdmi/ { gsub(/[][ ]/, "", $2); print $2; exit }' /proc/asound/cards)"
  [ -z "$card" ] && return
  if amixer -c "$card" cget numid=1 2>/dev/null | grep -q "values=on"; then
    echo "$card"
  fi
}
AUDIO_CARD="$(pick_audio_card)"
[ -n "$AUDIO_CARD" ] && echo "=== audio card: $AUDIO_CARD (ALSA_CARD)"

# sudo scrubs the environment, so the card has to be handed over explicitly.
# ALSOFT_DRIVERS pins OpenAL to ALSA rather than letting it probe for a
# PulseAudio server that isn't installed.
audio_env() {
  if [ -n "$AUDIO_CARD" ]; then
    echo "env ALSA_CARD=$AUDIO_CARD ALSOFT_DRIVERS=alsa"
  fi
}

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

# $1 = explicit IWAD filename (optional), $2 = custom PWAD filename (optional)
run_local() {
  local iwad_name="$1" pwad_name="$2" port iwad
  port="$(find_port)"
  if [ -z "$port" ]; then
    echo "ERROR: no Doom port binary found. Install one (e.g. lzdoom via RetroPie-Setup) or set DOOM_PORT_BIN."
    exit 1
  fi
  if [ -n "$iwad_name" ] && [ -f "$DOOM_DIR/$iwad_name" ]; then
    iwad="$DOOM_DIR/$iwad_name"
  else
    iwad="$(find_iwad)"
  fi
  if [ -z "$iwad" ]; then
    echo "ERROR: no IWAD in $DOOM_DIR (drop doom2.wad / freedoom2.wad there)."
    exit 1
  fi
  # +set use_joystick 1 forces the gamepad on regardless of the saved ini
  # (LZDoom ships it off; the DualShock 4 otherwise only works via its touchpad
  # mouse, so the D-pad/stick can't navigate menus or gameplay).
  local args=(-iwad "$iwad" -fullscreen +set use_joystick 1)
  if [ -n "$pwad_name" ]; then args+=(-file "$DOOM_DIR/$pwad_name"); fi
  echo "=== running: $port ${args[*]}"
  # shellcheck disable=SC2046 -- word splitting is how env vars reach the port
  sudo openvt -c 1 -s -w -f -- sudo -u pi -H $(audio_env) "$port" "${args[@]}"
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
  # shellcheck disable=SC2046,SC2086
  sudo openvt -c 1 -s -w -f -- sudo -u pi -H $(audio_env) bash -lc "$DOOM_ONLINE_CMD"
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

# RetroArch / lr-prboom route: inherits RetroArch's controller config. prboom
# auto-locates the IWAD in the content's folder, so $DOOM_DIR (which holds the
# IWADs) works for both a base IWAD and a PWAD. $1=iwad name (opt), $2=pwad (opt).
run_retroarch() {
  local iwad_name="$1" pwad_name="$2" core content ra
  core="$(ls /opt/retropie/libretrocores/lr-prboom/*.so 2>/dev/null | head -1)"
  if [ -z "$core" ]; then
    echo "ERROR: lr-prboom core not installed. Install it via RetroPie-Setup, or switch the Doom engine to LZDoom."
    exit 1
  fi
  if [ -n "$pwad_name" ]; then content="$DOOM_DIR/$pwad_name"
  elif [ -n "$iwad_name" ] && [ -f "$DOOM_DIR/$iwad_name" ]; then content="$DOOM_DIR/$iwad_name"
  else content="$(find_iwad)"; fi
  if [ -z "$content" ]; then echo "ERROR: no IWAD/content in $DOOM_DIR"; exit 1; fi
  ra="$(command -v retroarch || echo /opt/retropie/emulators/retroarch/bin/retroarch)"
  echo "=== running (retroarch): $ra -L $core $content"
  # shellcheck disable=SC2046
  sudo openvt -c 1 -s -w -f -- sudo -u pi -H $(audio_env) "$ra" -L "$core" "$content"
  return $?
}

run_gencfg() {
  # Start the port with the pad connected, wait for it to enumerate the
  # joystick, then quit cleanly so LZDoom writes its per-controller config block
  # to lzdoom.ini (no user menu interaction needed). We then hand-tune that block.
  local port iwad
  port="$(find_port)"; iwad="$(find_iwad)"
  if [ -z "$port" ] || [ -z "$iwad" ]; then echo "gencfg: need port + IWAD"; exit 1; fi
  echo "=== gencfg: $port (enumerate joystick, +quit)"
  # shellcheck disable=SC2046
  sudo openvt -c 1 -s -w -f -- sudo -u pi -H $(audio_env) "$port" -iwad "$iwad" +set use_joystick 1 +wait 70 +quit
  return $?
}

# Engine selector (set by the API from the doom_engine setting). LZDoom is the
# default; 'retroarch' routes local play through lr-prboom.
ENGINE="${DOOM_ENGINE:-lzdoom}"

case "$MODE" in
  online) run_online;      RC=$? ;;
  gencfg) run_gencfg;      RC=$? ;;      # generate LZDoom controller config, then quit
  wad)    if [ "$ENGINE" = "retroarch" ]; then run_retroarch "" "$WAD"; else run_local "" "$WAD"; fi; RC=$? ;;
  *)      if [ "$ENGINE" = "retroarch" ]; then run_retroarch "$WAD" ""; else run_local "$WAD" ""; fi; RC=$? ;;
esac

echo "=== $(date -Is) doom exited (code $RC)"
exit "$RC"
