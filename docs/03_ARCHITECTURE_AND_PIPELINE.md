# 03 — Architecture & Pipeline

---

## 1. Architectural thesis

Three commitments that everything else follows from:

**Edge-heavy, cloud-light.** Video never leaves the junction. Inference runs on a Jetson at the pole; only structured events (counts, tracks, violations) travel upstream. This cuts bandwidth by ~99%, sidesteps most DPDP exposure, and survives the flaky connectivity that kills camera-analytics projects in Indian cities. It also lets the pitch say: *your video stays yours and stays where it is.*

**One database until proven otherwise.** PostgreSQL with TimescaleDB, PostGIS and pgvector handles time series, geospatial and embeddings in a single engine with one backup story and one access-control model. A solo builder adding ClickHouse plus Redis plus Elasticsearch plus a vector DB ships nothing. Add a second store only when a benchmark demands it, and write down the benchmark.

**Adapters everywhere the government touches.** Every external system — Abhay, ICCC, VAHAN, e-challan, JCTSL GPS — sits behind an adapter interface with a file-replay implementation and a live implementation. The demo runs on replay. Integration becomes a config change instead of a rewrite. This is the single most important structural decision in the project, because you almost certainly will not get live feeds before the pitch.

---

## 2. Layer diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ L5  SETU — Interface                                                 │
│  Next.js command centre · 3D twin · citizen PWA · officer mobile     │
├─────────────────────────────────────────────────────────────────────┤
│ L4  Intelligence                                                     │
│  DRISHTI (forecast, incident, OD, digital twin)                      │
│  KAVACH-E (defaulter graph, risk, interception)                      │
│  NEETI (bilingual agentic RAG policy copilot)                        │
├─────────────────────────────────────────────────────────────────────┤
│ L3  Semantic / Warehouse                                             │
│  Timescale hypertables · PostGIS road graph · pgvector · dbt marts   │
│  Feature store · MLflow registry · Evidently drift                   │
├─────────────────────────────────────────────────────────────────────┤
│ L2  Stream & Fusion                                                  │
│  Redpanda topics · Faust/Bytewax processors · probe-data fusion      │
│  Calibration · dedup · quality scoring                               │
├─────────────────────────────────────────────────────────────────────┤
│ L1  GANANA — Edge Perception                                         │
│  Jetson: RTSP decode → detect → track → count → classify → events    │
│  Drone batch · phone-survey batch · replay harness                   │
├─────────────────────────────────────────────────────────────────────┤
│ L0  Sources (all behind adapters)                                    │
│  Abhay/ICCC RTSP · ANPR events · VAHAN · e-challan · FIR/accident    │
│  JDA road inventory · JCTSL bus GPS · probe API · weather · events    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Module specifications

### GANANA — Counting & Classification (L1)

**Purpose.** Convert video into structured, defensible traffic measurement.

**Pipeline per camera:**

```
RTSP/file → decode (GStreamer/DeepStream, keyframe-aware)
  → ROI mask + homography (camera → ground plane)
  → detect (RT-DETRv2, INT8 TensorRT)
  → track (ByteTrack, class-aware)
  → classify (IRC vehicle class head)
  → count (virtual line + polygon zone, direction-aware)
  → derive (speed, headway, occupancy, queue length, turning movement)
  → aggregate (5-min bins) → emit event → Redpanda
```

**Outputs per camera per 5-min bin:** counts by IRC class and direction; PCU-normalised volume; mean/85th-percentile speed by class; headway distribution; queue length by approach; occupancy; turning-movement matrix at junctions; a per-bin data-quality score.

**Non-negotiables:**
- **Homography calibration is mandatory.** Pixel-space speed is worthless and will be torn apart by any traffic engineer in the room. Every camera gets a ground-plane calibration and a stored calibration artefact.
- **A human-counted validation set per camera.** You must be able to state counting accuracy per site. Published edge-counting accuracy varies wildly — one Jetson Nano study reported under 50% overall counting accuracy — so an unvalidated claim is a trap. Measure it, publish it, and show the error bars in the UI.
- **Two-wheeler performance is the whole ballgame.** Indian urban fleets are two-wheeler dominant, occlusion is extreme, and generic COCO-trained detectors are weakest exactly there. Budget most of your annotation effort here.
- **Degrade honestly.** Night, rain, fog, glare and dust all degrade counting. Emit a quality score per bin, suppress low-quality bins from policy outputs, and show the suppression in the UI rather than hiding it.

**Modes:** continuous (fixed camera), campaign (drone or tripod, for corridors without cameras), and citizen-survey (phone video upload with pose estimation — cheap coverage extension, useful for the pitch as a "scale without capex" story).

---

### DRISHTI — Network Intelligence (L4)

