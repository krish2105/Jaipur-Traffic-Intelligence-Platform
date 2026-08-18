# 08 — Build Plan & Claude Code Operating Docs

---

## 1. Scope reality check

You have "coming weeks" until the pitch. You are one person with coursework. So the plan below is built around a hard truth:

**You are not building the platform before the pitch. You are building the demo that proves you can build the platform.**

Six weeks gets you a working vertical slice on one corridor with real counting on real video. Twelve weeks gets you something a department could actually pilot. Trying to build all five modules to depth before the meeting produces five broken things instead of one convincing one.

**Priority order if time runs short — cut from the bottom:**

1. GANANA counting on real Jaipur video, with measured and displayed accuracy ← **never cut this**
2. Dashboard with the gnomon arc, live counts, class mix, bilingual
3. Forecast (even the LightGBM baseline)
4. NEETI answering in Hindi and English
5. Scenario simulation
6. 3D twin
7. KAVACH-E defaulter module

Note what is last. The defaulter module is the second thing the official asked for, but it is the riskiest to demo (privacy optics, no real data) and the easiest to *describe* convincingly without building. Show a designed mockup plus the governance framework from doc 07 — that is often more persuasive to a government audience than a working scoring engine, because it proves you thought about the risk.

---

## 2. Sprint plan

### Sprint 0 — Foundation (3–4 days)
Repo scaffold, `CLAUDE.md`, docker-compose stack, contracts package, DB migrations, seed loader, CI skeleton, Keycloak realm.
**Verify:** `docker compose up` → all services healthy → `make seed` → row counts match expected → `/api/v1/health` returns 200.
**Docs:** 02, 03, 05, 08

### Sprint 1 — GANANA core (7–10 days) ← the sprint that matters
Video replay harness, RT-DETRv2 inference, ByteTrack, homography calibration tool, line/zone counting, PCU computation, 5-min aggregation, event emission, manual-count validation harness.
**Verify:** replay a 15-minute Jaipur clip → counts within 8% of your own manual count → accuracy certificate written to the `cameras` table → events land in `traffic_counts`.
**Docs:** 03, 04, 05

> **Get the video now.** This sprint is blocked without real Jaipur junction footage. Options, in order of preference: request archive footage from Traffic Police (ask on your next call); film it yourself from a pedestrian overbridge on Tonk Road with a phone on a tripod (2 hours of footage across peak and off-peak is enough); public webcam archives; drone footage if you have access. **Start this today — annotation is the long pole in the whole project.**

### Sprint 2 — Warehouse & API (5–7 days)
Stream processor, quality scoring, dedup, continuous aggregates, congestion index, REST endpoints, WebSocket, dbt marts.
**Verify:** events → warehouse → `/counts` returns correct aggregates → WebSocket pushes within 2s.

### Sprint 3 — SETU dashboard (7–10 days)
Design tokens, layout, MapLibre map, gnomon arc, live metrics, class mix, alerts, i18n both languages, dark/light, responsive.
**Verify:** full quality bar from doc 06 §8 — including Hindi rendering at 360px and reduced-motion.

### Sprint 4 — DRISHTI intelligence (7 days)
Persistence + LightGBM baselines, then Graph WaveNet only if it beats them. Incident detection. Severity risk model.
**Verify:** backtest on held-out weeks; forecast MAE beats persistence at all three horizons or you ship persistence and say so.

### Sprint 5 — NEETI (5–7 days)
Semantic layer, text-to-SQL with safety rails, hybrid bilingual retrieval, agent loop, numeric verification gate, report generation.
**Verify:** 20 test questions (10 Hindi, 10 English) answered correctly with citations; zero unsourced numerals; SQL injection attempts blocked.

### Sprint 6 — Simulation + 3D (7 days)
SUMO network for the Tonk Road corridor, calibration against measured counts, TraCI scenario runner, R3F twin.
**Verify:** calibration within 10% volume / 15% travel time before any scenario result is shown; twin holds 60fps and degrades gracefully without WebGL.

### Sprint 7 — KAVACH-E (5 days, or mockup)
If real challan data exists: graph, scoring, SHAP, fairness dashboard, audit log, masking. If not: high-fidelity mockup plus the governance framework.
**Verify:** every score has an explanation; unmask writes audit before responding; fairness panel renders.

### Sprint 8 — Hardening & pitch prep (5 days)
Offline mode verified with the network cable physically unplugged, seeded demo state, demo script rehearsed, deck built, DPIA summary written, fallback video recorded.
**Verify:** full demo runs twice, start to finish, offline, without a single fix.

---

## 3. `CLAUDE.md` — create this at the repo root

