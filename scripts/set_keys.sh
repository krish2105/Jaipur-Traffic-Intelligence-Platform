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

# $5 is "plain" for values that are not secret. A resource id is public and
# gets pasted wrong constantly, so hiding it only hides the typo.
set_key () {
  local var="$1" label="$2" url="$3" file="$4" mode="${5:-hidden}"
  local current
  current=$(grep -E "^${var}=" "$file" 2>/dev/null | head -1 | cut -d= -f2-)
  echo
  echo "── ${label}"
  echo "   ${url}"
  if [ -n "$current" ]; then
    echo "   currently set (${#current} chars). Enter to keep."
  fi
  if [ "$mode" = "plain" ]; then
    printf "   paste value: "
    read -r value
  else
    printf "   paste key (hidden): "
    read -rs value
    echo
  fi
  if [ -z "$value" ]; then
    echo "   kept"
    return
  fi

  # Hidden input hides mistakes as well as secrets. Two of them are common
  # enough to be worth checking, and both were seen on the first real run.

  # 1. Cmd-V pressed more than once. The value is one string repeated, and the
  #    supplier rejects it with a plain 401 that looks like a bad credential.
  n=${#value}
  for reps in 2 3 4; do
    [ $((n % reps)) -eq 0 ] || continue
    unit=$((n / reps))
    [ "$unit" -ge 8 ] || continue
    head_part=${value:0:$unit}
    rebuilt=""; i=0
    while [ "$i" -lt "$reps" ]; do rebuilt="${rebuilt}${head_part}"; i=$((i + 1)); done
    if [ "$rebuilt" = "$value" ]; then
      echo "   note: looked pasted ${reps}x (${n} chars = ${reps} x ${unit}). Kept the first ${unit}."
      value="$head_part"
      break
    fi
  done

  # 2. The same thing pasted into two different prompts. A key and a resource id
  #    are not interchangeable, and storing one as the other produces a timeout
  #    rather than an error anyone can read.
  while IFS='=' read -r other_var other_val; do
    case "$other_var" in ""|\#*) continue ;; esac
    [ "$other_var" = "$var" ] && continue
    if [ -n "$other_val" ] && [ "$other_val" = "$value" ]; then
      echo "   REFUSED: identical to ${other_var}. Two different things cannot"
      echo "            share one value. Nothing written — check what you copied."
      return
    fi
  done < "$file"
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

set_key TOMTOM_API_KEY      "TomTom Traffic (free, no card, 20,000/month)" \
        "https://docs.tomtom.com  ->  Sign in  ->  API & SDK Keys" "$ROOT_ENV"
set_key DATA_GOV_IN_API_KEY "VAHAN fleet via data.gov.in (free, Jan Parichay login)" \
        "https://www.data.gov.in/login  ->  My Account  ->  generate API key" "$ROOT_ENV"
set_key VAHAN_RESOURCE_ID   "Which data.gov.in resource to read (not a secret)" \
        "open the dataset page, copy the UUID after /resource/" "$ROOT_ENV" plain
# Deliberately NOT asked for, and please do not add them back:
#
#   OPENAQ_API_KEY      Nothing reads it. Air quality comes from Open-Meteo /
#                       CAMS, which needs no credential and already reports
#                       live in /meta/sources. OpenAQ was the original plan and
#                       put registration behind an account, which is why it was
#                       replaced. Asking for this key sent people to register
#                       for a service the platform stopped using.
#
#   GOOGLE_MAPS_API_KEY Nothing reads it either. The map is MapLibre over OSM
#                       raster tiles. Google Map Tiles needs billing enabled,
#                       and this project is free tier throughout, so the prompt
#                       was inviting someone to put a card on file for a
#                       feature that does not exist.
#
# Both were prompted here for months with no code behind them. That is the same
# fault the readiness panel had: a credential slot implying a capability.

echo
echo "── which keys are set ──"
for v in TOMTOM_API_KEY DATA_GOV_IN_API_KEY VAHAN_RESOURCE_ID; do
  n=$(grep -E "^${v}=" "$ROOT_ENV" 2>/dev/null | head -1 | cut -d= -f2- | wc -c | tr -d ' ')
  if [ "${n:-1}" -gt 1 ]; then echo "   set     ${v}"; else echo "   missing ${v}"; fi
done
echo
echo "Then tell Claude: \"keys are set\". The values are never shown."