**Congestion index.** Per road link, per 5 minutes, a 0–100 composite from measured volume/capacity ratio, speed vs free-flow, queue persistence, and probe-data delay. Publish the formula. A black-box index is unusable in a policy file; a published one becomes the number everyone quotes, which is exactly where you want to be.

**Forecasting.** Spatio-temporal GNN over the road graph for 15/30/60-minute horizons, with a LightGBM baseline that must be beaten before the GNN ships. Report MAE/RMSE/MAPE per horizon against the naive persistence baseline. If the GNN doesn't beat persistence, ship persistence and say so.

**Incident detection.** Unsupervised anomaly detection on the count/speed/occupancy joint distribution, plus a supervised classifier once labels accumulate from Dial-100/CAD. Target sub-two-minute detection latency, and track false-positive rate as a first-class metric — an incident detector that cries wolf gets switched off in week two.

**Black-spot risk.** Fuses crash history, geometry, speed distribution, vehicle mix and light/weather into a corridor-segment risk score. Because Jaipur's problem is severity rather than frequency (see doc 01), this model predicts *severity risk*, not crash count. That distinction is your differentiator against every generic ITS vendor.

**OD matrix.** Estimated from vehicle re-identification across camera pairs plus probe-data fusion, with strict privacy handling: re-ID uses hashed, salted, short-TTL appearance signatures, never plate numbers, and the salt rotates daily. Aggregate outputs only.

**Digital twin.** SUMO network of the instrumented corridors, calibrated against measured counts, driven via TraCI. Scenarios: signal-plan changes, median closures, lane reallocation, freight time-windows, one-way conversion, event-day diversions. Always report a confidence band and always state calibration error alongside the result.

---

### KAVACH-E — Enforcement Intelligence (L4)

This module carries the most reputational risk in the entire project. Design it as if it will be audited, because it will be.

**Graph.** Nodes: vehicle, RC holder, challan, violation event, location, time. Edges: registered-to, issued-against, occurred-at. Neo4j-style traversal is achievable in PostgreSQL with recursive CTEs — do not add a graph database for this scale.

**Models:**
- *Repeat-offender risk* — gradient-boosted, on violation history, severity mix, temporal clustering, corridor pattern
- *Recovery propensity* — likelihood a pending challan is recoverable, so effort goes where it works
- *Interception planning* — given risk-ranked vehicles and their spatiotemporal patterns, recommend where and when to deploy for maximum contact

**Mandatory controls (all of these, no exceptions):**
- SHAP explanation surfaced with every score. No unexplained score reaches a human.
- Identity fields masked by default; unmasking is a logged, reason-coded action.
- Immutable audit log of every lookup: who, what, when, why.
- Fairness dashboard: score distribution by vehicle class, by RTO zone, by area. If enforcement recommendations concentrate on one geography or one vehicle class, that must be visible, not buried.
- Human approval gate before any action. The system recommends; an officer decides.
- **Framing discipline:** this is a road-safety targeting tool, not a revenue tool. Every UI string, every report header, every metric name reflects that. Recovery rate is a secondary metric; severity-weighted risk reduction is primary.

---

### NEETI — Policy Copilot (L4)

**Retrieval corpus:** the warehouse itself (via text-to-SQL over a governed semantic layer), plus IRC codes, Motor Vehicles Act provisions, state circulars, JDA DPRs, Smart City documents, past traffic notifications.

**Architecture:** agentic RAG. A planner decomposes the question, tools handle SQL, vector search, simulation invocation and chart generation, and a synthesiser writes the answer with citations. Hybrid retrieval — BM25 plus dense vectors — because Hindi and code-mixed queries break pure-dense retrieval.

**Bilingual handling:** query-language detection, cross-lingual retrieval (Hindi query must retrieve English documents and vice versa), and answer generation in the query's language. Numbers, units and place names are normalised through a shared entity layer so "तोंक रोड", "Tonk Road" and "टोंक रोड" all resolve to the same link ID.

**Outputs:** conversational answers, junction one-pagers, before/after evaluation reports, corridor briefs, and a cabinet-note-format export. Every generated document carries source citations and a generated-on timestamp.

**Hard rule:** NEETI never invents a number. Every figure in output traces to a query result. If data is unavailable, it says so. Wire this as a validation step, not a prompt instruction — parse the generated text for numerals and verify each against the tool-call results before rendering.

---

### SETU — Interface (L5)

Three surfaces:

1. **Command centre** (desktop/wall display) — live map, 3D corridor twin, junction detail, forecast, alerts, scenario runner, defaulter console, NEETI chat
2. **Officer mobile** (PWA) — assigned corridor, live alerts, one-tap incident report, offline queue
3. **Citizen view** (public PWA) — congestion map, route advisory, grievance submission, published-transparency data

Full spec in doc 06.

---

## 4. Data flow — one event's life

