#!/usr/bin/env bash
# docs/07 §3: "Add a CI check that greps for plate-shaped regexes in log
# statements."
#
# The raw plate must never appear on the event bus, in logs, in error messages,
# in metrics, or in any cache. This catches the two ways it actually happens:
# a literal registration number in source, and a `plate` variable interpolated
# into a log line.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
SCAN_DIRS=(packages apps scripts)

# 1. Literal Indian registration numbers anywhere in source.
#    data/ and tests are exempt — fixtures legitimately contain sample plates.
echo "── literal registration numbers ──"
if hits=$(grep -rnE '"[A-Z]{2}[ -]?[0-9]{1,2}[ -]?[A-Z]{1,3}[ -]?[0-9]{4}"' \
            --include='*.py' --include='*.ts' --include='*.tsx' \
            "${SCAN_DIRS[@]}" 2>/dev/null | grep -v '/tests\?/'); then
  echo "$hits"
  echo "FAIL  literal registration number in source"
  fail=1
else
  echo "PASS  none found"
fi

# 2. An unmasked plate interpolated into a log/print/metric call.
echo "── plate interpolated into logging ──"
if hits=$(grep -rnE '(logger|log|logging|print|structlog)[^\n]*\{?[a-z_]*plate(_raw|_text|_number)?\}?' \
            --include='*.py' "${SCAN_DIRS[@]}" 2>/dev/null \
          | grep -vE 'plate_hash|plate_masked|plate_encrypted|plate_ciphertext' ); then
  echo "$hits"
  echo "FAIL  a plate value may reach a log sink"
  fail=1
else
  echo "PASS  none found"
fi

[ "$fail" -eq 0 ] && echo "PASS  no plate leakage detected"
exit "$fail"
