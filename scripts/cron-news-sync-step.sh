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
  echo "[cron] ${SOURCE}: HTTP ${HTTP_CODE} — 실패"
  exit 1
fi

OK=$(echo "$BODY" | jq -r '.ok // empty')
if [ "$OK" != "true" ]; then
  STEP=$(echo "$BODY" | jq -r '.step // "unknown"')
  ERR=$(echo "$BODY" | jq -r '.error // "unknown"')
  echo "[cron] ${SOURCE}: ok=false (step=${STEP}, error=${ERR}) — 실패"
  exit 1
fi

if [ "$WARN_RATE_LIMIT_ZERO" = "warn-rate-limit-zero" ]; then
  CREATED=$(echo "$BODY" | jq -r '.created // 0')
  if [ "$CREATED" = "0" ]; then
    RATE_SKIPS=$(echo "$BODY" | jq '[.results[]? | select(.status=="skipped_summary" and (.detail | test("API 사용량|rate limit|quota|resource exhausted"; "i")))] | length')
    TOTAL_SUMMARY=$(echo "$BODY" | jq '[.results[]? | select(.status=="skipped_summary")] | length')
    if [ "$TOTAL_SUMMARY" -gt 0 ] && [ "$RATE_SKIPS" = "$TOTAL_SUMMARY" ]; then
      echo "[cron] ${SOURCE}: created=0, 전부 rate limit skipped_summary — 실패(알림)"
      exit 1
    fi
  fi
fi

echo "[cron] ${SOURCE}: ok"
