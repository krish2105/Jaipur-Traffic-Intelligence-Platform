# 01 — Problem Statement & Evidence Base

Everything here is sourced. Where a number comes from an aggregator rather than a primary government release, it is flagged. Verify flagged items before putting them on a slide in front of the official — he will know the real numbers.

---

## 1. What the official actually said, decoded

Your raw notes:

> "I want to create an infra — like location issue, congestion issue, traffic issue. There is no counting mechanism. And Google data not updated. So what to know — I want to know real time data and how many vehicles are there. And kinds of. So need new strategy for government, need policy and strategy. 2. Defaulter."

Decoded into five distinct asks:

| # | His words | What he is actually asking for | Confidence |
|---|---|---|---|
| 1 | "no counting mechanism" | A continuous, automated vehicle **count** — not a once-every-few-years manual traffic census | High |
| 2 | "how many vehicles… and kinds of" | **Classification** by vehicle type, and almost certainly PCU-normalised volumes, since that is what road capacity maths needs | High |
| 3 | "Google data not updated" | Probe/floating-car data gives him **speed and delay but never volume**, and its road network and closures lag reality | Medium-High — see §4 |
| 4 | "need new strategy… policy and strategy" | Evidence he can defend in a file: before/after, scenario comparison, cabinet-note-grade output | Medium |
| 5 | "Defaulter" | Repeat traffic offenders and unpaid e-challans. Rajasthan's biggest enforcement sore point right now | High |

**The load-bearing insight:** items 1–3 are one problem stated three ways. He has *situational* data (something is jammed) and no *quantitative* data (how much, of what, changing how). You cannot write a lane policy, a freight time-window, a parking tariff, a bus route, or a signal plan from "it's red on Google Maps."

---

## 2. Jaipur, in numbers

### Demand and supply

| Metric | Value | Source |
|---|---|---|
| Jaipur city population | ~50 lakh | RSPCB + CRRI report, via ETV Bharat, May 2026 |
| Vehicles plying on city roads | ~35 lakh | Same |
| Vehicles on main roads daily | >15 lakh | Same |
| Reported vehicle density | 25,048 per km | Same — **flagged, verify methodology**; the figure implies a very small denominator |
| Peak windows | 09:00–11:00, 18:00–20:00 | Same |
| Annual vehicle growth, Jaipur | ~8.4% | IJARCMSS (Sharma & Sharma), 2020 — older, treat as directional |
| Metro Phase 1 | 11.97 km, 11 stations, ~55,068 daily riders (Jul 2024) | Jaipur Metro / JMRC |
| Buses per lakh population | ~30 | IJARCMSS, 2020 |

Read those last two together. A metro carrying ~55k a day and ~30 buses per lakh people against 35 lakh vehicles is the whole story: there is no mode-shift valve, so every additional trip lands on the road network.

### Congestion — TomTom Traffic Index, Jaipur, calendar 2025

These are the strongest numbers in the pack. They are from a commercial index, credible, and independent of any Rajasthan department, which makes them safe to quote at him.

| Metric | 2025 | vs 2024 |
|---|---|---|
| Average congestion level | 58.7% | Roughly flat |
| Time to travel 10 km (all day) | 29 min 16 s | +42 s |
| Average rush-hour speed | 17.5 km/h | −1 km/h |
| Evening rush: 10 km | 36 min 9 s | — |
| Evening rush congestion | 94.9% | — |
| Evening rush speed | 16.6 km/h | — |
| Morning rush congestion | 73.9% | — |
| **Hours lost per driver, rush hour** | **121 hours (5 days 1 hour)** | **+8 h 56 min** |
| Distance covered in 15 min | 5.1 km | −0.1 km |
| Worst day of 2025 | Fri 17 October, 90% | — |

**The line for the pitch:** every Jaipur driver lost five full days to traffic in 2025, and lost nearly nine more hours than in 2024. It is getting worse while the flyovers are being built.

