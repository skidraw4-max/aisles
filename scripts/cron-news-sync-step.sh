#!/usr/bin/env bash
# External cron: POST news sync API and fail on HTTP/JSON errors only.
# Usage: cron-news-sync-step.sh <label> <api-path>
# ok:true + created=0 (rate limit, empty feed, etc.) never fails the chain.
set -euo pipefail

CRON_SYNC_STEP_VERSION=2
echo "[cron] CRON_SYNC_STEP_VERSION=${CRON_SYNC_STEP_VERSION}"

SOURCE="${1:?source label}"
API_PATH="${2:?api path e.g. /api/cron/geeknews}"

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

# ok:true — created=0 never fails (rate limits, skipped summaries, empty feeds).
CREATED=$(echo "$BODY" | jq -r '.created // 0')
if [ "$CREATED" = "0" ]; then
  RATE_LIMIT_PATTERN='API 사용량|rate[ _]limit|resource[ _]exhausted|quota exceeded|exceeded your quota|too many requests'
  RATE_SKIPS=$(echo "$BODY" | jq --arg re "$RATE_LIMIT_PATTERN" '[.results[]? | select(.status=="skipped_summary" and ((.detail // "") | test($re; "i")))] | length')
  TOTAL_SUMMARY=$(echo "$BODY" | jq '[.results[]? | select(.status=="skipped_summary")] | length')
  if [ "$RATE_SKIPS" -gt 0 ]; then
    if [ "$TOTAL_SUMMARY" -gt 0 ] && [ "$RATE_SKIPS" = "$TOTAL_SUMMARY" ]; then
      echo "[cron] ${SOURCE}: created=0, all Gemini rate-limit skipped_summary - warn only, chain continues"
    else
      echo "[cron] ${SOURCE}: created=0, Gemini rate-limit skipped_summary ${RATE_SKIPS}/${TOTAL_SUMMARY} - warn only, chain continues"
    fi
  else
    echo "[cron] ${SOURCE}: created=0 (ok:true) - warn only, chain continues"
  fi
  exit 0
fi

echo "[cron] ${SOURCE}: ok (created=${CREATED})"
