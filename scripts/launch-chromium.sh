#!/usr/bin/env bash
xset s off
xset s noblank
xset -dpms
unclutter -idle 0 -root &

CHROMIUM="chromium-browser"
command -v chromium-browser > /dev/null 2>&1 || CHROMIUM="chromium"

# No window manager runs in the kiosk session, so --kiosk alone can't
# fullscreen the window — size it to the display explicitly.
RES="$(xrandr --current 2>/dev/null | awk '/\*/{print $1; exit}')"
W="${RES%x*}"
H="${RES#*x}"

exec "$CHROMIUM" \
  --kiosk \
  --window-position=0,0 \
  --window-size="${W:-1920},${H:-1080}" \
  --disable-extensions \
  --disable-gpu \
  --js-flags="--max-old-space-size=256" \
  --no-sandbox \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-translate \
  --noerrdialogs \
  --check-for-update-interval=31536000 \
  http://localhost:3000
