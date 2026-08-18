#!/usr/bin/env bash
# Capture API keys locally, without them ever appearing in the chat, in a
# command history, or in the repository.
#
#   bash scripts/set_keys.sh
#
# Input is read with `read -s`, so nothing echoes to the terminal. Values are
# written to .env and apps/web/.env.local, both of which are gitignored, and a
# pre-existing value is kept if you press Enter to skip.
set -uo pipefail
cd "$(dirname "$0")/.."

ROOT_ENV=".env"
WEB_ENV="apps/web/.env.local"
touch "$ROOT_ENV" "$WEB_ENV"
chmod 600 "$ROOT_ENV" "$WEB_ENV"

set_key () {
  local var="$1" label="$2" url="$3" file="$4"
  local current
  current=$(grep -E "^${var}=" "$file" 2>/dev/null | head -1 | cut -d= -f2-)
  echo
  echo "── ${label}"
  echo "   ${url}"
  if [ -n "$current" ]; then
    echo "   currently set (${#current} chars). Enter to keep."
  fi
  printf "   paste key (hidden): "
  read -rs value
  echo
  if [ -z "$value" ]; then
    echo "   kept"
    return
  fi
  # rewrite in place rather than appending, so re-running does not duplicate
  if grep -qE "^${var}=" "$file"; then
    tmp=$(mktemp)
    grep -vE "^${var}=" "$file" > "$tmp"
    mv "$tmp" "$file"
    chmod 600 "$file"
  fi
  printf '%s=%s\n' "$var" "$value" >> "$file"
  echo "   written to ${file} (${#value} chars)"
}

echo "PRAVAAH — API keys. Nothing is echoed; both files are gitignored."

set_key TOMTOM_API_KEY      "TomTom Traffic (free, no card, 2,500/day)" \
        "https://developer.tomtom.com/user/register" "$ROOT_ENV"
set_key OPENAQ_API_KEY      "OpenAQ air quality (free)" \
        "https://explore.openaq.org/register" "$ROOT_ENV"
set_key GOOGLE_MAPS_API_KEY "Google Map Tiles API (billing required)" \
        "https://console.cloud.google.com/" "$ROOT_ENV"

# The browser needs the Google key too; the others stay server-side only.
gkey=$(grep -E '^GOOGLE_MAPS_API_KEY=' "$ROOT_ENV" 2>/dev/null | head -1 | cut -d= -f2-)
if [ -n "$gkey" ]; then
  if grep -qE '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=' "$WEB_ENV"; then
    tmp=$(mktemp); grep -vE '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=' "$WEB_ENV" > "$tmp"; mv "$tmp" "$WEB_ENV"; chmod 600 "$WEB_ENV"
  fi
  printf 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=%s\n' "$gkey" >> "$WEB_ENV"
  echo
  echo "   mirrored Google key to ${WEB_ENV} for the browser"
  echo "   RESTRICT that key in Cloud Console to HTTP referrers — a public"
  echo "   NEXT_PUBLIC_ key is visible to anyone who opens the page."
fi

echo
echo "── which keys are set ──"
for v in TOMTOM_API_KEY OPENAQ_API_KEY GOOGLE_MAPS_API_KEY; do
  n=$(grep -E "^${v}=" "$ROOT_ENV" 2>/dev/null | head -1 | cut -d= -f2- | wc -c | tr -d ' ')
  if [ "${n:-1}" -gt 1 ]; then echo "   set     ${v}"; else echo "   missing ${v}"; fi
done
echo
echo "Then tell Claude: \"keys are set\". The values are never shown."
