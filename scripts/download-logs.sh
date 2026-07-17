#!/usr/bin/env bash
set -euo pipefail

# Download RetroVault event logs from the running API.
# By default: the last 24 hours, as CSV, into the current directory.
#
#   bash scripts/download-logs.sh                     # last 24h, CSV
#   bash scripts/download-logs.sh --ndjson            # last 24h, NDJSON
#   bash scripts/download-logs.sh --hours 72          # last 3 days
#   bash scripts/download-logs.sh --category scrape   # only scrape events
#   bash scripts/download-logs.sh --level error       # only errors
#   bash scripts/download-logs.sh --out /tmp/logs.csv # explicit output path
#   API_URL=http://retropie.local:3000 bash scripts/download-logs.sh
#
# created_at is stored UTC (sqlite datetime('now')), so the window is computed in UTC.

API_URL="${API_URL:-http://localhost:3000}"
HOURS=24
FORMAT=csv
CATEGORY=""
LEVEL=""
OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --ndjson)        FORMAT=ndjson; shift ;;
    --csv)           FORMAT=csv; shift ;;
    --hours)         HOURS="$2"; shift 2 ;;
    --category)      CATEGORY="$2"; shift 2 ;;
    --level)         LEVEL="$2"; shift 2 ;;
    --url)           API_URL="$2"; shift 2 ;;
    --out|-o)        OUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '3,20p' "$0"; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# UTC timestamp for HOURS ago, in the 'YYYY-MM-DD HH:MM:SS' shape the API compares against.
if FROM="$(date -u -d "$HOURS hours ago" '+%Y-%m-%d %H:%M:%S' 2>/dev/null)"; then
  :
elif FROM="$(date -u -v-"${HOURS}"H '+%Y-%m-%d %H:%M:%S' 2>/dev/null)"; then
  :  # BSD/macOS date
else
  echo "Could not compute a start time — no GNU or BSD 'date' available." >&2
  exit 1
fi

if [ -z "$OUT" ]; then
  STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
  OUT="retrovault-events-last${HOURS}h-${STAMP}.${FORMAT}"
fi

# Build the query safely (spaces/filters URL-encoded) and stream to $OUT.
ARGS=(-sSfG "$API_URL/events/export"
  --data-urlencode "format=$FORMAT"
  --data-urlencode "from=$FROM")
[ -n "$CATEGORY" ] && ARGS+=(--data-urlencode "category=$CATEGORY")
[ -n "$LEVEL" ] && ARGS+=(--data-urlencode "level=$LEVEL")

echo "==> Downloading events since ${FROM} UTC (${FORMAT}) from ${API_URL}"
if ! curl "${ARGS[@]}" -o "$OUT"; then
  echo "Failed to reach the API at ${API_URL}. Is it running? (set API_URL to override)" >&2
  rm -f "$OUT"
  exit 1
fi

# Report how many rows landed. grep -c '' counts every line, including a final
# one with no trailing newline (the export omits it). CSV has a header to subtract.
LINES=$(grep -c '' "$OUT" || true)
if [ "$FORMAT" = csv ]; then
  ROWS=$(( LINES > 0 ? LINES - 1 : 0 ))
else
  ROWS=$LINES
fi

echo "==> Wrote ${ROWS} event(s) to ${OUT}"
