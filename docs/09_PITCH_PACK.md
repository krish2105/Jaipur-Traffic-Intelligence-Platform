# 09 — Pitch Pack

---

## 1. The strategic position

You are one student pitching against system integrators who have sold this government cameras before and will sell them more. You do not win on scale, references, or price. You win on three things:

**One — you understood the actual problem.** He said "no counting mechanism" and "Google data not updated" in the same breath. Most vendors will hear "he wants cameras." You heard "he wants volume and composition data, which probe data structurally cannot provide." Lead with that comprehension and you have already outperformed the room.

**Two — you are not selling hardware.** Every integrator's proposal starts with a bill of materials. Yours starts with "you already own 6,484 cameras; we make them count." That is a different conversation, at a different price point, with a different risk profile, and it makes their proposals look self-serving by comparison.

**Three — you did the compliance work.** Bring a DPIA summary. Nobody expects it from a student, most vendors skip it, and it is the objection most likely to stall the project six months in.

**What you are asking for is not a contract.** It is a pilot on one corridor with access to a few camera feeds. Small, low-risk, cheap to say yes to. Ask for the smallest yes that unlocks the next conversation.

---

## 2. Narrative arc (15 minutes)

### Open — the number that reframes everything (90 seconds)

> "In 2025, Jaipur recorded 3,664 road accidents — 5.6% fewer than the year before. In the same year, 1,273 people died — 3.1% more. The fatality rate hit 34.7 deaths per 100 crashes, the highest in five years.
>
> Crashes are going down. Deaths are going up. That is not an enforcement problem. It is a severity problem — specific corridors, specific hours, specific vehicle mixes. And right now, sir, none of those three variables is being measured anywhere in Jaipur."

That is his own department's data, it is unarguable, and it moves the conversation from congestion (annoying) to fatalities (urgent, budgeted, politically live).

### The gap (3 minutes)

Three facts, in order:

1. **Jaipur is measured for delay, not for volume.** TomTom shows 58.7% average congestion, 121 hours lost per driver in 2025, rush-hour speeds at 17.5 km/h. Real numbers. But every one of them describes *how slow*, never *how many* or *of what kind*.
2. **That distinction is not academic.** Signal cycle design, lane allocation, freight time-windows, permit policy, parking tariffs, bus route planning, and capacity analysis all require volume and composition. None can be computed from speed data. This is a structural limitation of probe data, not a gap Google will fix.
3. **The state already owns the sensors.** ~6,484 cameras on Abhay, ITMS at 30 locations, ANPR e-challan live, a Smart City ICCC in the walled city. The instrument exists. Nobody built the layer that reads it.

### The alignment slide — the one that closes (2 minutes)

Put their own April 2026 plan on screen. Then map it:

| Your announced plan | What it needs | Status |
|---|---|---|
| Dynamic signal timing based on actual traffic pressure | Real-time count per approach | **Not measured** |
| Performance-based evaluation of traffic officers | A corridor-level metric | **Not measured** |
| Regular review and field-feedback adjustment | Before/after evidence | **Not measured** |
| Tonk Road Model Traffic Corridor | A baseline to model against | **Not measured** |
| Drones to assess jams | Automated analysis of the footage | **Manual** |

> "Sir, the plan is right. Three of its commitments can't be executed without continuous measurement. PRAVAAH is the instrument that makes your own plan executable."

You are not proposing a new initiative. You are removing the blocker from theirs. That is a much easier yes.

### The demo (6 minutes) — see §3

### The ask (2 minutes)

> "One corridor. Tonk Road, Yaadgaar to Sanganer — the one you've already designated as the model corridor. Six existing camera feeds. Ninety days. At the end you'll have the first continuous, classified traffic count in Jaipur's history, and a measured baseline for every intervention you make on that corridor afterwards.
>
> No hardware procurement. No data leaves the state network. Deployable on RSDC."

---

## 3. Demo script — six minutes, rehearsed

