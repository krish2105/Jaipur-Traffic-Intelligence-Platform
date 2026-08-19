#!/usr/bin/env bash
# Rebuild the pitch and script PDFs from their HTML.
#
#   bash scripts/build_pitch_pdfs.sh
#
# Why this exists
# ---------------
# The PDFs are what actually gets handed to an official; the HTML is what gets
# edited. Nothing connected the two, so a correction to pitch.html left
# pitch.pdf saying the opposite — and it did exactly that: after ADR-064 fixed
# the two-wheeler claim in the HTML, both PDFs still read "zero two-wheelers",
# which is the version that would have been presented.
#
# A stale PDF is worse than a missing one. A missing one gets noticed.
#
# The originals were produced by headless Chrome (Skia/PDF m151), and the @page
# rule in the HTML already sets A4 and the margins, so Chrome is the tool that
# reproduces them rather than a second renderer with its own opinions.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME  (override with CHROME=...)"; exit 1; }

for name in pitch script; do
  src="$PWD/docs/pitch/$name.html"
  out="$PWD/docs/pitch/$name.pdf"
  [ -f "$src" ] || { echo "missing $src"; exit 1; }

  # --virtual-time-budget so webfonts and layout settle before the snapshot;
  # without it a cold run can print a page with fallback metrics.
  "$CHROME" --headless --disable-gpu --no-sandbox \
    --no-pdf-header-footer \
    --virtual-time-budget=10000 \
    --print-to-pdf="$out" \
    "file://$src" 2>/dev/null

  pages=$(pdfinfo "$out" 2>/dev/null | awk '/^Pages/{print $2}')
  printf "  %-12s -> %s  (%s pages)\n" "$name.html" "$out" "${pages:-?}"
done

# The check that would have caught the stale version.
#
# Two things this must NOT do, both learned by getting them wrong here first:
#
#   * It cannot simply assert that "zero two-wheelers" is absent. The corrected
#     script *quotes* the retracted claim on purpose — "for a while we believed
#     it found zero two-wheelers ... it was our own bug" — because owning the
#     correction out loud is the point of that passage. Grepping for the phrase
#     fails the very text that fixes it.
#
#   * It cannot read the PDF the instant Chrome returns. Chrome flushes the file
#     asynchronously, so a check that runs immediately can read a partial PDF and
#     report a missing phrase that is in fact present.
#
# So: wait for the write to settle, then assert the *corrected* claims are
# present and the *retracted sentence* — wording that existed only in the old
# version — is gone.
echo
for f in docs/pitch/pitch.pdf docs/pitch/script.pdf; do
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pdftotext "$f" - 2>/dev/null | grep -qi "auto-rickshaw" && break
    sleep 0.5
  done
done

fail=0
RETRACTED="trained on European and American roads, where a motorcycle is rare"
for f in docs/pitch/pitch.pdf docs/pitch/script.pdf; do
  text=$(pdftotext "$f" - 2>/dev/null)
  case "$text" in
    *"auto-rickshaw"*) ;;
    *) echo "  FAIL  $f is missing the corrected auto-rickshaw finding"; fail=1 ;;
  esac
  case "$text" in
    *"53 percent"*) ;;
    *) echo "  FAIL  $f is missing the corrected two-wheeler share"; fail=1 ;;
  esac
  case "$text" in
    *"$RETRACTED"*) echo "  FAIL  $f still carries the retracted sentence"; fail=1 ;;
  esac
done
[ "$fail" -eq 0 ] && echo "  both PDFs carry the corrected finding, and the retracted wording is gone."
exit "$fail"
