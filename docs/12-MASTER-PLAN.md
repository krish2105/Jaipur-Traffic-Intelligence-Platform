# PRAVAAH — Master Implementation Plan

**Version 1.0 · 19 August 2026 · 14-day extension**
**Classification:** internal — commercial in confidence

---

## 0. The one-paragraph version

Jaipur's crashes fell 5.6% in 2025 and its road deaths rose 3.1%. The city is
getting *safer at colliding* and *worse at surviving* — 34.7 deaths per 100
crashes, a five-year high. Meanwhile 87.86% of Rajasthan's enforcement effort
goes to over-speeding, which suppresses crash **frequency**, the number already
improving. Severity is driven by what is in the traffic: a fleet that is ~61%
two-wheelers, and nationally 73% of two-wheeler deaths are unhelmeted. **Jaipur
is spending 88% of its enforcement on the metric that is already going the right
way.** No probe product, no camera count, and no adaptive signal can see that,
because all three measure flow and none of them measure composition. PRAVAAH
measures composition. That is the company.

---

## 1. What changed after research

Three facts that reshape the plan. All are cited in §12.

**1.1 The signal-control seat is taken.** Jaipur Police ran an AI signal trial at
Rambagh Circle (3 Jun – 11 Jul 2026) with Data Core Infotech. It cleared 4,88,140
vehicles unattended, saved 8–45s per lane and 2,535 kg CO₂ over 39 days. They are
now wiring **253 of Jaipur's 423 intersections**. Phase 2 is **multi-junction
synchronisation**.

**1.2 The severity gap is real and public.** 2024: 3,881 crashes. 2025: 3,664
crashes (−5.6%) and 1,273 deaths (+3.1%). Fatality rate 34.7 per 100 — highest in
five years. Compiled across Jaipur East, West, North, South and Rural districts.

**1.3 Enforcement is monocultured.** Rajasthan 2025: 27.61 lakh challans, up
10.13 lakh year on year, 76% recovery — the best rate in India. Jaipur alone
booked ₹32 crore. The mix: **over-speeding 87.86%, helmet 6.67%, parking 4.73%.**

The owner has directed that PRAVAAH compete as a full ITMS platform rather than
sit above the incumbent as an evidence layer. §3 sets out how that is won, and
§3.4 states the risk plainly.

---

## 2. The technical wedge

A competing ITMS must beat Data Core Infotech at the thing they are about to
build — corridor synchronisation. There is a real and defensible edge:

> **Standard ITMS allocates green time by vehicle count. A two-wheeler and a
> truck are not the same vehicle.**

Signal timing is a capacity problem, and capacity is measured in PCU (passenger
car units), not vehicles. IRC:106 puts a two-wheeler at ~0.5 PCU and a truck at
~3.0. In a fleet that is 61% two-wheelers, an arm carrying 200 two-wheelers and
an arm carrying 200 mixed vehicles have the **same vehicle count and roughly half
the demand difference** — so a count-driven controller systematically over-serves
two-wheeler-heavy approaches and starves freight-heavy ones. It is not a tuning
error; it is a units error. §2.2 tested whether it *compounds* along a corridor
and it does not — it accumulates, which is a weaker and more accurate word.

PRAVAAH's detection classifies to 12 vehicle classes and converts to PCU before
optimising.

### 2.1 What the simulation actually showed — claim corrected

This section previously asserted the PCU plan would simply beat the count plan.
`scripts/compare_pcu_signal.py` ran it in SUMO across a demand sweep, and that
assertion is **wrong**. The corrected finding is more useful.

Two arms, identical 900 veh/h, north-south 75% two-wheelers, east-west with
freight. Same network, seed and cycle; only the split differs.

| veh/h per arm | EW v/c | mean vehicle delay | PCU-weighted delay | freight arm |
|---|---|---|---|---|
| 600 | 0.47 | **−0.9 s worse** | +1.0 s better | **+6.1 s better** |
| 1000 | 0.79 | **−0.8 s worse** | +1.3 s better | **+6.7 s better** |
| 1400 | 1.10 | **−1.2 s worse** | +1.4 s better | **+7.3 s better** |
| 1600 | 1.26 | **−1.5 s worse** | +1.1 s better | **+7.5 s better** |

PCU timing **never** wins on mean vehicle delay, at any demand tested including
oversaturation. It cannot: the two-wheeler arm carries the same vehicle count at
roughly half the PCU, so giving it less green makes *more* vehicles wait longer
while *fewer, larger* vehicles clear faster. That is arithmetic, not a tuning
failure, and no amount of retuning changes its sign.