Run it offline. Run it twice before the day. Have a recorded video of the whole thing on the laptop as a fallback.

**0:00 — Counting (90s).** Play a Tonk Road clip. Boxes appear, classified, colour-coded by type. Counters climb per direction. PCU total rises. Then point at the accuracy badge: *"This camera is validated at 94% against a manual count. We show that on screen, always. A system that claims perfection is lying to you."* — Honesty here is a feature. It is what a traffic engineer needs to hear.

**1:30 — The composition reveal (45s).** Switch to the class-mix panel. *"61% two-wheelers. Google cannot tell you this. No probe data can. And every capacity calculation you make depends on it."* This is the moment the gap becomes concrete.

**2:15 — The gnomon arc (45s).** *"This is the corridor's day. Morning peak here, evening peak here — bigger. We designed this after the Samrat Yantra at Jantar Mantar, because Jaipur has been measuring things precisely for three hundred years."* Small moment, lands well, they remember it.

**3:00 — Forecast (45s).** Next 60 minutes with confidence bands. *"Not a prediction we hide behind. Here is the uncertainty."*

**3:45 — Scenario (75s).** Run one intervention — close a median or shift the signal split. Show delta with confidence bounds and the calibration error. *"The simulation is calibrated to within 8% of measured volumes. Below that standard we would not show you a number."*

**5:00 — NEETI in Hindi (45s).** Ask aloud: *"टोंक रोड पर सुबह के व्यस्त समय में कितने वाहन गुजरते हैं?"* Answer appears in Hindi with citations to the underlying rows. *"Every number is traceable to data. It cannot invent a figure — we block rendering if it tries."*

**5:45 — Close (15s).** Toggle to light mode, switch to English, resize to phone width. *"Same system, control room or field."*

**Cut from the demo if time is short:** the 3D twin and the defaulter console. Both are impressive and neither carries the argument. Counting, composition, and NEETI-in-Hindi are the three that do.

---

## 4. Handling the defaulter question

He raised it, so he will ask. Answer carefully — this is the part most likely to go wrong.

> "Rajasthan already recovers a reported ~76% of e-challans — among the best in the country. So the problem isn't gross recovery. It's the tail: roughly 8 lakh pending cases in Jaipur, and inside them a small number of vehicles committing repeated serious violations. Those are the same vehicles driving your severity numbers.
>
> So we don't build a collection tool. We build a targeting tool: which vehicles represent real road-safety risk, where they operate, and when. Every score is explainable, every lookup is audited, identities are masked by default, and fairness is monitored and displayed. The system recommends; your officer decides."

If he pushes toward revenue framing, hold the line politely: *"We can report recovery as a secondary metric. But if this is positioned as a revenue tool, it will attract the wrong kind of attention. Positioned as a safety tool, it survives scrutiny — and it produces the same recoveries."*

---

## 5. KPIs to commit to

Pick few. Commit hard. Report honestly.

**Pilot (90 days, one corridor)**
| KPI | Target |
|---|---|
| Continuous count coverage | ≥95% of hours instrumented |
| Counting accuracy (day) | ≥92% vs manual, published per camera |
| Classification macro-F1 | ≥0.90 |
| Forecast MAE @30min | Beats persistence baseline |
| Incident detection latency | ≤2 min, ≤2 false alarms/day |
| Bilingual coverage | 100% of screens |
| First-ever corridor baseline | Delivered |

**Outcome (12 months, if scaled)** — frame as targets requiring joint action, not guarantees:
| KPI | Target |
|---|---|
| Corridor peak delay | −10 to −15% |
| Severity-weighted crash risk on instrumented corridors | −10% |
| Enforcement contacts per officer-hour | +25% |
| Repeat-offender recontact rate | +40% |
| Data-backed policy decisions per quarter | ≥4 |

**Never promise a fatality reduction number.** You cannot control the variable and you should not be on record having claimed it.

---

## 6. Cost framing

Do not lead with cost. If asked:

