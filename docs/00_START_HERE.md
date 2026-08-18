# PRAVAAH — Start Here

**Project:** PRAVAAH (प्रवाह) — Jaipur Traffic Decision Intelligence Platform
**Owner:** Krishna Mathur
**Purpose:** Pitch-ready platform for a senior Government of Rajasthan official, Jaipur
**Pack version:** v1.0 — 18 August 2026

---

## Read this first: the one thing that changes your pitch

Your instinct from the call was "they need cameras and counting." Research says something sharper.

**Rajasthan already has the hardware.** Abhay Command Centres run ~6,484 live cameras across the state, with ITMS at 30 locations in Jaipur/Jodhpur/Kota, red-light and speed violation detection, Dial-100/CAD in all 33 districts, and a Jaipur Smart City ICCC that already does *some* vehicle-counting analytics in the walled city. In April 2026 the state announced a Jaipur traffic reform plan that explicitly asks for dynamic signal timing based on actual traffic pressure, more CCTV into Abhay, drones for jam assessment, and a Tonk Road "Model Traffic Corridor."

So if you walk in and pitch cameras, you lose. Somebody already sold them cameras.

**What they do not have is a decision layer.** Nobody can answer, for any given junction on any given Tuesday: how many vehicles, of what type, moving in which direction, versus last month, versus the policy target. Google and TomTom sell *speed and delay*, never *volume and composition* — which is exactly why the official told you "Google data not updated" and "there is no counting mechanism" in the same breath. He is right, and he is describing a category gap, not a vendor gap.

**PRAVAAH is that layer.** It turns feeds the state already owns into counts, classifications, forecasts, defaulter intelligence, and bilingual policy briefs. It is software on top of paid-for hardware. That framing is your entire competitive advantage as a solo builder pitching against system integrators.

Full reasoning and evidence: `01_PROBLEM_AND_EVIDENCE.md`.

---

## Files in this pack

| # | File | What it is | When to use it |
|---|---|---|---|
| 00 | `00_START_HERE.md` | This file | Now |
| 01 | `01_PROBLEM_AND_EVIDENCE.md` | Decoded brief, real Jaipur data with sources, gap analysis, stakeholder map | Read before anything. Feeds the pitch. |
| 02 | `02_MASTER_PROMPT.md` | **The master prompt for Claude Code** | Paste into Claude Code as the project brief |
| 03 | `03_ARCHITECTURE_AND_PIPELINE.md` | End-to-end architecture, four modules, data flow, deployment topology | Attach for any backend/infra work |
| 04 | `04_AI_MODELS_SPEC.md` | CV / DL / NLP / RL model specs, datasets, training, evaluation | Attach for any ML work |
| 05 | `05_DATA_CONTRACTS_AND_APIS.md` | DB schema, event schemas, REST/WS contracts | Attach for backend + frontend integration |
| 06 | `06_DESIGN_SYSTEM_AND_FRONTEND.md` | Design direction, tokens, type, 3D, motion, bilingual, 21st.dev usage | Attach for all frontend work |
| 07 | `07_SECURITY_PRIVACY_COMPLIANCE.md` | DPDP Act compliance, threat model, security controls | Attach for auth/data/enforcement work |
| 08 | `08_BUILD_PLAN_AND_CLAUDE_MD.md` | Sprint plan, `CLAUDE.md` contents, slash commands, repo layout | Use to bootstrap the repo |
| 09 | `09_PITCH_PACK.md` | Pitch narrative, demo script, KPIs, ROI, procurement path | Use in the weeks before the meeting |
| 10 | `10_AUDIT_AND_OPEN_QUESTIONS.md` | Confidence scorecard + the questions you must get answered | Read today, answer before Sprint 1 |

---

## How to use this with Claude Code

**Bootstrap (once):**

```bash
mkdir pravaah && cd pravaah && git init
mkdir -p docs
# copy this whole pack into docs/
claude
```

Then, in Claude Code:

```
Read docs/02_MASTER_PROMPT.md, docs/03_ARCHITECTURE_AND_PIPELINE.md and
docs/08_BUILD_PLAN_AND_CLAUDE_MD.md. Create CLAUDE.md at the repo root exactly
as specified in doc 08, then scaffold the monorepo structure. Do not write
feature code yet — structure and config only. Stop and show me the tree.
```

**Per sprint:** attach only the docs that sprint needs. Attaching all eleven every time wastes context and makes Claude Code vaguer, not smarter. Doc 08 tells you which docs map to which sprint.

**Rule to enforce in `CLAUDE.md`:** these documents are the specification. If Claude Code wants to deviate, it must say so and get your sign-off first. Silent deviation is how spec'd projects rot.

---

## Two things to do before you write a line of code

1. **Answer the questions in `10_AUDIT_AND_OPEN_QUESTIONS.md`.** Several of them (especially *which department is he actually from*) change the architecture, not just the pitch.
2. **Decide the demo's data story.** Real feeds, public feeds, or simulation? This is the single biggest fork in the build. Doc 10 lays out all three paths and what each costs you.

---

## Naming note

**PRAVAAH (प्रवाह)** — "flow." Backronym: **P**redictive **R**eal-time **A**nalytics for **V**ehicular **A**ssessment **A**nd **H**ighways.

Reads well in both languages, government-appropriate, no baggage in the traffic domain. One conflict to know about: the RBI runs an unrelated regulatory portal called PRAVAAH. Different domain, different ministry, almost certainly fine — but if the official flinches, alternates that survive the same test:

- **DHARA (धारा)** — current, flow
- **GATI-JPR (गति)** — motion; clean, but PM GatiShakti is a national scheme, so expect "is this part of GatiShakti?" every time
- **NIRIKSHAN (निरीक्षण)** — observation, inspection; leans surveillance, which cuts both ways
- **SAMVAHAN (संवहन)** — conveyance, circulation; distinctive, slightly formal

Module names used throughout the pack: **GANANA** (counting), **DRISHTI** (network intelligence), **KAVACH-E** (enforcement), **NEETI** (policy copilot), **SETU** (interface layer).