### Safety — the number that gets budget approved

| Year | Accidents (Jaipur) | Deaths |
|---|---|---|
| 2021 | 3,205 | 1,106 |
| 2022 | 3,935 | 1,327 |
| 2023 | 3,893 | — |
| 2024 | 3,881 | — |
| 2025 | **3,664** | **1,273** |

Source: Jaipur Police data, reported July 2026 (Prokerala / NewKerala).

- Accidents **fell 5.6%** in 2025 but deaths **rose 3.1%**.
- Fatality rate hit **34.7 deaths per 100 accidents** — a five-year high.
- Jaipur Rural alone: 805 accidents, 426 deaths — roughly one in three fatalities in the region.
- Rajasthan 2023: 24,705 accidents, 11,762 fatalities. Over-speeding implicated in ~83% of deaths; vulnerable road users were 61% of fatalities (peer-reviewed analysis, IJCEC).
- Harmada, Jaipur district, 3 Nov 2025: a dumper struck 17 vehicles, killing 13.

**The framing that lands:** crashes are down and deaths are up. That is not a policing failure, it is a *severity* problem — speed and vehicle-mix, on specific corridors, at specific hours. And severity is exactly what you cannot see without classified counts and speed distributions. This is the strongest argument for GANANA that exists.

### Enforcement and defaulters

| Metric | Value | Source |
|---|---|---|
| Pending challan defaulters, Jaipur, Jan 2025 – early 2026 | ~8 lakh | ParkPlus (aggregator) — **flagged, verify with Traffic Police** |
| Planned response | Door-to-door recovery drives | Same |
| Nov 2025 focused drive | 20,000+ challans in 10 days | ParivahanSewak (aggregator) — **flagged** |
| Rajasthan e-challan recovery rate, Mar 2026 | ~76%, reported highest among states | Same — **flagged** |
| Consequences of non-payment | RC renewal blocked, checkpoint detention, court summons, Lok Adalat settlement route | Multiple |

If the 76% recovery figure is real, then the state's problem is not gross recovery — it is the **long tail**: the hardened repeat offenders inside the remaining 24%, who are also disproportionately the people causing the severity problem above. That reframes the defaulter module from "collect more fines" (unpopular, looks revenue-driven) to "find the 3% of vehicles causing a disproportionate share of risk" (defensible, safety-driven). Pitch it the second way. Always.

### Economic cost

- BCG estimated ~$22 bn per year in congestion cost across Delhi, Mumbai, Bengaluru and Kolkata alone — fuel, lost man-hours, pollution, crash health costs.
- CSE analysis: commute delay costs a worker the equivalent of roughly 12% of monthly take-home pay; idling vehicles emit 3–7× what free-flowing vehicles emit.
- No Jaipur-specific published figure exists. **This is an opportunity, not a gap** — PRAVAAH can compute it, and "we will give you Jaipur's own congestion cost number, monthly" is a genuinely new thing to offer.

---

## 3. What Rajasthan already has (do not re-sell this)

| Asset | Detail | Source |
|---|---|---|
| Abhay Command Centres | 7 divisional + 26 district HQs; ~6,484 live + 860 offline cameras | NeGD / DoIT&C |
| Dial-100 / CAD | All 33 districts | Same |
| ITMS | Jaipur, Jodhpur, Kota — 30 locations; RLVD + speed violation detection | Same |
| ATCS (JDA) | MI Road since 2007; JLN Road, Ashok Marg, Tonk Road corridors | JDA |
| Jaipur ICCC (Smart Cities) | Walled-city/ABD CCTV, environmental sensors, smart parking, smart lighting; **already runs some vehicle-counting analytics** | Smart Cities Mission ICCC portal |
| ANPR e-challan | Live across Jaipur, Jodhpur, Udaipur, Kota, Ajmer, Bikaner | Multiple |
| RSDC / RajCloud | Data centres at Jaipur (P1/P3/P4) + DR at Jodhpur; ISO 20000 certified; NIC MeghRaj mini-cloud in state | DoIT&C, NIC |
| DoIT&C data centre AI upgrade | RFP floated 2026 | RISL tender portal |

