#!/usr/bin/env bash
# docs/02 Stack + docs/DECISIONS.md ADR-009.
#
# Ultralytics YOLO is AGPL-3.0. For software intended for government deployment
# that is a procurement blocker and a legal exposure a system integrator's
# counsel will find. Experiments are allowed; shipping is not.
#
# A file may use it ONLY if it carries the non-shippable marker on a line of
# its own near the top.
set -uo pipefail
cd "$(dirname "$0")/.."

MARKER="NON-SHIPPABLE: experiment only"
fail=0

while IFS= read -r file; do
  if ! grep -q "$MARKER" "$file"; then
    echo "FAIL  $file imports ultralytics without the '$MARKER' marker"
    fail=1
  else
    echo "ok    $file (marked experiment-only)"
  fi
done < <(grep -rlE '^\s*(import|from)\s+ultralytics' \
           --include='*.py' packages apps ml scripts 2>/dev/null || true)

if [ "$fail" -eq 0 ]; then
  echo "PASS  no unmarked Ultralytics (AGPL-3.0) usage"
fi
exit "$fail"
