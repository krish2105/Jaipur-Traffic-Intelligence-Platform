# PRAVAAH — Commercial Pack

**For:** Jaipur Police Commissionerate · Jaipur Development Authority · Smart City SPV
**Date:** 19 August 2026 · **Route:** GeM (Government e-Marketplace)

---

## 1. What is being bought

A decision-intelligence layer for Jaipur's traffic, sold per corridor per year.
It measures **what the traffic is made of** — twelve vehicle classes, converted
to PCU — and turns that into three things nothing currently in the city does:

1. **Where enforcement should go**, given that severity is rising while crashes fall.
2. **What a signal plan costs whom**, in PCU rather than vehicle counts.
3. **An answer to "how would this work with our data?"** that cites its sources.

It does **not** actuate signals. Every plan is advisory and a named officer
approves it, recorded in an immutable audit trail. That is a deliberate design
position, not a gap — see §6.

---

## 2. The finding this rests on

Jaipur, 2025, from the department's own published figures:

| | 2024 | 2025 | change |
|---|---|---|---|
| Crashes | 3,881 | 3,664 | **−5.6%** |
| Deaths | 1,235* | **1,273** | **+3.1%** |
| Deaths per 100 crashes | 31.8* | **34.7** | five-year high |

<sub>*derived from the published percentage change</sub>

Enforcement in the same period: **87.86% over-speeding, 6.67% helmet, 4.73%
parking.** Speeding enforcement acts on crash *frequency* — the number already
improving. Severity is what is worsening, and nationally helmet non-compliance
drives 30% of road deaths, with 73% of two-wheeler fatalities unhelmeted.

**Jaipur is spending 88% of its enforcement effort on the metric that is already
going the right way.**

---

## 3. Pricing

Per corridor, per year. Priced so a Commissionerate can buy it from an existing
budget line without a fresh tender.

| SKU | Scope | Annual (₹) |
|---|---|---|
| **Corridor** | 1 corridor, up to 40 links | 18–24 lakh |
| **Zone** | 1 police zone | 90 lakh – 1.2 cr |
| **City** | Jaipur, 423 junctions | 3.2–4.5 cr |
| Severity module | add-on, any tier | 12 lakh |

Indicative and to be validated against a live GeM listing. No hardware in these
figures: PRAVAAH runs on the cameras the ITMS rollout is already installing.

---

## 4. The value case

Two numbers, kept separate because they are bought differently.

**Free to act on — reallocating existing enforcement.** The allocator moves the
challan mix from 88/6.7/4.8 to 73.7/23.3/3.0 and estimates **+18.5 lives a
year**. This costs nothing: it is the same officers issuing the same number of
challans against a different mix. It holds for saturation K ≥ 2 and the model
publishes that boundary.

**Requires a programme — achieving compliance.** The severity model puts helmet
compliance at 90% at 30.7 deaths per 100 crashes against today's 34.7, worth
about **147 lives a year** at Jaipur's crash volume. This is not free; it needs
sustained enforcement and probably a public campaign. It is stated separately
rather than folded into the first number.

**Against the licence.** At the city tier (₹3.2–4.5 cr), the reallocation alone
is 18.5 lives. Using the value of statistical life applied in Indian road-safety
appraisal, that is an order of magnitude above the licence cost before any
congestion benefit is counted.

**Enforcement revenue.** Rajasthan already recovers 76% of issued challans, the
best rate in India, and Jaipur booked ₹32 crore in 2024. A better-targeted mix
compounds against a collection system that already works.

---

## 5. What is real today, and what is not

Stated plainly, because a buyer will find out either way.

**Real, cite-able, in the product now**
- Jaipur 2025 crash and fatality figures, with sources on screen
- Rajasthan enforcement mix, challan volume, recovery rate
- National severity drivers from MoRTH
- OpenStreetMap road network and junction geometry
- Two SUMO experiments, reproducible, five seeds where it matters

**Modelled, with intervals shown**
- Severity by composition — a structured model with published anchors,
  calibrated to the observed 34.7. Not a fitted regression, and it says so.
- The enforcement allocation, with its robustness boundary published

**Synthetic and badged as such**
- Per-link hourly counts, camera detections, the 3D city's traffic

**Not yet built**
- Live camera ingest at a Jaipur junction. Needs a site and a feed.

---

## 6. Why advisory-only is a feature

Signal output is advisory; a named human approves each plan; every accepted and
rejected plan is written to an immutable audit trail.

An ITMS that a model failure cannot make unsafe is the one a Commissioner can
defend after an incident. The question after any serious collision at a
signalised junction is "who set that timing, and on what basis" — and this
system answers it with a name, a timestamp and the evidence that was on screen.

It also matches what the PCU work actually found (docs/12 §2.1–2.2): PCU timing
**redistributes** delay rather than removing it, trading about 7 seconds off
every bus and truck for about 1 second more on the average vehicle. That is a
policy choice about freight and public transport priority. It belongs to a
Commissioner, not to a units convention inside a vendor's firmware.

---

## 7. Procurement facts

- **Route:** GeM listing, per-corridor annual licence.
- **Hosting:** Vercel (frontend), Render or state cloud (API), Tiger Cloud
  (database). All can be moved to a state-hosted environment; nothing depends on
  a foreign-only service.
- **Data residency:** inference at the edge, so raw video never leaves the
  junction. Plates are salted-hashed on the bus and ciphertext at rest.
- **Licensing:** detection model is Apache-2.0. No AGPL anywhere in shippable
  code — checked in CI by `scripts/security_audit.py`, which fails the build.
- **DPDP:** built as though the Act applies in full. DPIA before any real camera
  is connected.
- **Offline:** verified. With the server killed mid-session, the console reloads
  and renders from the service worker.

---

## 8. The ask

**One corridor, paid, 90 days.** Tonk Road is already modelled end to end.

What is needed from the department:
1. A corridor and access to its existing camera feeds.
2. **FIR-level crash records** — date, hour, light, vehicle classes, outcome.
   About 3,000 rows a year turns the severity model from a structured estimate
   into a fitted regression with real standard errors. This is the single
   highest-value input available and it costs the department nothing to supply.
3. Turning-movement counts and current signal timings for the corridor.

What is delivered at 90 days: a measured before-and-after on that corridor,
every figure cite-able, and a reallocation recommendation the Commissionerate
can act on with its existing enforcement capacity.
