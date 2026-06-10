#!/usr/bin/env bash
# External cron: POST news sync API and fail on HTTP/JSON errors.
# Usage: cron-news-sync-step.sh <label> <api-path> [warn-rate-limit-zero]
set -euo pipefail

SOURCE="${1:?source label}"
API_PATH="${2:?api path e.g. /api/cron/geeknews}"
WARN_RATE_LIMIT_ZERO="${3:-}"

: "${CRON_SITE_URL:?CRON_SITE_URL unset}"
: "${CRON_SECRET:?CRON_SECRET unset}"

URL="${CRON_SITE_URL%/}${API_PATH}"
echo "==> ${SOURCE}: POST ${URL}"

RESP_FILE=$(mktemp)
trap 'rm -f "$RESP_FILE"' EXIT

HTTP_CODE=$(curl -sS -w "%{http_code}" -o "$RESP_FILE" -X POST "$URL" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json")

BODY=$(cat "$RESP_FILE")
echo "$BODY"
echo "HTTP ${HTTP_CODE}"

if [ "$HTTP_CODE" -ge 400 ]; then
  if [ "$HTTP_CODE" = "504" ] && { [[ "$API_PATH" == *"/verge"* ]] || [[ "$API_PATH" == *"/mit-news"* ]]; }; then
    echo "[cron] ${SOURCE}: HTTP 504 (gateway timeout) - warn only, chain continues"
    exit 0
  fi
  echo "[cron] ${SOURCE}: HTTP ${HTTP_CODE} - fail"
  exit 1
fi

OK=$(echo "$BODY" | jq -r '.ok // empty')
if [ "$OK" != "true" ]; then
  STEP=$(echo "$BODY" | jq -r '.step // "unknown"')
  ERR=$(echo "$BODY" | jq -r '.error // "unknown"')
  echo "[cron] ${SOURCE}: ok=false (step=${STEP}, error=${ERR}) - fail"
  exit 1
fi

if [ "$WARN_RATE_LIMIT_ZERO" = "warn-rate-limit-zero" ]; then
  CREATED=$(echo "$BODY" | jq -r '.created // 0')
  if [ "$CREATED" = "0" ]; then
    RATE_SKIPS=$(echo "$BODY" | jq '[.results[]? | select(.status=="skipped_summary" and (.detail | test("API 이용량|rate limit|quota|resource exhausted"; "i")))] | length')
    TOTAL_SUMMARY=$(echo "$BODY" | jq '[.results[]? | select(.status=="skipped_summary")] | length')
    if [ "$TOTAL_SUMMARY" -gt 0 ] && [ "$RATE_SKIPS" = "$TOTAL_SUMMARY" ]; then
      echo "[cron] ${SOURCE}: created=0, all rate-limit skipped_summary - warn only, chain continues"
      exit 0
    fi
  fi
fi

echo "[cron] ${SOURCE}: ok"