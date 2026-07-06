#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
  echo "Done."
}
trap cleanup INT TERM

cd "$ROOT"

# Free port 3000 if held by a previous run
if command -v lsof > /dev/null 2>&1; then
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
elif command -v netstat.exe > /dev/null 2>&1; then
  pid=$(netstat.exe -ano 2>/dev/null | awk '/TCP.*:3000 .*LISTEN/{print $5}' | head -1)
  [ -n "$pid" ] && { echo "Killing stale process on port 3000 (PID: $pid)..."; taskkill.exe /PID "$pid" /F 2>/dev/null || true; }
fi

echo "==> Seeding test database..."
npx tsx packages/api/src/seed.ts

echo ""
echo "==> Starting API (port 3000)..."
npx tsx packages/api/src/index.ts &
API_PID=$!

echo "==> Waiting for API..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:3000/meta/systems > /dev/null 2>&1; then
    echo "    API ready."
    break
  fi
  sleep 0.5
done

echo ""
echo "==> Starting web dev server (port 5173)..."
npm run dev -w packages/web &
WEB_PID=$!

echo ""
echo "=========================================="
echo "  RetroVault dev environment running"
echo "  API:  http://localhost:3000"
echo "  Web:  http://localhost:5173"
echo "  Ctrl+C to stop"
echo "=========================================="
echo ""

wait "$API_PID" "$WEB_PID"