**So the wedge is not "our timing is better". It is this:**

> A count-based controller receives **identical input from both arms** and
> cannot see that a choice exists. PCU timing surfaces the trade-off — about
> 7 seconds off every bus and truck, for about 1 second more on the average
> vehicle — and puts it in front of the person entitled to make it.

That is a stronger position for this project, not a weaker one. Whether a city
serves vehicles or serves capacity is a policy decision about freight, buses and
public transport priority. It belongs to a Commissioner, not to a units
convention buried in a vendor's firmware. And it is exactly the shape of claim
that fits §3.3: the system computes the options and a human decides.

**How to demo it:** show the two plans, show that the count-based input is the
same number on both arms, and ask the room which arm they would rather protect.
The answer is theirs. The point is that today nothing asks them.

### 2.2 Corridor synchronisation — "compounds" was also wrong

`scripts/compare_pcu_corridor.py`: one arterial through 1–5 signalised
junctions at 600 m spacing, a cross street at each, **five seeds per point**
because the first single-seed run showed 5 junctions scoring worse than 4, which
was noise rather than a mechanism.

Both plans differ in the two things a green wave is made of — the split, and the
offset. The count plan times offsets to the posted 13.9 m/s. The PCU plan times
them to 13.71 m/s, the speed the platoon can actually hold given a fifth of it
is buses and trucks.

| junctions | arterial saved | [min, max] | per junction | cross-street cost |
|---|---|---|---|---|
| 1 | 3.8 s | 3.6 – 4.2 | 3.80 | 5.7 s |
| 2 | 5.0 s | 4.7 – 5.5 | 2.50 | 5.8 s |
| 3 | 7.0 s | 5.8 – 7.4 | 2.33 | 5.9 s |
| 4 | 12.9 s | 11.9 – 13.8 | 3.23 | 5.8 s |
| 5 | 13.0 s | 10.4 – 14.3 | 2.60 | 5.8 s |

**The total arterial benefit grows with corridor length — 3.8 s to 13.0 s — but
the per-junction benefit does not.** It sits flat at 2.3–3.8 s with no trend. So
the effect is *additive*, not compounding: every junction you get right is worth
about the same, and a longer corridor simply has more of them. §2 previously
said "compounds". That was wrong and is corrected here.

And in whole vehicle-seconds the net oscillates around zero — +1,176, −888,
−2,304, +1,632, −1,632 across 1 to 5 junctions — because the arterial carries
one flow while the cross streets carry *n* of them. Exactly as at the single
junction in §2.1, **PCU timing redistributes delay rather than removing it**: it
moves time from the arterial and its freight onto the cross streets.

That is the honest shape of the product, and it is the same conclusion twice
from two independent experiments. The value is not a free saving. It is that the
redistribution becomes **visible and controllable** — a count-based controller
performs one of these allocations by accident, having never measured the
quantity that distinguishes them.

**Second wedge — the enforcement allocator.** Nobody in this market ships a tool
that answers "given my crash severity profile and my fleet composition, where
should my next 1,000 challans go?" That is a composition question, and §1.3 says
the current answer is wrong.

---

## 3. Positioning and competitive strategy

### 3.1 What we claim
Full ITMS scope: detection, classification, junction optimisation, corridor
synchronisation, violation detection, enforcement analytics, policy simulation.

### 3.2 What we claim *better*
| Capability | Incumbent | PRAVAAH |
|---|---|---|
| Vehicle detection | count | **12-class + PCU conversion** |
| Green-time basis | vehicles | **PCU-weighted, trade-off surfaced (§2.1)** |
| Corridor sync | phase 2, planned | SUMO-measured, 5 seeds, §2.2 |
| Severity analytics | not offered | **core product** |
| Enforcement allocation | not offered | **core product** |
| Model licence risk | unknown | Apache-2.0 detection, audited |
| Data protection | unknown | DPDP-native, plate ciphertext |

### 3.3 What we do *not* claim
Direct signal actuation. Per `CLAUDE.md`, signal output is advisory and a human
approves. This is kept as a **feature**, not a limitation: an ITMS that cannot be
made to do something unsafe by a model failure is the one a Commissioner can
defend after an incident. Every accepted or rejected plan is written to an
immutable audit trail with the officer's identity.

