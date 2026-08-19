#!/usr/bin/env bash
# Put fresh live data on the deployment. Run this shortly before a demo.
#
#   bash scripts/demo_refresh.sh
#
# Why this exists
# ---------------
# The deployment serves a captured snapshot, and the probe layer refuses to use
# a reading older than ninety minutes. Both of those are deliberate. Together
# they mean the headline panel — how many vehicles are inside each area — goes
# quiet a couple of hours after the last deploy, and stays quiet until someone
# takes a new reading.
#
# That is correct behaviour and terrible timing if it happens during a meeting.
# So: one command that takes a reading, captures it, and ships it.
#
# It refuses rather than half-working. A snapshot exported against a dead API is
# a snapshot full of nulls, and it would deploy cleanly and look broken on
# screen, which is the worst of both.
set -uo pipefail
cd "$(dirname "$0")/.."

API="${PRAVAAH_API:-http://127.0.0.1:8001}"
fail() { printf "\n  \033[31mSTOP\033[0m  %s\n\n" "$1"; exit 1; }
step() { printf "\n\033[35m──\033[0m %s\n" "$1"; }

step "checking the stack"
if ! pg_isready -h localhost -p "${PRAVAAH_DB_PORT:-5433}" >/dev/null 2>&1; then
  fail "Postgres is not running on 5433. Start it with:  make up"
fi
printf "  postgres ok\n"

if ! curl -s -o /dev/null --max-time 5 "$API/api/v1/health"; then
  fail "The API is not answering on $API. Start it in another terminal with:  make api"
fi
printf "  api ok\n"

step "taking a fresh probe reading"
# --ignore-window because a demo can be scheduled outside 06:00-22:00, and one
# extra sweep against a 20,000 monthly allowance is not worth refusing over.
if ! uv run python scripts/fetch_probe_speeds.py --ignore-window; then
  fail "The sweep failed. Check TOMTOM_API_KEY with:  bash scripts/set_keys.sh"
fi

step "capturing the API into the snapshot the deployment serves"
uv run python scripts/export_snapshot.py || fail "Snapshot export failed."

step "confirming what was captured"
uv run python - <<'PY'
import json
from datetime import UTC, datetime

snapshot = json.load(open("apps/web/src/data/snapshot.json"))
coverage = snapshot.get("/probe/coverage") or {}
areas = snapshot.get("/areas/accumulation/live") or {}

captured = coverage.get("captured_at")
age = None
if captured:
    age = (datetime.now(UTC) - datetime.fromisoformat(captured)).total_seconds() / 60

print(f"  probe reading   {age:.0f} min old" if age is not None else "  probe reading   MISSING")
print(f"  links covered   {coverage.get('links_covered')}/{coverage.get('corridor_links')}")
print(f"  accumulation    {'available' if areas.get('available') else 'NOT AVAILABLE'}")
reportable = sum(1 for a in areas.get("areas") or [] if a.get("count_reportable"))
print(f"  areas with a count on screen: {reportable}")
if not areas.get("available"):
    raise SystemExit("  the accumulation panel will be empty on the deployment")
PY
status=$?

step "shipping it"
if [ -z "$(git status --porcelain apps/web/src/data data/probe)" ]; then
  printf "  nothing changed; the deployment already has this reading\n"
  exit 0
fi
git add apps/web/src/data data/probe
git commit -q -m "Refresh the deployed snapshot with a live probe reading

Taken by scripts/demo_refresh.sh. The probe layer refuses a reading older than
ninety minutes and the deployment serves a captured snapshot, so the headline
panel goes quiet a couple of hours after each deploy until someone takes a new
one."
git push origin main | tail -1

printf "\n  Vercel is building. It takes about a minute.\n"
printf "  Watch for it with:\n"
printf "    curl -s %s/api/v1/areas/accumulation/live | head -c 120\n\n" \
  "https://jaipur-traffic-intelligence-platfor-nine.vercel.app"
exit $status