**Pilot:** one corridor, existing feeds, 6 cameras. Compute at RSDC or one edge box. This is a software and effort cost, not a capital project. Position it as a fraction of one junction improvement — the Riddhi-Sidhi intersection alone is a ₹185 crore line item, and the Dravyavati elevated corridor is a ₹6,000 crore commitment being made with no measurement baseline.

**The ROI argument that actually works:**
> "Sir, ₹6,000 crore of elevated road is about to be built along the Dravyavati corridor. Two hundred and eighteen crore at Gopalpura. When it opens, how will you demonstrate it worked? Right now there is no baseline to measure against. PRAVAAH costs a rounding error against those projects and is the only way to prove they delivered."

That reframes it from "another IT expense" to "protecting a ₹6,000 crore investment." Very different budget conversation.

**Scale economics:** software scales across corridors at near-zero marginal cost. Each new corridor costs an edge node and calibration. Say so — it makes the pilot look like a decision about the whole city.

---

## 7. Objections, prepared

| Objection | Response |
|---|---|
| "We already have ITMS / ICCC" | "You do, and PRAVAAH runs on top of it. ITMS detects violations and controls signals. It does not produce a continuous classified count, turning-movement matrices, or forecasts. We add the analytics layer — and we make your existing investment demonstrably more valuable." |
| "Google gives us this free" | "Google gives you delay, and only delay. Ask it how many two-wheelers crossed Gopalpura between 9 and 10 this morning. It cannot answer, and neither can any probe-data product — it's a structural limit of the method. Also: you can't cite a black box in a policy file or defend it in the Assembly." |
| "What about privacy?" | "We count vehicles. The counting engine processes no personal data at all. Video never leaves the pole. Only the enforcement module touches plates, and it's encrypted, masked, audited and reason-coded. We built to full DPDP compliance without relying on the government exemption — here's the DPIA summary." |
| "You're one person" | "Yes. Which is why I'm asking for one corridor, not a city contract. If it works, the architecture is documented well enough to hand to a systems team or scale with a partner. If it doesn't, you've lost 90 days on six camera feeds." |
| "Can it run on our infrastructure?" | "Entirely on RSDC. Kubernetes manifests are written. No foreign cloud, no data leaving the state network. On-prem LLM option for the policy assistant." |
| "How accurate really?" | "94% daylight, 87% night on our validation corridor, published per camera, shown on screen. Two-wheelers are the hard case and we report them separately. I'd rather show you a validated 94% than claim 99%." |
| "What if the AI is wrong?" | "Every output is advisory. No challan issues without human confirmation. No signal changes without an engineer. The models recommend; your people decide. That's a design choice, not a limitation." |
| "Timeline?" | "Working demo today. Ninety-day pilot to a validated corridor baseline. Six months to a scalable multi-corridor deployment." |

---

## 8. Leave-behind pack

- 2-page executive summary, Hindi and English — *he will forward the Hindi one*
- 12-slide deck
- 2-page DPIA summary
- 1-page architecture diagram
- Live demo URL plus a 3-minute recorded walkthrough
- Sample junction report generated by NEETI, in Hindi

**Send within 24 hours.** Government momentum dies in the gap between meeting and follow-up.

---

## 9. Meeting mechanics

**Before:** confirm attendees and their departments (the deck changes — see doc 10); confirm you can plug in a laptop; bring your own HDMI adapter and a phone hotspot; arrive with the demo already running.

**During:** open with their data, not your architecture. Let him talk — the second meeting's requirements come from what he volunteers unprompted. Do not oversell; a student who says "I don't know, I'd have to check" gains credibility. Write down every number he quotes.

**Close with a specific ask:** *"Can I get read access to six Tonk Road camera feeds for 90 days?"* A vague "let me know what you think" ends in nothing. A specific, small, concrete ask gets either a yes or a named blocker — both are progress.

**After:** follow-up within 24 hours; a one-page note of what you heard him say his priorities were (this is disproportionately effective — it proves you listened); a named next step with a date.
