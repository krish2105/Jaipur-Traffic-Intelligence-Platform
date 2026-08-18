# PRAVAAH — Progress

Updated at the end of each phase. Re-cut scope against doc 08 §1's priority list
whenever a phase slips.

| Phase | Status | Notes |
|---|---|---|
| 0 · Foundation | **Complete** | Monorepo, contracts+TS generation, CI, guards, Keycloak realm, Render blueprint, offline compose. Remaining: Alembic schema, seed loader — and the live verifications that need Docker running / cloud accounts |
| 1 · Network + seed + three UI directions | **Complete — awaiting your choice** | Real OSM network, calibrated 90-day seed, API, dashboard, `/design` gallery. **Decision point: pick a direction.** |
| 2 · GANANA counting | Not started | The sprint that matters |
| 3 · Warehouse + streaming + fusion | Not started | |
| 4 · SETU command centre | Not started | |
| 5 · DRISHTI intelligence | Not started | |
| 6 · NEETI copilot | Not started | |
| 7 · Simulation + 3D twin | Not started | |
| 8 · KAVACH-E | Not started | |
| 9 · Landing + citizen PWA + officer PWA | Not started | |
| 10 · Hardening + compliance + pitch pack | Not started | |

## Phase 0 verification — 2026-08-18

| Check | Result |
|---|---|
| ruff lint · ruff format | PASS |
| mypy strict (contracts) | PASS |
| pytest (contracts, 21 tests) | PASS |
| AGPL licence guard | PASS |
| plate-leakage guard | PASS |
| eslint · tsc --noEmit · vitest (19 tests) | PASS |
| next build (en + hi prerendered) | PASS |
| Pydantic → TypeScript generation | PASS, 8 models |
| local stack up (no Docker) | PASS — `make up`: Postgres 18 + TimescaleDB/PostGIS/pgvector on :5433, Redis, MinIO, Ollama |
| migrations 0001–0003 applied | PASS — 18 tables, 5 hypertables, 1 continuous aggregate, compression policy |
| `make seed` row counts | PASS — 1.4M counts, 777k congestion, 18,578 crashes (= published 5-year total) |
| seed profile reproduces published TomTom figures | PASS — 17 tests: mean 58.7, peaks 73.9/94.9, rush speed 17.5 km/h |
| database size under Tiger Cloud's 750 MB cap | PASS — 252 MB after compression (284 MB → 46 MB on counts) |
| API serves live seeded data | PASS — corridors, summary, day-profile, congestion GeoJSON, cameras, forecast |
| dashboard renders in Hindi and English, both themes | PASS — verified in browser |
| security verification (20 checks) | PASS — `make verify-security`, incl. audit_log refusing UPDATE |
| `/api/v1/health` 200 on Render | **not run** — needs a Render account |
| pushed to GitHub | PASS — krish2105/Jaipur-Traffic-Intelligence-Platform |

## Open blockers
- No Jaipur junction footage yet. Accuracy certificates will be measured against
  public Indian datasets until it exists. Doc 08 §6 rates this High/Critical.
- Doc 10 Tier-1 questions unanswered: which department, camera access, and
  whether this is a platform / a study / input to a tender.