```markdown
# PRAVAAH — Claude Code Operating Instructions

Traffic decision-intelligence platform for Government of Rajasthan, Jaipur.
Pitch to a senior official in weeks. Production standards, hard deadline.

## Specification
`docs/` is the specification. Read the relevant doc before implementing in its
domain. To deviate, say so and get sign-off. Never deviate silently.

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
   impossible states. 200 lines that could be 50 → rewrite.
2. Surgical changes. Touch only what the task needs. Don't refactor working
   code or reformat adjacent lines. Match existing style. Mention unrelated
   dead code; don't delete it.
3. State a plan before multi-step work: `step → verify: check`. Every task
   needs a real verification — a passing test, a screenshot, a curl response.
   "It works" is not a verification.
4. Surface assumptions and ambiguity. Present options; don't pick silently.
5. Types are defined once in `packages/contracts` and generated to TypeScript.
   Never hand-maintain parallel type definitions.

## Hard prohibitions
- NO facial recognition, person detection/tracking, gait or biometric analysis.
- NO direct model-to-signal actuation. RL output is advisory; a human approves.
- NO raw number plates on the message bus, in logs, in metrics, or in caches.
  Salted hash on the bus; ciphertext direct to DB.
- NO unlabelled synthetic data in the UI. Anything synthetic renders a
  "Simulated data" badge, always.
- NO hardcoded user-facing strings. i18n from the first line.
- NO Ultralytics YOLO in shippable code (AGPL-3.0 procurement blocker).
  Experiments only, with a header comment marking the file non-shippable.
- NO naked numbers in the UI. Every measurement shows quality or confidence.
- If a task drifts toward surveillance, stop and flag it.

## Stack (fixed)
Python 3.12 · FastAPI · Pydantic v2 · SQLAlchemy 2 async · Redpanda ·
Postgres 16 + TimescaleDB + PostGIS + pgvector · MinIO · PyTorch → ONNX →
TensorRT · Prefect 3 · MLflow · SUMO
Next.js 15 App Router · TypeScript strict · Tailwind v4 · Motion (motion/react)
· Lenis · MapLibre + deck.gl · React Three Fiber · next-intl · TanStack Query
Keycloak OIDC · Docker Compose (dev) · Kubernetes (RSDC)

Do not substitute a library without asking.

## Commands
make dev · make seed · make test · make lint · make train MODEL=<id> ·
make eval MODEL=<id> · make replay CAMERA=<id> · make sim SCENARIO=<file>

## Definition of done
Tests pass · lint clean · types check · renders in Hindi and English · works in
dark and light · responsive to 360px · reduced-motion respected · no console
errors · quality/confidence shown on every measurement.

## Context discipline
Read only the docs the current task needs. Don't load all eleven every session.
```

---

## 4. Slash commands

`.claude/commands/`:

**`sprint.md`**
```
Read docs/08 and identify sprint $ARGUMENTS. List its tasks, the docs it needs,
and its verification criteria. Then state a plan as `step → verify: check`
and wait for my approval before writing code.
```

**`verify.md`**
```
For the work just completed, run the verification criteria from the sprint
definition in docs/08. Report each as PASS or FAIL with evidence. Do not claim
success without evidence. If anything fails, fix it and re-verify.
```

**`privacy-check.md`**
```
Review the changes in this session against docs/07. Check specifically:
raw plates in logs/bus/metrics/cache, missing audit-log writes on P2 access,
missing SHAP on any score, unmasked identity by default, retention gaps,
any drift toward person-level tracking. Report findings with file:line.
```

**`i18n-check.md`**
```
Scan for hardcoded user-facing strings. Verify every number formatting call
uses en-IN/hi-IN lakh-crore grouping. Verify place names come from the DB,
not translation files. Report violations with file:line.
```

**`model-card.md`**
```
Generate a model card for $ARGUMENTS in ml/cards/ per docs/04 §10: purpose,
training data, metrics with per-condition breakdown, limitations, fairness
analysis, explicitly excluded features, intended and out-of-scope use.
```

---

## 5. Weekly rhythm

- **Mon** — `/sprint N`, plan, approve
- **Tue–Fri** — build in small verified increments; `/verify` at each
- **Fri** — `/privacy-check` and `/i18n-check`, then demo the week's work to yourself end-to-end
- **Sun** — update `docs/PROGRESS.md`, re-cut scope against the priority list in §1

Keep a `docs/DECISIONS.md` (lightweight ADRs). When the official asks "why Postgres and not a proper time-series database?" — and he or his technical person will — you want a dated, reasoned answer, not an improvised one.

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| No Jaipur video before Sprint 1 | **High** | **Critical** | Film it yourself this week. Do not wait for permission. |
| Counting accuracy below target on 2W | High | High | Oversample 2W in annotation; gate release on 2W recall; report honestly rather than inflating |
| Scope creep across five modules | High | High | Priority list in §1; cut from the bottom without guilt |
| No real challan data | High | Medium | Mockup + governance framework; often more persuasive anyway |
| Government wifi fails at the pitch | Medium | Critical | Offline-first demo; recorded fallback video on the laptop |
| Coursework collision | Medium | High | Sprints 4–7 are the compressible ones |
| Official's department differs from assumption | Medium | High | Doc 10 — ask before Sprint 3 |
| 3060 too slow for full training | Medium | Medium | Fine-tune pretrained; reduce resolution; Colab for one-off runs |

---

## 7. What to attach per sprint

| Sprint | Attach |
|---|---|
| 0 | 02, 03, 05, 08 |
| 1 | 03, 04, 05 |
| 2 | 03, 05 |
| 3 | 05, 06 |
| 4 | 04, 05 |
| 5 | 04, 05, 07 |
| 6 | 03, 04, 06 |
| 7 | 04, 05, **07** |
| 8 | 06, 07, 09 |

Attaching everything every time makes Claude Code vaguer, not smarter. Context is a budget.