### 3.4 The risk of head-to-head, stated plainly
The incumbent has a live deployment, a public success, and a relationship. A
challenger with no field-deployed cameras wins on evidence or not at all — which
is why §2's PCU comparison and §1.3's enforcement finding must be reproducible on
stage, from open data, with sources on screen. If the room wants a signal vendor,
we lose. If the room wants to know why its people are still dying, we win.

---

## 4. Architecture and infrastructure

Existing stack stands. Additions marked **NEW**.

```
INGEST        OSM · MoRTH/Rajasthan crash tables · VAHAN mix · IMD · CPCB
              RTSP/replay video → RT-DETRv2 (Apache-2.0) → ByteTrack
              NEW  challan mix ingest · NEW  fleet-composition ingest

STORE         Tiger Cloud (Postgres 17 + TimescaleDB + PostGIS + pgvector)
              hypertables: traffic_counts · link_congestion · incidents
              NEW  enforcement_actions · fleet_registry · doc_chunks(vector)

COMPUTE       FastAPI + Pydantic v2 · Redis Streams · APScheduler
              SUMO 1.27 corridor model · BPR link performance
              NEW  PCU-weighted Webster/adaptive optimiser
              NEW  severity model (crash → KSI probability by composition)
              NEW  enforcement allocator (constrained optimisation)
              NEW  RAG: local embeddings → pgvector → cited retrieval
              NEW  agent: deterministic planner over NEETI catalogue + RAG

SERVE         Next.js 16 App Router · MapLibre + deck.gl atlas · R3F city
              WebSocket push · offline snapshot (ADR-062)

HOST          Vercel (web) · Render (api, blocked on card) · Tiger Cloud (db)
```

**Infrastructure required for the pitch** (cost, monthly, INR):

| Item | Spec | Cost |
|---|---|---|
| Tiger Cloud | free tier, 8 GB | ₹0 |
| Vercel | Hobby | ₹0 |
| Render API | Starter 512 MB | ~₹600 |
| Domain | .in | ~₹80 |
| Map tiles | self-host or MapTiler free | ₹0 |
| **Total to demo** | | **~₹700/mo** |

Production for one corridor adds an edge box per 4 cameras (Jetson Orin Nano
class, ~₹45k capex each) and object storage. No GPU cloud: inference is at the
edge, which is also the DPDP argument — plates never leave the junction in clear.

---

## 5. The 14-day plan

Each day ends with something demonstrable. "Verify" is a real check, not "it
works".

### Week 1 — the argument

**Day 1 · Real crash + enforcement data**
Ingest Jaipur 2025 crash figures (3,664 / 1,273 / 34.7 per 100), the 5-district
split, and the Rajasthan challan mix. Replace synthetic incident totals.
*Verify:* API returns 1,273 for 2025 deaths; every figure carries a source URL.

**Day 2 · Severity model**
KSI probability as a function of composition, hour, light condition, road class.
Fit on published tables; publish coefficients and CI.
*Verify:* held-out MAE reported on the panel; refuses to render without CI.

**Day 3 · The enforcement allocator**
Constrained optimiser: given crash severity by cause and current challan mix,
output the reallocation that minimises expected KSI. Outputs lives and rupees.
*Verify:* reproduces the 87.86/6.67 baseline, then shows the counterfactual.

**Day 4 · PCU vs count comparison**
SUMO scenario, one junction, two plans. Chart delay and queue by approach.
*Verify:* both plans run in SUMO; the delta is stated with the seed and config.

**Day 5 · Corridor synchronisation**
Green wave over the Tonk Road model corridor, PCU-weighted. Human-approval gate.
*Verify:* bandwidth improvement measured in SUMO, not asserted.

**Day 6 · RAG over real policy documents**
Ingest MoRTH tables, Rajasthan road-safety policy, IRC standards, our own ADRs.
Local embeddings → pgvector. Answers cite passage and page.
*Verify:* every answer renders a citation; an uncited answer is suppressed.

**Day 7 · Agentic layer**
Deterministic planner: decomposes a question into catalogue queries + retrieval,
shows its plan before executing, and never fabricates a number.
*Verify:* the plan is visible and each step's SQL is inspectable.

### Week 2 — the surface

