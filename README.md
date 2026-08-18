# PRAVAAH · प्रवाह

**Traffic decision intelligence for Jaipur.** A measurement layer over camera
feeds the Government of Rajasthan already owns.

---

## The problem

Jaipur runs ~35 lakh vehicles on a network it cannot measure. The state owns
~6,484 cameras on the Abhay Command Centre, ITMS at 30 locations, live ANPR
e-challan, and a Smart City ICCC. What it does not have is a way to answer, for
any junction on any given Tuesday: **how many vehicles, of what kind, moving in
which direction.**

Commercial probe data — Google, TomTom, HERE — measures *speed and delay*. It is
structurally incapable of measuring *volume and composition*, because it infers
congestion from sampled devices rather than counting vehicles. Yet signal cycle
design, lane allocation, freight time-windows, permit policy, parking tariffs
and capacity analysis all require volume and composition.

The consequence is visible in the safety numbers. Jaipur recorded 3,664 crashes
in 2025, **5.6% fewer** than 2024 — while deaths rose **3.1%** to 1,273, pushing
the fatality rate to a five-year high of 34.7 per 100 crashes. Crashes down,
deaths up. That is a *severity* problem: specific corridors, specific hours,
specific vehicle mixes. None of those three variables is currently instrumented.

PRAVAAH is the software layer that turns existing feeds into classified counts,
congestion forecasts, defaulter risk intelligence and bilingual policy evidence
— **without procuring a single new camera.**

## Modules

| Module | | Purpose |
|---|---|---|
| **GANANA** | गणना | Counting and classification. IRC-class counts, PCU-normalised volume, turning movements, speed distribution, queue length — per approach, per direction, per 5-minute bin. |
| **DRISHTI** | दृष्टि | Network intelligence. Congestion index, 15/30/60-minute forecasts, incident detection, severity risk, OD matrix, SUMO-backed scenarios. |
| **KAVACH-E** | कवच | Enforcement intelligence. Defaulter graph and risk scoring — explainable, audited, masked by default, fairness-monitored. A road-safety targeting tool, never a revenue tool. |
| **NEETI** | नीति | Bilingual policy copilot. Agentic RAG over the warehouse and policy corpus, answering in Hindi or English with every figure traced to a source row. |
| **SETU** | सेतु | Interface. Command centre, public site, citizen PWA, officer PWA. Bilingual, light/dark, accessible. |

## Design

The interface is built after the **Jantar Mantar**. Jai Singh II built the
world's largest stone sundial here in 1734 to *measure* what everyone else only
observed — the Samrat Yantra reads time to two seconds using a calibrated arc
and a shadow. PRAVAAH is a measurement instrument for the same city, three
centuries later, so the interface borrows the yantras' calibrated arcs, brass
gradations and engraved numerals.

The signature element is the **gnomon arc**: the corridor's day rendered on a
calibrated scale, hours along the arc, congestion as radial distance, the
current moment a brass indicator. It reads at a glance — the evening bulge is
visibly bigger than the morning one — and it is unmistakably this product.

## Principles

These are enforced by tests, database constraints and CI, not by good intentions.

- **No naked numbers.** Every measurement displays its quality or confidence.
- **Synthetic data is always labelled.** Any figure derived from a synthetic row
  renders a "Simulated data" badge. Always.
- **Degrade honestly.** Night, rain and glare reduce counting accuracy. The
  quality score is emitted per bin, low-quality bins are suppressed from policy
  outputs, and *the suppression is shown* rather than hidden.
- **No unexplained score reaches a human.** SHAP accompanies every risk score —
  a database `CHECK` constraint rejects a score without its explanation.
- **The raw number plate is never stored or transmitted.** Only a salted
  HMAC-SHA256 digest and envelope ciphertext; a constraint refuses anything
  plate-shaped, and CI greps for leakage.
- **The audit log is append-only by grant**, not by convention. Attempting an
  `UPDATE` as the application role fails.
- **Human-in-the-loop is mandatory.** The system recommends; a person decides.
  There is no code path from a model to signal actuation.
- **Built to full DPDP compliance** without relying on the government exemption.

## Data provenance

| Source | Real or synthetic |
|---|---|
| Road network geometry | **Real** — OpenStreetMap, Jaipur |
| Congestion profile shape | **Real** — calibrated to TomTom Traffic Index 2025 |
| Crash annual totals | **Real** — published Jaipur Police figures |
| Vehicle counts | Synthetic, on the calibrated profile. Every row badged. |
| Violations and defaulters | Synthetic. Every row badged. |

The seed profile reproduces four published TomTom measurements exactly —
average congestion 58.7%, morning peak 73.9%, evening peak 94.9%, rush-hour
speed 17.5 km/h — and a test suite fails the build if it ever stops doing so.

## Stack

Python 3.12 · FastAPI · Pydantic v2 · SQLAlchemy 2 async · PostgreSQL 18 +
TimescaleDB + PostGIS + pgvector · Redis Streams · RT-DETRv2 + ByteTrack ·
Next.js 16 · TypeScript · Tailwind v4 · Motion · MapLibre · React Three Fiber ·
next-intl · Keycloak OIDC + Postgres row-level security

No Docker. No Ultralytics (AGPL-3.0 is a procurement blocker). No Google Maps.

## Running it

```bash
make install     # uv sync + pnpm install
make up          # local stack: Postgres+TimescaleDB, Redis, MinIO
make migrate     # schema
make seed        # 90 days on the calibrated profile
make api         # http://localhost:8001/api/v1/docs
make web         # http://localhost:3000
```

Then `make verify-security` to prove the database-level controls hold, and
`make test lint typecheck` for the rest.

## Documentation

`docs/` is the specification. `docs/DECISIONS.md` records every deviation from
it, dated and reasoned — where the two conflict, DECISIONS wins.

---

*Built for a pitch to the Government of Rajasthan. Not an official government
product.*
