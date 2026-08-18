# 02 — MASTER PROMPT (paste into Claude Code)

> Paste everything below the line into Claude Code as the opening brief, with `docs/` populated with this pack. It is written to be read by a coding agent, not a human — it is directive, constrained, and states what *not* to do as much as what to do.

---

## PROJECT BRIEF — PRAVAAH (प्रवाह)

You are the lead engineer building **PRAVAAH**, a traffic decision-intelligence platform for the Government of Rajasthan, Jaipur. This is a real pitch to a senior government official within weeks. Treat it as production work with a hard demo deadline, not a prototype.

### Your operating rules

1. **The docs in `docs/` are the specification.** Read them before implementing anything in their domain. If you want to deviate, say so and wait for my sign-off. Never deviate silently.
2. **Simplicity first.** Minimum code that solves the problem. No speculative abstraction, no configurability I did not ask for, no error handling for impossible states. If you write 200 lines where 50 would do, rewrite it.
3. **Surgical changes.** When editing existing code, touch only what the task requires. Don't refactor working code, don't "improve" adjacent formatting, match existing style. If you spot unrelated dead code, mention it — don't delete it.
4. **Every task gets a verification.** State the plan as `step → verify: check` before you build. "It works" is not a check. A passing test, a rendered screenshot, a curl response is.
5. **Surface assumptions.** If a spec is ambiguous, name the ambiguity and present the options. Don't pick silently.
6. **No fabricated data in the demo path.** Synthetic and simulated data is fine and expected — but it must be labelled as such in the UI, always. Never let a screenshot imply we have live government feeds we don't have. This is a government pitch; one fabricated number destroys the whole thing.
7. **Bilingual from the first component, not retrofitted.** Every user-facing string goes through i18n from the moment it is written. Hindi is a first-class language here, not a translation layer.

---

### The problem, in one paragraph

Jaipur runs ~35 lakh vehicles on a network it cannot measure. The state already owns ~6,484 cameras, an Abhay Command Centre, ANPR e-challan, and a Smart City ICCC — but has no continuous, classified, corridor-level count of what is actually moving. Commercial probe data (Google, TomTom) measures speed and delay, and is structurally incapable of measuring volume or vehicle composition, which is what road capacity, signal design, freight policy and permit decisions actually require. Meanwhile crashes fell 5.6% in 2025 while deaths rose 3.1%, and ~8 lakh e-challans sit unpaid. PRAVAAH is the software layer that turns existing feeds into counts, forecasts, defaulter intelligence and policy evidence. Full evidence: `docs/01_PROBLEM_AND_EVIDENCE.md`.

### What PRAVAAH is NOT

- Not a camera procurement. We install nothing.
- Not an ANPR vendor. We consume ANPR events; we don't sell plate readers.
- Not an autonomous signal controller in v1. The RL module **recommends**, a human approves. Never wire a model directly to live signal actuation. This is a safety line; do not cross it even if it would demo better.
- Not a surveillance tool. We count vehicles and detect violations. We do not do face recognition, person tracking, or individual movement profiling. If a task drifts toward any of those, stop and flag it.

---

### The five modules

Build in this order. Each must work standalone before the next starts.

**1. GANANA (गणना) — Counting & Classification Engine**
Consumes RTSP/video/drone footage. Outputs classified vehicle counts (IRC classes), PCU-normalised volume, turning-movement counts, speed distribution, headway, queue length, and occupancy — per approach, per direction, per 5-minute bin. This is the module that answers "how many and what kinds." It is the heart of the product; everything else is downstream. Spec: `docs/04_AI_MODELS_SPEC.md` §2–4.

**2. DRISHTI (दृष्टि) — Network & Congestion Intelligence**
Fuses GANANA counts with probe data and GIS road inventory. Produces per-link congestion index, 15/30/60-minute forecasts, incident detection, black-spot risk scoring, an OD matrix estimate, and a SUMO-backed what-if simulator for scenario comparison. Spec: `docs/04_AI_MODELS_SPEC.md` §5–7.

**3. KAVACH-E (कवच) — Enforcement & Defaulter Intelligence**
Consumes ANPR + violation events. Builds a defaulter graph, repeat-offender risk scores, recovery-propensity models, and interception-point recommendations. **Hard requirement:** every score is explainable, every action is human-approved, every access is audited, and fairness metrics are computed and displayed. Spec: `docs/04_AI_MODELS_SPEC.md` §8 and `docs/07_SECURITY_PRIVACY_COMPLIANCE.md`.