**Day 8 · Pink UI completion** — gulaabi across every route, all charts retuned,
360px responsive, reduced-motion, both languages.
**Day 9 · Atlas maps everywhere** — citizen, officer, city, dashboard.
**Day 10 · KPI layer** — §6 built as real panels.
**Day 11 · Officer PWA + offline rehearsal** — service worker tested with the
network genuinely down.
**Day 12 · Security pass** — §7 audited and evidenced.
**Day 13 · Commercial pack** — §8 as a one-page costed proposal.
**Day 14 · Rehearsal** — full run with the cable pulled, twice.

---

## 6. KPIs

### 6.1 Outcome KPIs — what the government is buying
| KPI | Baseline (2025, real) | 12-month target |
|---|---|---|
| Fatality rate per 100 crashes | **34.7** | ≤ 31.0 |
| Road deaths, Jaipur | **1,273** | ≤ 1,210 |
| Helmet share of enforcement | **6.67%** | ≥ 18% |
| Challan recovery rate | **76%** | ≥ 80% |
| Corridor delay, evening peak | 94.9% over free-flow | ≤ 85% |

### 6.2 System KPIs — what we guarantee
Classification F1 ≥ 0.85 per class · counting MAPE ≤ 12% · forecast beats
persistence baseline · API p95 < 400 ms · plan generation < 5 s per junction ·
uptime ≥ 99.5% · zero plates in logs, metrics, caches or on the bus.

### 6.3 Adoption KPIs
Officer decisions recorded per week · % advisories reviewed within 15 min ·
NEETI questions asked per official per week · corridors under management.

---

## 7. Security, privacy, DPDP

Non-negotiable and already partly built:
- No facial recognition, person detection, gait or biometric analysis. Ever.
- Plates: salted hash on the bus; ciphertext direct to DB; never in logs,
  metrics or caches. Officer sees the plate only through a role-gated,
  audit-logged reveal.
- Edge inference so raw video never leaves the junction.
- RBAC mirrored client and server, Postgres RLS, Keycloak OIDC.
- Immutable audit trail for every signal decision and every plate reveal.
- Data retention: detections 90 days, aggregates indefinite, video 7 days.
- DPIA written before any real camera is connected.
- Detection model Apache-2.0; no AGPL anywhere in shippable code.

**Threat model additions for a competing ITMS:** signal-plan tampering (mitigated
by human approval + signed plans), model poisoning via adversarial road markings
(mitigated by PCU sanity bounds and anomaly rejection), and insider plate lookup
(mitigated by per-reveal justification capture).

---

## 8. Commercial model

**Route:** GeM listing, sold to Jaipur Police Commissionerate, JDA, or the Smart
City SPV. Per-corridor annual licence so it can be bought without a fresh tender.

**Anchors (all real):** Jaipur challan revenue ₹32 crore · Rajasthan recovery 76%
· national road safety allocation ₹400 crore FY 2026-27 · Noida ITMS ₹64 crore as
a comparable capital project.

**Indicative pricing** — to be validated, not quoted yet:

| SKU | Scope | Annual |
|---|---|---|
| Corridor | 1 corridor, ≤ 40 links | ₹18–24 lakh |
| Zone | 1 police zone | ₹90 lakh – ₹1.2 cr |
| City | Jaipur, 423 junctions | ₹3.2–4.5 cr |
| Severity module | add-on, any tier | ₹12 lakh |

**The value argument, at the city tier:** a 3-point improvement in fatality rate
(34.7 → 31.7) is roughly **110 lives a year**. At the Ministry's own value of
statistical life used in road-safety appraisal, that alone is an order of
magnitude above the licence. The enforcement reallocation is separately
self-funding: Rajasthan already recovers 76% of what it issues.

**Land-and-expand:** one paid corridor (Tonk Road, already modelled) → zone →
city → other Rajasthan cities → other states.

---

## 9. Roles and ownership

Single-operator project; these are hats, not headcount.

**CEO/CTO** — the §2 wedge is the company; do not let the demo drift into being a
prettier dashboard. **COO** — the 14-day plan ships daily or it is re-cut.
**Product** — every panel answers a question an official actually asks.
**Data** — no number without provenance and quality. **AI** — deterministic before
generative; never let a model invent a figure. **Security** — the prohibitions in
§7 are not negotiable for any demo effect. **Design** — pink is chrome, never
data (ADR-063). **PM** — cut breadth before depth.

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Incumbent relationship beats challenger evidence | **High** | Lead with §1.3, which is their blind spot, not their turf |
| No real per-link counts in 2 weeks | **High** | Label synthetic honestly; the argument runs on real crash + challan data |
| No video footage available | Medium | Owner has confirmed none; classification demoed on public benchmark clips |
| Render blocked on payment card | Medium | Offline snapshot already ships (ADR-062) |
| Two weeks is not enough for all of §5 | Medium | Week 1 is the argument and is sufficient alone; week 2 is surface |
| Pink misread as unserious | Low | Heritage rose + restrained magenta; ramp untouched |

