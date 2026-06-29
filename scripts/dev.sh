#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DATA_DIR="/tmp/retrovault-test"
TEST_DB="$TEST_DATA_DIR/retrovault.db"

export RETROVAULT_DATA_DIR="$TEST_DATA_DIR"
export RETROVAULT_DB_PATH="$TEST_DB"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
  echo "Done."
}
trap cleanup INT TERM

cd "$ROOT"

echo "==> Seeding test database at $TEST_DB..."
RETROVAULT_DATA_DIR="$TEST_DATA_DIR" RETROVAULT_DB_PATH="$TEST_DB" \
  npx tsx packages/api/src/seed.ts

echo ""
echo "==> Starting API (port 3000)..."
RETROVAULT_DATA_DIR="$TEST_DATA_DIR" RETROVAULT_DB_PATH="$TEST_DB" \
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
echo "  DB:   $TEST_DB"
echo "  Ctrl+C to stop"
echo "=========================================="
echo ""

wait "$API_PID" "$WEB_PID"