**4. NEETI (नीति) — Bilingual Policy Copilot**
Agentic RAG over the warehouse plus policy corpus (IRC codes, MV Act, state circulars, past DPRs). Answers questions in Hindi or English, generates junction reports, before/after impact evaluations, and cabinet-note-grade briefs with citations back to source data. This module is what turns "we have dashboards" into "we help you write policy." Spec: `docs/04_AI_MODELS_SPEC.md` §9.

**5. SETU (सेतु) — Interface Layer**
Next.js command-centre dashboard with a 3D digital twin of instrumented corridors, plus a citizen-facing PWA. Bilingual, light/dark, motion-rich, accessible. Spec: `docs/06_DESIGN_SYSTEM_AND_FRONTEND.md`.

---

### Stack (fixed — do not substitute without asking)

**Backend:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.x async
**Streaming:** Redpanda (Kafka API) — single binary, no ZooKeeper
**Store:** PostgreSQL 16 + TimescaleDB + PostGIS + pgvector. One database for time series, geospatial and vectors. Do not add a second database unless a benchmark proves you must.
**Object store:** MinIO (S3 API) for clips and model artefacts
**CV runtime:** PyTorch for training; ONNX Runtime + TensorRT for inference
**Orchestration:** Prefect 3
**ML lifecycle:** MLflow (registry) + Evidently (drift)
**Simulation:** SUMO + TraCI
**Frontend:** Next.js 15 App Router, TypeScript strict, Tailwind v4, Motion (`motion/react`), Lenis, React Three Fiber + drei, MapLibre GL + deck.gl, next-intl
**Auth:** Keycloak, OIDC, RBAC + ABAC
**Deploy:** Docker Compose for dev; Kubernetes manifests for RSDC/RajCloud; Vercel + Railway/Supabase for the public demo

**Licence constraint that matters:** Ultralytics YOLO is AGPL-3.0. That is a procurement blocker for government deployment and a real risk if anyone reads the licence. Default to **RT-DETRv2 (Apache-2.0)**. You may use Ultralytics for fast local experimentation only, and every such file must carry a header comment marking it as experiment-only, non-shippable. Flag this to me if it ever reaches shippable code.

---

### Constraints

- **Hardware:** MacBook Pro M4 Pro (primary dev), Windows desktop with RTX 3060 12GB (training). Assume no cloud GPU budget. Every model must train on a 3060 or be a fine-tune of something pre-trained. If a spec'd model can't, say so immediately.
- **Cost:** free tier wherever possible. No paid API in the critical demo path except a metered LLM for NEETI, with an offline fallback.
- **Data:** assume no live government feed until I tell you otherwise. Build every ingest path against a **replayable file source first**, with the live source as a swappable adapter behind the same interface. This is non-negotiable — it is what lets the demo run on a laptop with no network.
- **Offline demo:** the entire demo must run with the network cable pulled. Seeded database, recorded video, cached tiles. Government wifi will fail. Plan for it.

---

### Definition of done for the pitch

A working system where:

1. A recorded Jaipur junction video plays, and vehicles are counted and classified live on screen, by type, by direction, with a running PCU total. Numbers on screen match a manual count within acceptable error, and the error is displayed honestly.
2. A dashboard shows the corridor's congestion index now, the forecast for the next hour, and how today compares to the weekly baseline.
3. A "what-if" panel runs a scenario — close a median, change a signal cycle, restrict freight to off-peak — and shows a simulated delta with confidence bounds and a stated uncertainty.
4. A defaulter view shows risk-ranked vehicles with an explanation for each score, an audit-log entry for each lookup, a fairness panel, and a masked-by-default identity field.
5. NEETI answers a question in Hindi and English — e.g. "तोंक रोड पर सुबह के व्यस्त समय में कितने वाहन?" — with the answer traced to specific data rows.
6. Every screen works in Hindi and English, light and dark, on a phone and on a control-room display.
7. It all runs offline from `docker compose up`.

---

### First task

Do not write feature code yet.

1. Read `docs/03_ARCHITECTURE_AND_PIPELINE.md` and `docs/08_BUILD_PLAN_AND_CLAUDE_MD.md`.
2. Create `CLAUDE.md` at the repo root exactly as specified in doc 08.
3. Scaffold the monorepo per the layout in doc 08 — directories, `pyproject.toml`, `package.json`, `docker-compose.yml`, `.env.example`, `Makefile`, CI skeleton. Config and structure only.
4. Print the resulting tree and stop.

Then wait for me. We will go sprint by sprint.
