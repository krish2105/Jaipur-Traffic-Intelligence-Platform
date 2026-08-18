# 11 — Command Centre: build plan

Decided 2026-08-18 after reviewing a reference Traffic Operations Centre portal.

## Why this pivots the interface

[FHWA/NOCoE](https://transportationops.org/webinar/transportation-management-center-performance-dashboards)
finds TMC dashboards succeed or fail on **time to awareness** and a unified
common operating picture — not on panel count. And 30 of India's 100 ICCCs
already run traffic dashboards with ATCS, ITMS, RLVD and ANPR. **The official
has seen a screen like this before.**

So the bar is: look at least as capable as what they know, while every panel
carries a figure their ICCC cannot produce. The reference shows
"Total Vehicles 145,210" with no idea what those vehicles *are*. That gap is the
product.

The 3D city becomes the map's `[2D ⇄ 3D]` layer (doc 06 §3 specifies exactly
that toggle), not the whole surface. It stays on `main` and is not discarded.

## Shells — both, then choose

Panels are shared components, so the second shell costs a layout rather than a
rebuild. Compared on live data at the 19:00 peak.

- **Operations Console** — left nav, map centre, KPI right rail, alert ticker.
  The shape a traffic department already recognises.
- **Bento Command** — modular grid, any tile expands, reflows from a 4K wall to
  a laptop. Lets the story be reordered per audience: counts forward for JDA,
  enforcement forward for Traffic Police.

## Panels

1. **Counts & PCU** — live totals, delta vs weekly baseline
2. **Composition** — the 61% two-wheeler split; the panel the reference cannot draw
3. **Forecast** — 15/30/60 min with the 80% band, never a bare point estimate
4. **Data quality** — cameras reporting, mean quality, suppressed bins, shown not hidden
5. **Incidents & dispatch timeline** — severity, detection latency, verify action
6. **Severity risk & black spots** — probability a crash is *fatal or serious*, not
   frequency; top-3 SHAP factors and a countermeasure per segment
7. **Signal advisory** — Webster and max-pressure vs current timing, human-approval gate
8. **Per-class movement** — four-wheelers, two-wheelers, autos, e-rickshaws,
   cycles and **pedestrians** tracked and rendered separately. This is GANANA's
   output as movement, and it is the differentiator: no probe product and no
   ICCC dashboard in the country shows it.

## AI surface — both

Inline everywhere: model version, confidence and quality on every figure, with
an expandable "how was this computed". Plus a **model observatory**: live CV
detection overlay with class-coloured boxes, per-model accuracy against its
validation certificate, per-condition breakdown (day/night/rain), drift, SHAP on
every score, model cards. docs/07 §6 requires explanation to be *displayed*, not
merely computed.

## Live data — first, and in this order

| # | Source | Key needed | Why first |
|---|---|---|---|
| 1 | Open-Meteo weather | **none** | No credential, feeds forecast features and the honest quality-degradation story |
| 2 | Live-data readiness panel | none | Answers "how would this work with our data" before it is asked |
| 3 | TomTom probe speeds | **owner to supply** | Makes the "probe measures delay, never volume" argument visible beside our counts |
| 4 | OpenAQ air quality | free key | Enables the idling-emissions figure from docs/01 §2 |
| 5 | Live CCTV + CV counting | none | The strongest answer to "does the counting actually work" — a live stream, not a replayed file |

## Blockers

- **TomTom API key** — owner
- **OpenAQ key** — owner (free)
- **Google Maps key with billing** — owner, for ADR-017's Photorealistic 3D Tiles
- **ADR-019** — orbit target sits at the link centroid, not on the carriageway.
  Must be fixed before junction click-to-fly; the two share the same machinery.

## Sequence

1. Panel components + live weather + readiness panel (no credentials needed)
2. Operations Console shell
3. Bento shell → **owner chooses**
4. TomTom, OpenAQ once keys arrive
5. Model observatory
6. Per-class movement + pedestrians
7. Live CCTV counting
