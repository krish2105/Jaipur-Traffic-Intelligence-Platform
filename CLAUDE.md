# PRAVAAH — Claude Code Operating Instructions

Traffic decision-intelligence platform for Government of Rajasthan, Jaipur.
Pitch to a senior official. Production standards, hard deadline.

## Specification
`docs/` is the specification. Read the relevant doc before implementing in its
domain. To deviate, say so and get sign-off. Never deviate silently.
Sanctioned deviations already agreed are recorded in `docs/DECISIONS.md` — read
that file too, because it overrides the pack where they conflict.

| Domain | Doc |
|---|---|
| Problem, evidence, numbers | docs/01 |
| Architecture, modules, deployment | docs/03 |
| Models, datasets, evaluation | docs/04 |
| Schema, events, APIs | docs/05 |
| Design, frontend, i18n | docs/06 |
| Security, privacy, DPDP | docs/07 |
| Sprints, commands | docs/08 |

## Engineering rules
1. Simplicity first. Minimum code that solves the problem. No speculative
   abstraction, no unrequested configurability, no error handling for
   impossible states. 200 lines that could be 50 -> rewrite.
2. Surgical changes. Touch only what the task needs. Don't refactor working
   code or reformat adjacent lines. Match existing style. Mention unrelated
   dead code; don't delete it.
3. State a plan before multi-step work: `step -> verify: check`. Every task
   needs a real verification — a passing test, a screenshot, a curl response.
   "It works" is not a verification.
4. Surface assumptions and ambiguity. Present options; don't pick silently.
5. Types are defined once in `packages/contracts` and generated to TypeScript.
   Never hand-maintain parallel type definitions.

## Hard prohibitions
- NO facial recognition, person detection/tracking, gait or biometric analysis.
- NO direct model-to-signal actuation. Signal output is advisory; a human approves.
- NO raw number plates on the event bus, in logs, in metrics, or in caches.
  Salted hash on the bus; ciphertext direct to DB.
- NO unlabelled synthetic data in the UI. Anything synthetic renders a
  "Simulated data" badge, always.
- NO hardcoded user-facing strings. i18n from the first line.
- NO Ultralytics YOLO in shippable code (AGPL-3.0 procurement blocker).
  Experiments only, with a header comment marking the file non-shippable.
- NO naked numbers in the UI. Every measurement shows quality or confidence.
- If a task drifts toward surveillance, stop and flag it.

## Stack (fixed — reflects docs/DECISIONS.md, not the raw doc 03 list)
Python 3.12 · FastAPI · Pydantic v2 · SQLAlchemy 2 async · Redis Streams ·
Tiger Cloud (Postgres 17 + TimescaleDB + PostGIS + pgvector) · Cloudflare R2 ·
PyTorch -> ONNX Runtime · APScheduler + Render Cron · SUMO
Next.js 15 App Router · TypeScript strict · Tailwind v4 · Motion (motion/react)
· Lenis · MapLibre + deck.gl · React Three Fiber · next-intl · TanStack Query
Keycloak OIDC + Postgres RLS · Render (backend) · Vercel (frontend) ·
Docker Compose (offline demo)

Detection is RT-DETRv2 (Apache-2.0). Tracking is ByteTrack via `supervision` (MIT).
Do not substitute a library without asking.

## Commands
make dev · make seed · make test · make lint · make typecheck · make contracts ·
make train MODEL=<id> · make eval MODEL=<id> · make replay CAMERA=<id> ·
make sim SCENARIO=<file> · make demo-reset

## Definition of done
Tests pass · lint clean · types check · renders in Hindi and English · works in
dark and light · responsive to 360px · reduced-motion respected · no console
errors · quality/confidence shown on every measurement.

## Context discipline
Read only the docs the current task needs. Don't load all eleven every session.