### The April 2026 reform plan — your alignment document

The state announced a Jaipur traffic overhaul. Read this list carefully, because PRAVAAH should map onto it line by line:

- 4 additional ADCPs and 8 ACPs dedicated to traffic
- **Tonk Road, Yaadgaar → Sanganer, as the city's first "Model Traffic Corridor"**
- **Signal timings to be made dynamic based on actual traffic pressure**
- More CCTV linked to Abhay Command Centre
- **Drones to track flow and assess jams**
- ITMS rolled out in phases
- Median-opening closure, U-turn redesign, scientific junction reorganisation
- Parking/no-parking demarcation, crane deployment for illegal parking
- **Performance-based evaluation of officers, with regular review and field-feedback adjustment**

Three of those bullets are unbuildable without measurement. "Dynamic signal timing based on actual traffic pressure" needs a real-time count. "Performance-based officer evaluation" needs a metric. "Regular review and adjustment" needs before/after data. **PRAVAAH is the instrument that makes their own announced plan executable.** Say exactly that.

Pipeline projects to reference so you sound current: 36 km six-lane elevated road along the Dravyavati corridor (~₹6,000 cr, DPR from July 2026, linking Sikar/Ajmer/Tonk Roads); Gopalpura elevated road (₹218 cr); Metro Phase 2 (RUHS Pratap Nagar → Vaishali Nagar via Jagatpura, Tonk Road, Mansarovar); BRTS corridors on Sikar and Ajmer Roads being removed as ineffective; Jaipur–Kishangarh six-laning approved Feb 2026 (₹910 cr).

Every one of those needs before/after traffic evidence that nobody is currently collecting. That is a second, quieter sales argument: **₹6,000 crore of elevated road is about to be built with no baseline measurement to prove it worked.**

---

## 4. Why "Google data not updated" is a real technical complaint

Be precise here, because the official will have been told "just use Google" by someone. Four separate limitations, and it is worth knowing which one he meant:

1. **Probe data measures speed, never volume.** Google, TomTom and HERE infer congestion from the movement of sampled devices. They can tell you a road is slow. They cannot tell you 4,200 vehicles per hour passed, of which 61% were two-wheelers and 4% were LCVs. Capacity analysis, PCU calculations, signal cycle design, freight windows and permit policy all need volume and composition. **This is almost certainly what he meant, and it is unfixable by any commercial map product.**
2. **Sampling bias.** Probe data over-represents smartphone users in cars with navigation running. In a city where two-wheelers dominate the fleet, that bias is severe and systematically wrong in the direction that matters.
3. **Network and closure lag.** New JDA roads, changed medians, one-way reversals, closed U-turns and construction diversions take weeks to months to reflect. Jaipur is currently a permanent construction site, so this bites hard.
4. **No ownership, no audit trail, no legal standing.** A commercial black box cannot be cited in a policy file, audited by AG, questioned in the Assembly, or used as evidence. Government needs data it owns and can defend. This is an underrated argument — lead with it if he is a policy person rather than a technical one.

**The counter-position PRAVAAH takes:** don't replace probe data, *fuse* it. Probe data gives you network-wide coverage cheaply. Camera counts give you ground truth at instrumented points. Together they let you extrapolate calibrated volume estimates to uninstrumented links — which is more than either source can do alone, and is a genuinely defensible technical contribution.

---

## 5. The gap, stated as a problem statement