---

## 11. What is deliberately not in scope

Facial recognition. Direct actuation. Real-time plate lookup at citizen level.
Predictive policing of individuals. Any claim about a figure we cannot cite.

---

---

## 13. Build status

Updated 19 August 2026, overnight run. Everything below is deployed and
verified in production at
<https://jaipur-traffic-intelligence-platfor-nine.vercel.app>.

| Plan item | State | Evidence |
|---|---|---|
| §5 D1 · real crash + enforcement data | **done** | `/safety/severity`, no DB read, every figure carries its URL |
| §5 D3 · enforcement allocator | **done** | `/enforcement/allocation` — 73.7 / 23.3 / 3.0, +18.5 lives/yr |
| §5 D6 · RAG over the corpus | **done** | 362 chunks, 15 docs, BM25 in-browser, cited |
| §5 D7 · agentic layer | **done** | plans before answering, shows the plan, refuses on a miss |
| §5 D8 · pink UI | **done** | gulaabi default, contrast gate passes on 6 palettes |
| §5 D9 · atlas maps | **partial** | console 2D done; citizen / officer / city still to wire |
| §5 D2 · severity model | not started | |
| §5 D4 · PCU vs count | **done** | `compare_pcu_signal.py`, 6-point demand sweep in SUMO — and it corrected §2, see §2.1 |
| §5 D5 · corridor sync | **done** | `compare_pcu_corridor.py`, 1–5 junctions x 5 seeds — corrected §2 again, see §2.2 |
| §5 D10–14 | not started | |

**Free tier throughout.** No API host, no keyed tiles, no model provider, no
paid storage. Total running cost is zero: the deployment serves a captured
snapshot (ADR-062) and the RAG index is a static asset searched client-side.

**Known limits, stated rather than buried.** The allocator's recommendation
holds for saturation K ≥ 2 and is reported with that boundary. Retrieval is
lexical, so a paraphrase sharing no vocabulary is missed. Per-link hourly counts
and camera detections remain synthetic and badged; only the crash, enforcement
and fleet figures are real.

## 12. Sources

All accessed 19 August 2026.

- Jaipur AI signals, Rambagh trial, 253/423 junctions, Data Core Infotech —
  <https://www.pinkcitypost.com/jaipur-to-roll-out-ai-traffic-signals-at-253-intersections-after-successful-rambagh-circle-trial/>
- Jaipur AI signals, camera throughput —
  <https://udaipurkiran.com/jaipur-to-get-ai-powered-traffic-signals-fixed-timers-set-to-be-replaced-after-successful-trial/>
- Jaipur 2025 crashes/deaths, 34.7 per 100, severity framing —
  <https://www.newkerala.com/news/a/crash-severity-not-frequency-emerging-as-rajasthans-biggest-850.htm>
- Rajasthan road accident analysis (Transport Dept) —
  <https://transport.rajasthan.gov.in/content/dam/transport/transport-dept/pdf/roadsafty1/Final_Road%20Accidents%20in%20Rajasthan.pdf>
- Rajasthan challan volume, recovery rate, violation mix —
  <https://www.missionkiawaaz.com/rajasthan-police-cracks-down-on-traffic-violators>
- Helmet non-compliance share of fatalities —
  <https://www.drishtiias.com/daily-updates/daily-news-editorials/transforming-indias-road-safety-landscape>
- Two-wheeler rider deaths, national —
  <https://www.newslaundry.com/2025/11/10/more-two-wheelers-gig-workers-under-pressure-in-india-9-bike-riders-die-every-hour>
- Smart Cities ICCC coverage —
  <https://iccc.smartcities.gov.in/icc/city-details/c210316aa28429797908af0d5b50cad7>
- Road transport & safety allocation FY 2026-27 —
  <https://prsindia.org/budgets/parliament/demand-for-grants-2026-27-analysis-road-transport-and-highways>
- GeM procurement portal — <https://gem.gov.in/>
- Noida ITMS comparable —
  <https://www.pressreader.com/india/hindustan-times-st-noida/20210212/281724092248118>