```
[Camera, Tonk Road junction, 08:42:15]
  → Jetson decodes frame, detects 47 objects
  → ByteTrack assigns IDs, 12 cross the northbound count line
  → classified: 8 × 2W, 3 × car, 1 × LCV
  → PCU computed (2W=0.25, car=1.0, LCV=1.5) = 6.5 PCU
  → buffered into the 08:40–08:45 bin
  → at 08:45, bin emitted as a CountEvent to Redpanda topic ganana.counts.v1
       ↓
  → stream processor validates schema, attaches link_id from PostGIS,
    scores data quality, deduplicates against overlapping cameras
  → written to Timescale hypertable traffic_counts
       ↓
  → DRISHTI recomputes link congestion index; triggers forecast refresh
  → if index crosses threshold → AlertEvent → WebSocket → dashboard
       ↓
  → dbt nightly rolls into marts: hourly, daily, corridor, weekday-profile
  → NEETI can now answer "how did Tonk Road morning peak change this month?"
```

**Latency budget:** edge inference ≤ 100 ms/frame at 15 fps; event to warehouse ≤ 10 s; alert to dashboard ≤ 2 s; forecast refresh ≤ 60 s.

---

## 5. Deployment topology

### Development (your machines)
`docker compose up` brings up Postgres+Timescale+PostGIS+pgvector, Redpanda, MinIO, Keycloak, FastAPI, Next.js, Prefect, MLflow. Video replay from a local file. Runs fully offline.

### Demo / pitch
Same compose stack on the MacBook, plus a Vercel-hosted public frontend pointed at a seeded read-only API if network is available. **The laptop stack is the primary demo; the cloud one is the backup.** Not the other way round — do not let a government wifi failure kill your pitch.

### Production (RSDC / RajCloud)
- Edge: Jetson Orin Nano per junction cluster, VPN to state network, store-and-forward buffering for connectivity loss
- Core: Kubernetes on RSDC (Jaipur P1/P3/P4, DR at Jodhpur), namespaced by module
- Storage: Postgres HA with streaming replication; MinIO with erasure coding; 90-day hot / 1-year warm / 3-year cold tiering
- Network: everything inside the state network, no public ingress except the citizen PWA behind a WAF
- Identity: Keycloak federated to existing state SSO

**Say this in the pitch:** deployable entirely on-premise at RSDC, no data leaves the state network, no foreign cloud dependency. In a government room that sentence is worth more than any model benchmark.

---

## 6. Repo layout

```
pravaah/
├── CLAUDE.md
├── docs/                       # this pack
├── apps/
│   ├── api/                    # FastAPI — REST + WebSocket
│   ├── web/                    # Next.js — SETU
│   └── edge/                   # GANANA edge runtime
├── packages/
│   ├── ganana/                 # detection, tracking, counting, calibration
│   ├── drishti/                # forecasting, incident, OD, twin
│   ├── kavach/                 # defaulter graph + risk
│   ├── neeti/                  # RAG, agents, report generation
│   ├── contracts/              # Pydantic + TS types, generated from one source
│   └── adapters/               # Abhay, ICCC, VAHAN, e-challan, probe, GIS
├── data/
│   ├── raw/  processed/  seeds/  fixtures/
├── ml/
│   ├── training/  evaluation/  configs/  notebooks/
├── sim/                        # SUMO networks, scenarios, calibration
├── infra/
│   ├── docker/  k8s/  terraform/
└── scripts/
```

**Contracts rule:** types are defined once in `packages/contracts` as Pydantic models and generated into TypeScript. Never hand-maintain parallel type definitions — that divergence is the most reliable source of bugs in a project like this.

---

## 7. Non-functional requirements

| Concern | Target |
|---|---|
| Edge inference | ≥15 fps per stream on Jetson Orin Nano, ≤100 ms/frame |
| Counting accuracy | ≥92% vs manual count in daylight; ≥85% at night. Both **measured and displayed**, never assumed |
| Classification accuracy | ≥90% macro-F1 across IRC classes; two-wheeler recall ≥93% |
| API p95 latency | ≤200 ms |
| Dashboard first contentful paint | ≤1.5 s |
| Forecast MAE | Must beat persistence baseline at every horizon, or ship the baseline |
| Availability | 99.5% core; edge degrades to store-and-forward |
| Data retention | Raw video 7 days at edge, never centralised; events 3 years; aggregates indefinite |
| Accessibility | WCAG 2.2 AA |
| Languages | Hindi + English, full parity |

---

## 8. Explicit non-goals for v1

Write these down so scope creep has to argue with a document:

- Facial recognition or person identification — permanently out of scope, on principle
- Autonomous signal actuation — recommendation only
- Statewide rollout — Jaipur corridors only
- Public transport scheduling optimisation — Phase 2
- Parking management — Phase 2 (hooks only)
- Toll or congestion-pricing implementation — Phase 3, policy-dependent
- Native mobile apps — PWA only