> Jaipur operates 35 lakh vehicles across a road network it cannot measure. The state owns thousands of cameras, a command centre, an ANPR e-challan system and a Smart City ICCC — but no continuous, classified, corridor-level count of what is actually moving. Decisions about ₹6,000 crore of new road capacity, signal timing, freight windows, parking, enforcement deployment and officer performance are therefore made on anecdote, complaint volume, and commercial probe data that measures delay while being structurally incapable of measuring volume or composition.
>
> The consequence is visible in the safety numbers: crashes fell 5.6% in 2025 while deaths rose 3.1%, pushing the fatality rate to a five-year high. Severity is concentrating on specific corridors, at specific hours, in specific vehicle-mix conditions — and none of those three variables is currently instrumented.
>
> **PRAVAAH is a decision-intelligence layer that converts feeds the state already owns into classified counts, congestion forecasts, defaulter risk intelligence, and bilingual policy evidence — without procuring a single new camera to prove its value.**

---

## 6. Stakeholder map

Who has to say yes, and what each one actually cares about:

| Body | Cares about | PRAVAAH hook |
|---|---|---|
| **Jaipur Traffic Police** (DCP/ADCP Traffic) | Deployment efficiency, defaulter recovery, being blamed for jams | Live counts, hotspot forecasts, targeted enforcement, officer performance metrics |
| **Rajasthan Police / Abhay** | Camera ROI, incident response time | Analytics layer over existing feeds; no rip-and-replace |
| **JDA** | Junction design, elevated road justification | Before/after evidence, turning-movement counts, scenario simulation |
| **Jaipur Smart City Ltd** | ICCC utilisation, Smart Cities Mission KPIs | Plugs into ICCC; makes existing investment look successful |
| **Transport Dept / RTO** | Registrations, permits, fitness, tax | VAHAN fusion, commercial-vehicle compliance, defaulter linkage |
| **DoIT&C / RISL** | Security, hosting, procurement compliance, DPDP | On-prem RSDC deployment, open standards, no vendor lock-in |
| **UDH Dept / CM Office** | Visible outcomes, headline numbers | The dashboard, the monthly congestion-cost figure, the model corridor result |
| **Nagar Nigam (Heritage/Greater)** | Parking, encroachment, footpaths | Parking occupancy analytics, encroachment detection |
| **Citizens** | Not being fined arbitrarily; jams | Transparent grievance channel, public congestion view, privacy guarantees |

**Ask which of these he sits in before you finalise the pitch.** A DCP Traffic and a DoIT&C Joint Secretary need almost opposite decks. See doc 10.

---

## 7. Source list

- ETV Bharat, May 2026 — Jaipur vehicle/population figures, RSPCB + CRRI report
- TomTom Traffic Index 2025, Jaipur city page — congestion metrics
- Prokerala / NewKerala, July 2026 — Jaipur accident and fatality series
- Down To Earth, Nov 2025 — national road-safety data, Harmada crash
- IJCEC (civilengineeringjournals.com) — Rajasthan accident analysis 2015–2023
- NeGD / DoIT&C state directory — Abhay Command Centre camera counts, ITMS coverage
- Smart Cities Mission ICCC portal — Jaipur ICCC capabilities
- JDA ATCS documentation — ATCS corridor history
- Pink City Post, April 2026 — Jaipur traffic reform plan, Model Traffic Corridor
- Patrika (Feb 2025), Construction World, The DeepState (Jun 2026) — infrastructure pipeline
- ParkPlus, ParivahanSewak, ChallanSetu — e-challan and defaulter figures (**aggregators — verify**)
- MeitY / EY / Vision IAS — DPDP Act 2023 and DPDP Rules 2025
- Quartz India (BCG estimate), ETV Bharat (CSE report) — congestion economics
- IJARCMSS, Inspira Journals — Jaipur traffic academic studies (2020, older)

**Before the pitch, file an RTI or make a direct ask for:** Jaipur RTO cumulative registrations by class (or pull it yourself from the VAHAN public dashboard at `analytics.parivahan.gov.in`), Traffic Police e-challan issuance and recovery by year, and the current Abhay/ICCC camera inventory with locations. Walking in with their own numbers, correctly, is worth more than any slide.
