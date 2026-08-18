Scan apps/web for hardcoded user-facing strings. Verify every number formatting
call uses en-IN / hi-IN lakh-crore grouping (12,84,700 not 1,284,700). Verify
place names come from the database (name_en / name_hi), not translation files.
Verify [lang="hi"] line-height is set. Verify messages/en.json and
messages/hi.json have identical key sets. Report violations with file:line.
