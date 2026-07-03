#!/usr/bin/env bash
xset s off
xset s noblank
xset -dpms
unclutter -idle 0 -root &

exec chromium-browser \
  --kiosk \
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
