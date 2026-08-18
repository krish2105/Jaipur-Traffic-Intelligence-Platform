# Architecture Decision Records

Lightweight ADRs. When the official (or his technical person) asks "why Postgres
and not a proper time-series database?" — and doc 08 §5 says he will — this file
is the dated, reasoned answer instead of an improvised one.

Each record: what the spec pack says, what we build, why, and what it costs us.
**Where this file conflicts with docs/01–10, this file wins.**

---

## ADR-001 — Redis Streams instead of Redpanda
**Date:** 2026-08-18 · **Status:** Accepted · **Supersedes:** doc 03 §2 L2, doc 05 §2

Doc 03 specifies Redpanda for the event bus. We use **Redis Streams** behind an
`EventBus` Protocol in `packages/contracts`.

**Why.** Redpanda on Render is a paid private service. The real workload is
~2,000 events/hour (6 cameras x 4 directions x 12 classes x 12 bins/hour, sparse).
Redis Streams provides consumer groups, replay from offset, and at-least-once
delivery — every property doc 05 §2 actually relies on — at roughly a tenth the
operational surface for a solo builder.

**Cost.** No Kafka-ecosystem tooling (Connect, ksqlDB, Schema Registry). Topic
retention is managed by us via `XTRIM` rather than by broker policy.

**Escape hatch.** The Protocol has one method surface. A `KafkaEventBus`
implementation is a file, not a rewrite. Topic names keep the versioned
`ganana.counts.v1` convention from doc 05 §2 so the migration is mechanical.

---

## ADR-002 — Cloudflare R2 instead of MinIO in the cloud
**Date:** 2026-08-18 · **Status:** Accepted · **Supersedes:** doc 03 §5

Doc 03 specifies MinIO. Cloud deployment uses **Cloudflare R2**; **MinIO is
retained in the offline docker-compose stack**.

**Why.** R2 speaks the S3 API, so `boto3` client code is identical. Free tier
covers evidence clips, model artefacts and PMTiles basemaps with zero egress
cost. Running MinIO as a Render private service to store a few GB is waste.

**Cost.** Cloud object storage is now outside the state network. Mitigated
because R2 holds only P0/P1 artefacts and presigned-URL evidence — never raw
video, which doc 07 §3 forbids centralising anyway. The RSDC production manifest
targets MinIO on-prem.

---

## ADR-003 — APScheduler + Render Cron instead of Prefect 3
**Date:** 2026-08-18 · **Status:** Accepted · **Supersedes:** doc 03 §2 L3

**Why.** Prefect's value is DAG orchestration, retries and observability across a
team. Our scheduled surface is five jobs: continuous-aggregate refresh, retention
enforcement, re-ID salt rotation, drift evaluation, forecast refresh. That is
five cron entries, not an orchestration platform.

**Cost.** No backfill UI, no flow-run history. Retention and salt-rotation jobs
therefore log to `audit_log` so their execution is provable — which doc 07 §3
requires regardless ("a retention policy that requires someone to remember is a
retention policy that fails").

---

## ADR-004 — ONNX Runtime on Apple Silicon instead of Jetson + TensorRT INT8
**Date:** 2026-08-18 · **Status:** Accepted · **Supersedes:** doc 03 §5, doc 04 §2

**Why.** There is no Jetson Orin Nano. Inference runs on the M4 Pro via ONNX
Runtime with the CoreML execution provider. The PyTorch -> ONNX export pipeline is
built and reproducible; it stops one documented step short of TensorRT INT8.

**Cost.** The doc 03 §7 target of ">=15 fps per stream on Jetson Orin Nano" cannot
be measured. We measure and publish fps on the actual hardware instead, and state
the Jetson number as untested rather than claiming it.

**Pitch impact.** The "edge-heavy, cloud-light, video never leaves the pole"
architecture (doc 03 §1) remains the design and remains true of the production
topology. We are honest that the demo runs the edge runtime on a laptop.

---

## ADR-005 — Webster + max-pressure instead of MAPPO for signal advisory
**Date:** 2026-08-18 · **Status:** Accepted · **Supersedes:** doc 04 §7 (M10)

**Why.** Doc 04 §7 already requires MARL to beat max-pressure before it is worth
deploying. Max-pressure is near-optimal in theory, needs no training, and — the
part that matters in a government file — is explainable and citable. Webster's
method is in every traffic-engineering curriculum, which means a JDA engineer can
audit the recommendation instead of taking it on faith.

**Cost.** No RL story in the pitch. Doc 04 §7's own framing makes this a strength:
"we tested X and it didn't beat a simpler method, so we shipped the simpler one"
builds credibility with technical evaluators.

**Unchanged.** The safety line from doc 02 holds absolutely: output is a
*recommended* plan, a human applies it, and no code path exists from model output
to signal actuation.

---

## ADR-006 — TLS 1.3 + signed service tokens instead of mTLS on Render
**Date:** 2026-08-18 · **Status:** Accepted · **Supersedes:** doc 07 §5 Cryptography

**Why.** Render's managed networking does not expose client-certificate
termination, so mTLS between our own services is not configurable there.
Internal calls use TLS 1.3 plus short-TTL signed service tokens.

**Cost.** A DoIT&C evaluator may ask. The answer is prepared: this is a hosting
limitation of the demo platform, not a design decision — `infra/k8s/` carries the
mTLS-enabled manifests for RSDC, where it is achievable.

---

## ADR-007 — Keycloak with federation configured but not connected
**Date:** 2026-08-18 · **Status:** Accepted · **Refines:** doc 07 §5

Keycloak runs on Render with the seven roles from doc 07 §5 and MFA enforced on
P2-touching roles. Identity-provider federation to state SSO is **configured in
the realm but has no upstream IdP**, because none has been provided.

**Why it still matters.** Keeping real Keycloak rather than a homegrown JWT
issuer is what makes "federates to your existing state SSO" an honest claim
rather than a hopeful one. It is a realm configuration change, not a rebuild.

---

## ADR-008 — Gemini/Groq free tier for NEETI, behind an LLMProvider interface
**Date:** 2026-08-18 · **Status:** Accepted, flagged for revisit · **Supersedes:** doc 04 §9 (M15)

Doc 04 §9 specifies Claude for the hosted demo and Llama-3.x-Indic or Sarvam for
an on-prem story. We use **Gemini (primary) and Groq (fallback)** free tiers,
behind an `LLMProvider` Protocol in `packages/adapters`.

**Why.** Owner decision: no metered API spend.

**Cost — and this one is real.** Doc 04 §9 calls "can it run inside our network
without calling a foreign API?" a certainty in a government room, and says
answering it wins the room. With hosted free tiers the live answer is no.
The Protocol makes an `OllamaProvider` a one-env-var swap, so the honest answer
becomes "architecturally yes, here is the path" — defensible, but weaker than a
demonstration. **Revisit before the pitch.**

**Not affected.** Embeddings are `multilingual-e5-large` run locally via
sentence-transformers, so retrieval works fully offline regardless of provider.

---

## ADR-009 — RT-DETRv2 + supervision; no Ultralytics in shippable code
**Date:** 2026-08-18 · **Status:** Accepted · **Reinforces:** doc 02 Stack, doc 04 §2

Detection is **RT-DETRv2 (Apache-2.0)** via HuggingFace Transformers. Tracking is
**ByteTrack via `supervision` (MIT)**.

**Why.** Ultralytics YOLO is AGPL-3.0. For software intended for government
deployment that is a procurement blocker and a legal exposure a system
integrator's counsel will find. `supervision` gives us ByteTrack without pulling
the AGPL dependency in through the back door — which is the trap, since ByteTrack
is most commonly reached via Ultralytics.

**Enforcement.** CI greps for `ultralytics` imports and fails the build.
Experiment-only files must carry a header comment marking them non-shippable.

---

## ADR-010 — One database, no second store
**Date:** 2026-08-18 · **Status:** Accepted · **Affirms:** doc 03 §1

Tiger Cloud (managed TimescaleDB) holds time series (hypertables), geospatial
(PostGIS) and embeddings (pgvector) in one engine with one backup story and one
access-control model.

**Why.** Doc 03 §1 states it best: a solo builder adding ClickHouse plus Redis
plus Elasticsearch plus a vector DB ships nothing. Redis is present, but as an
event bus and cache — not as a system of record.

**The benchmark that would change this.** Add a second store only when a measured
benchmark demands it, and record the benchmark here. None exists yet.

**Known constraint.** Tiger Cloud's free plan caps at 750 MB and then goes
read-only. Mitigated by columnstore compression at 7 days, sparse seeding, and
the doc 05 retention policy. Escape hatch is the $30/mo Performance plan.

---

## ADR-011 — Next.js 16, TypeScript 5.9, Node 24 LTS
**Date:** 2026-08-18 · **Status:** Accepted, trivially reversible · **Supersedes:** doc 03 Stack, doc 06 §2

Doc 03 specifies "Next.js 15 App Router". We scaffolded on **Next.js 16.3.1**.

**Why.** The App Router surface the spec actually depends on is unchanged between
15 and 16. Next 15's last release is 15.5.23; starting there guarantees a
framework upgrade partway through a twelve-week build, during the weeks that
should be spent on counting accuracy. React 19.2, Tailwind 4.3 and Motion 13 are
all current-generation and pair with 16.

**Cost.** Next 16 renames the `middleware.ts` convention to `proxy.ts` (already
migrated). Reverting to 15 is a one-line `package.json` change plus a reinstall,
so nothing is lost if this is vetoed.

**TypeScript 5.9.3, not 7.0.2.** TypeScript 7 (the Go-based native compiler) went
GA on 2026-07-08 — six weeks old at the time of writing. Nothing in this project
needs its compile speed, and the ESLint/type-plugin ecosystem is still catching
up. 5.9.3 is the mature line. Revisit at Phase 9.

**Node 24 LTS, not 20.** Node 20 has left maintenance, and jsdom 30 (the test
environment) requires `^22.22.2 || ^24.15.0 || >=26`. Pinned via `.nvmrc` and
`engines`. Installed through the existing nvm — no system Node was touched.

**Correction to doc 06 §3.** The doc says the target build is "r128-compatible",
and therefore to avoid `CapsuleGeometry` and to use drei's `OrbitControls`
rather than the THREE-namespace one. That constraint does not apply to this
stack: we are on three 0.185.1 with React Three Fiber 9.7. The drei advice is
still right for other reasons; the r128 geometry restriction is not, and should
be ignored.

---

## ADR-012 — Docker removed from the project entirely
**Date:** 2026-08-18 · **Status:** Accepted · **Supersedes:** ADR-002 (partly), doc 03 §5

There is no Docker anywhere: no Dockerfiles, no compose file, no container
runtime on any developer machine.

**Local stack** is Homebrew services, managed by `scripts/dev_stack.sh`:
PostgreSQL 18 with TimescaleDB 2.29.2 + PostGIS 3.6.4 + pgvector 0.8.6, Redis,
MinIO, and Ollama.

**Render** uses native runtimes — `runtime: python` for the API, worker and both
cron jobs, building from source with uv. The one third-party service, Keycloak,
uses `runtime: image`, which makes Render pull the vendor's published image
directly. No image is authored, built or pushed by us.

**Postgres 18 on port 5433, not 17 on 5432.** The machine already runs
postgresql@17 on 5432 serving other projects (`jal`, `loupe_dev`, `loupe_eval`,
`loupe_citest`). Homebrew's timescaledb builds against postgresql@18, and a
Postgres extension is ABI-locked to its major version, so it cannot be loaded
into 17. PRAVAAH therefore gets its own instance on 5433 and the existing one is
untouched. `postgresql.conf` for 18 was backed up to
`postgresql.conf.pravaah-backup` before the port and `shared_preload_libraries`
edits.

**Cost.** The offline demo no longer starts with one `docker compose up`; it
starts with `make up`. Contributors need Homebrew rather than Docker Desktop.
The RSDC production story is unaffected — `infra/k8s/` is where that lives, and
Kubernetes pulls upstream images regardless.

---

## ADR-013 — A security_barrier view, not RLS, on the compressed hypertable
**Date:** 2026-08-18 · **Status:** Accepted · **Refines:** doc 07 §5

Discovered by the migration failing, not by reading ahead: **TimescaleDB refuses
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on a hypertable that has columnstore
compression enabled.**

That put two requirements in direct conflict. Compression is what keeps the
seeded 90 days inside Tiger Cloud's 750 MB free-plan ceiling (ADR-010).
Corridor-level ABAC has to be enforced in the query layer, because doc 07 §5 is
explicit that application-layer filtering is one missing `WHERE` clause away
from a breach.

**Resolution.** `traffic_counts` keeps compression. `pravaah_app` is granted no
`SELECT` on the base hypertable at all; it reads through
`traffic_counts_scoped`, a `security_barrier` view that filters on
`app_corridors()`. The guarantee is identical — the database decides, not the
caller — and the barrier flag prevents a cheap user-supplied function being
pushed below the filter to leak rows.

Regular tables (`road_links`, `junctions`, `violations`, `defaulter_scores`)
keep true RLS policies, since none of them is a compressed hypertable.

Verified by `scripts/verify_security.py`, which asserts the missing grant and
the barrier flag rather than trusting the migration ran.

---

## ADR-014 — Ollama is present; the on-prem LLM answer is available after all
**Date:** 2026-08-18 · **Status:** Open — needs a decision · **Amends:** ADR-008

ADR-008 recorded that free-tier hosted models cost us the answer to "can it run
inside our network without calling a foreign API?", which doc 04 §9 calls a
certainty in a government room.

**That constraint turns out not to bind.** This machine already runs Ollama as a
started service, with `qwen3:8b`, `qwen3:4b`, `llama3.2:3b` and
`nomic-embed-text` pulled. Qwen3-8B is Apache-2.0 and genuinely capable in
Hindi. `scripts/dev_stack.sh status` reports Ollama as part of the stack.

**What this makes possible, at no cost:** NEETI demonstrably answering a Hindi
question with the network cable pulled — which is a stronger version of the
claim than any architecture slide, and exactly the moment doc 09 §3 scripts at
the five-minute mark.

**Recommendation.** Make `OllamaProvider` the default for the offline demo path
and keep Gemini/Groq for the hosted deployment. Same `LLMProvider` interface,
one env var apart. Embeddings stay on `multilingual-e5-large` regardless, since
`nomic-embed-text` is not strong enough on Devanagari.

**Not yet actioned** — flagged for the owner, because ADR-008 was an explicit
choice and this reverses part of it.

---

## ADR-015 — Interface rebuilt around a 3D city; officer PWA is 2D-first
**Date:** 2026-08-18 · **Status:** Accepted · **Supersedes:** doc 06 §1, §3, §6

The first interface was rejected outright by the owner, and the criticism was
correct. It defaulted to light when doc 06 §6 itself says dark is the
control-room native mode; every panel was a 1px-border rectangle with no
elevation or layering; it shipped no WebGL at all despite 3D being in the
original brief; and the brass accent was so restrained it read as beige.

**The new concept: the city is the interface.** Real OpenStreetMap geometry
becomes a stylised night city — roads as emissive ribbons coloured by measured
congestion, dark massed buildings for urban context, volumetric fog, bloom.
Traffic is instanced light particles whose density and speed are actual measured
counts. Data panels are glass over the scene rather than boxes beside it.

**Four signature moments**, all driven by real data: a camera flight down the
corridor on load; counts rendered as light you can watch; a gnomon shadow that
sweeps the day across the scene; and a time-scrub that re-renders the whole city
to any moment in the seeded 90 days, including TomTom's worst Jaipur day.

**Two real front doors, not one and a stub.** doc 03 §7 sets WCAG 2.2 AA and
doc 06 §8 requires reduced motion to have a genuine static fallback. So the 2D
mode is designed to the same standard as the 3D one, and serves no-WebGL,
reduced-motion and low-power devices.

**The officer PWA defaults to 2D, with 3D as an opt-in.** Maximum 3D cannot hold
60fps on the mid-range Android that half the officers will actually carry
(doc 06 §4 makes the same point about `backdrop-filter`). The field surface is
for reading an assigned corridor and filing an incident in poor light on a
cheap handset; a city flythrough is not what that job needs. Command centre and
public site get the full scene.

**Typography.** Clash Display for display, self-hosted under the ITF Free Font
Licence; Anek retained for UI and Hindi; JetBrains Mono replaces IBM Plex Mono
for data. Clash and Anek are both Indian Type Foundry faces — for a Government
of Rajasthan product that is a better story than a pairing of convenience, and
it is why Anek was kept rather than replaced.

**Palette.** Four dark-first candidates, each with layered surfaces rather than
pure black and exactly one saturated accent. `scripts/check_contrast.py` runs in
CI and fails the build if any token drops below its WCAG target, because a
palette is easy to nudge during design and impossible to re-audit by eye.

---

## ADR-016 — Jaipur Night is the product palette
**Date:** 2026-08-18 · **Status:** Accepted · **Settles:** ADR-015's open palette question

Four dark-first palettes were built and compared on the live city at the 19:00
peak, where the congestion ramp actually separates them. **Jaipur Night** —
`#070B18` indigo ground, `#FFC53D` molten brass accent — is the product palette.

**Why it, and not the others.**

*Signal* (charcoal + electric cyan) is the cleanest instrument of the four and
the highest contrast, but it has no connection to the city it measures. For a
product whose entire pitch is "we understand Jaipur specifically", a palette
that would suit any operations console anywhere gives that away.

*Pink City After Dark* is the most memorable and the riskiest. Warm coral on
plum reads as consumer product in a room where the audience is deciding whether
to trust a fatality statistic.

*Araish Reversed* keeps the original doc 06 thesis, and its brass accent
collides with the amber band of the congestion ramp — the accent and a safety
signal competing for the same hue is exactly the failure doc 06 §1 warns about.

Jaipur Night keeps the indigo/brass identity without that collision: brass sits
at 12.4:1 on the ground and never appears in the congestion scale.

**What this changes in the code.** The palette switcher is removed from the
interface. It was an evaluation control, the evaluation is over, and shipping it
to a government audience invites "which one is the real one?". The other three
palettes remain defined in `palettes.css` and are still measured by
`scripts/check_contrast.py`, so reverting is a one-line change.

**What is kept.** The day/night scene toggle stays — that is a genuine product
feature, not an evaluation aid. The congestion ramp is byte-identical in both
modes, because it is the one thing that must never change meaning.

---

## ADR-017 — Google Maps, on the owner's explicit instruction
**Date:** 2026-08-18 · **Status:** Accepted under owner override · **Overrides:** doc 06 §2

Doc 06 §2 says plainly: *"Do not use Google Maps."* Its reasons are per-load
billing, a broken offline demo, and — the sharp one — that it *"removes the
awkward moment where your Google-dependency-solving product depends on Google."*

That objection was put to the owner with alternatives (Esri World Imagery, free
and keyless; MapTiler; stylised OSM land use). The owner chose Google Maps
anyway. It is their project and their call, and it is recorded here as an
override rather than a silent deviation.

**Two mitigations, both mandatory.**

*Offline.* doc 03 §5 requires the demo to run with the network cable pulled, and
a live tile request cannot. Tiles are cached to a local file at build time and
the renderer reads the cache first, so a wifi failure degrades to stale imagery
rather than a blank map.

*The question.* Somebody in that room will ask why a product whose pitch is
"Google cannot measure volume" is rendering on Google's basemap. The prepared
answer: Google supplies the photograph, PRAVAAH supplies the measurement; they
are different jobs, and the platform's own data path touches no foreign service.
Worth rehearsing, because it will be asked.

**Target.** Photorealistic 3D Tiles, which is what gives real Jaipur buildings
and terrain rather than a flat image. Requires an API key with billing enabled.
Behind an adapter, so the scene falls back to the current OSM massing when no
key is present — the build must never fail for want of a credential.

---

## ADR-018 — Zoom levels, not one compromise framing
**Date:** 2026-08-18 · **Status:** Accepted

The camera framing was hand-tuned five times and drifted every time, because it
was being asked to do something impossible: show a 17 km corridor and a 4 m
vehicle in the same shot. Those are four orders of magnitude apart, and any
single distance fails one of them.

Two changes. Framing is now computed from the camera's field of view — `fit` is
the distance at which the scene's bounding sphere exactly fills the frame, so
the fractions in the code mean something instead of being magic numbers. And the
product gets explicit zoom levels rather than one compromise:

| Level | Distance | Reads |
|---|---|---|
| Overview | `fit × 0.85` | the whole corridor's shape and where it is red |
| Corridor | `fit × 0.12` | individual vehicles, class mix, buildings — the default |
| Junction | flown to on click | turning movements, queues, that camera's accuracy |

The junction level is the click-to-fly interaction still to be built.

---

## ADR-019 — The orbit target must sit on the corridor, not at its centroid
**Date:** 2026-08-18 · **Status:** Open — known defect

The camera orbits `[0, 0, 0]`, which is the centroid of every link in the
corridor. Tonk Road is a curve, so that centroid is not on the carriageway — it
sits in the empty space the curve bends around.

At overview range this is invisible. Closer than about `fit * 0.028` it is not:
the camera flies past *beside* the road instead of along it, and the frame goes
empty. That is why the close-up inspection failed rather than showing the
vehicle silhouettes.

The fix is to snap the orbit target to the nearest point on a link — the same
"which link am I looking at" machinery the junction click-to-fly interaction
needs, so the two should be built together rather than separately.

Until then the default framing is capped at `fit * 0.028`, which is the closest
range that reliably keeps the corridor in shot.

---

## ADR-020 — The console's map pane rendered nothing. RESOLVED.
**Date:** 2026-08-18 · **Status:** Resolved — cause was hypothesis 3

`/en/console` mounts a WebGL canvas at full size (measured 369 × 952, live GL
context, not lost) and draws nothing. The identical `<City>` component renders
correctly at `/en/city`. Three hypotheses were tested and none was the cause.

**Ruled out — but each was a real defect and the fix was kept:**

1. *Portrait framing.* three's `fov` is vertical, so fitting on it alone put a
   wide corridor outside the horizontal frustum of a tall, narrow pane. Now fits
   to whichever axis is tighter. Correct, insufficient.
2. *Unmemoised scene data.* The console built its scene object in an IIFE on
   every render, so geometry rebuilt every frame, which trips the frame-budget
   guard, which calls setState, which re-renders. A genuine feedback loop.
   Fixed. Not the cause.
3. *`<Environment preset>` suspending.* drei fetches an HDR from a CDN and
   suspends until it arrives; nothing inside `<Suspense>` mounts meanwhile. This
   ALSO breaks docs/03 §5 — a scene that waits on a CDN cannot render with the
   cable pulled — so it was replaced with explicit lights regardless. Not the
   cause either.

**Established by instrumentation:** a probe calling `useFrame` inside `<Scene>`
never executes on the console route. The render loop does not start. So the
failure is above the scene graph, not in the geometry, the camera or the
materials — which is where all three hypotheses were aimed.

**Resolution.** It was hypothesis 3 — `<Environment preset>` suspending on its
CDN fetch. Removing it fixed the pane. I recorded it as "not the cause" because
I screenshotted before the scene had finished building and saw a blank frame,
then moved on. The fix was already correct; the verification was not.

**The lesson, which is the reason this ADR is worth keeping:** a negative result
from a check that ran too early is not a negative result. Two subsequent
hypotheses were investigated against a fault that had already been fixed. Where
a scene takes seconds to build, wait for a positive signal — a draw call, a
non-background pixel — rather than reading an empty frame as evidence.

The `<Environment>` removal stands on its own merits regardless: a scene that
waits on a CDN cannot satisfy docs/03 §5's requirement to render with the
network cable pulled.

---

## ADR-021 — Surface elevation, and every panel carries a chart
**Date:** 2026-08-18 · **Status:** Accepted · **Supersedes:** the console's first card language

The first console panels were 1px-bordered rectangles with 10px labels — the
same fault as the very first interface, rebuilt in dark mode. The specific error
is worth naming: **in a dark interface, elevation comes from surface colour, not
from borders and shadows.** A lighter surface reads as closer. Borders and drop
shadows are a light-mode idiom, and using them is why nine panels read as nine
identical flat rectangles with no hierarchy.

Three treatments were built on one panel and compared on live data at
`/en/design` — surface elevation, command telemetry, editorial. The owner chose
**surface elevation**. Telemetry is kept in the repo as a candidate for a future
ICCC wall build; it is genuinely good and structurally fragile at three figures
across, which it demonstrated by colliding into one run-together number.

**Every panel now carries a chart**, which the first version had none of:

- 24-hour congestion profile, an area chart whose vertical gradient IS the
  published ramp, with a brass marker at the current moment — the gnomon idea
  carried into the chart an engineer actually reads
- Composition donut plus proportional bar, hand-built SVG so ring and bar share
  exact class colours. This panel is raised one further surface step, because it
  is the argument: no probe product can produce this split
- Weekly heatmap, seven days by twenty-four hours, measured history rather than
  a forecast — the view where "Friday 17 October was the worst day of 2025"
  becomes checkable rather than quoted

**Density is five real targets**, not three breakpoints: phone, laptop, desktop,
control-room wall, projector. No component hardcodes a size, so a density change
is a media query. There is an explicit override for a demo where the automatic
guess is wrong.

**Figures clamp, never truncate.** A number cut to "6…" is unreadable *and*
looks broken; a smaller number is merely smaller. Both failure modes appeared
during this work — telemetry at three-across and the quality panel at rail
width — and both are now structurally impossible.

---

## ADR-022 — One writer for day/night; the 3D pane follows the interface
**Date:** 2026-08-18 · **Status:** Accepted

Light mode was rendering a glowing night city inside a white interface, and the
toggle looked broken. It was not. There were **two writers of the same DOM
attribute**: the header toggle set `data-scene`, and the 3D view held its own
`useState` whose effect re-asserted `night` on every render. The console shells
made it worse by passing `scene="night"` as a literal.

`apps/web/src/lib/theme.ts` is now the only writer. The store *is* the document
— `currentScene()` reads the attribute rather than caching a copy — so there is
no second value that can drift. Every consumer subscribes through
`useSyncExternalStore`.

The daylight scene already existed in full (sky, ground albedo, hemisphere
light, bloom disabled). It had simply never been told the time of day. Nothing
in the renderer needed changing.

**Rule taken from this:** a DOM attribute has exactly one writer. A component
that both owns state and writes it to the document will be overridden by, or
will override, anything else that touches it, and the resulting bug looks like
a rendering fault rather than a state fault — which is why it cost two rounds
of "light mode looks very bad" before being found.

---

## ADR-023 — The resting zoom is the corridor, not the close-up
**Date:** 2026-08-18 · **Status:** Accepted · **Refines:** ADR-018

The camera flight rested at `fit * 0.028`, tuned to answer a one-off "zoom in
and show me the vehicles close up". That close-up then silently became the view
an official opens the dashboard to: two cars and a strip of tarmac, no city in
shot.

Resting zoom is now `fit * 0.12` — a readable stretch of corridor with vehicles
still legible on it. **A close-up is a thing you zoom to, never the thing you
land on.** ADR-018's zoom-level design already said the overview and the vehicle
are four orders of magnitude apart and must be different zoom levels; this fixes
which one is the default.

Below roughly 0.03 the camera also passes *beside* the carriageway rather than
along it, because OrbitControls targets the centroid of every link and a curved
corridor's centroid is not on the road. That remains open as ADR-019.

---

## ADR-024 — Incidents come from a detector or from crash records, never from
## invention
**Date:** 2026-08-18 · **Status:** Accepted

The incidents panel needed a chart, and the incidents table was empty. The
tempting move — generate plausible incidents so the panel looks alive — is
exactly what CLAUDE.md prohibits, and it is the kind of thing that survives
until someone in the room asks where the number came from.

Two honest sources were built instead.

**A real detector.** `packages/adapters/.../anomaly.py` plus
`scripts/detect_incidents.py` score every link-bucket as a robust residual
against *that link's own* median for that weekday-hour, with MAD as the scale.
Both statistics are robust deliberately: a mean and a standard deviation are
dragged upward by the very incidents being searched for, so a z-score detector
on incident data reports fewer incidents the more there are. Two tests must
pass — statistically unusual *and* materially worse — because a near-constant
link has a near-zero MAD that manufactures huge z-scores from a two-point
wobble, and because an unsigned residual reports a public holiday as a city-wide
emergency.

Run over the seeded 24 hours it found **3 low-severity anomalies**. That is a
true result and it is reported as such. The seed is a smooth deterministic
profile; it contains almost no anomalies because nothing put any in. A detector
that returned a satisfying number here would have been the broken one.

**Crash records for the chart.** 18,578 crashes across 2021–2025, banded by
injury outcome, by hour of day, with the congestion curve drawn over them. The
two series peak at the same hour — 18:00 — which is the finding that turns a
traffic-management pitch into a road-safety one: the evening jam is when people
are hurt. Crashes and congestion anomalies are kept as separate objects on the
panel; stacking them would produce a total that means nothing.

---

## ADR-025 — `Row.index` is `tuple.index`
**Date:** 2026-08-18 · **Status:** Accepted

Several queries labelled a column `AS index` and read it back as `r.index`.
SQLAlchemy's `Row` resolves it to the column at runtime, so it worked — but
`index` is also a tuple method, the expression reads as the method to anyone
scanning the code, and mypy types it as one. Labels are now `congestion_index`.

Filed because "it works at runtime" is the reason this kind of shadowing
survives review, and the failure mode when it eventually does not work is a
silent wrong number rather than an exception.

---

## ADR-026 — Five densities means five layouts, not five font scales
**Date:** 2026-08-18 · **Status:** Accepted

The console was a fixed `168px | 1fr | 312px` grid with no collapse, so a phone
rendered a desktop layout at phone width: the nav ate half the screen, the rail
was cut off horizontally, and figures truncated to "6…". Below 1024px it now
stacks — nav becomes a horizontal tab strip, the map takes 45vh, panels flow
full width and the page itself scrolls. 1024 rather than 768 because a 168px
nav and a 312px rail leave a tablet with a 288px sliver of map.

**The rail and nav widths are density tokens now**, not layout constants. A rail
fixed in pixels while the figures inside it scale with density is precisely what
collided "2.93 L" and "1.62 L" into "2.931.62" on a control-room wall. Anything
that must stay in proportion to type belongs in `density.css`.

Two faults found by actually looking at each target rather than trusting the
tokens:

**The projector query was inverted.** It read `(min-resolution: 0.75dppx) and
(min-width: 1600px)`, intending "a low-DPI surface". But `min-resolution` is a
floor: every ordinary display is 1dppx and every retina one is 2dppx, so it
matched all of them and silently gave every desktop wider than 1600px the
projector's sizing — a 1920 control-room wall included. `max-resolution: 1dppx`
is the test that was meant.

**`lg:h-auto` on the map cell blanked the 3D pane.** The R3F canvas sizes itself
at `height: 100%`, which needs a resolved height on the parent; a grid item set
to `height: auto` does not provide one even while `align-self: stretch` makes it
look correct in the inspector. The mobile height is now scoped with `max-lg:`
so the desktop path keeps the height it always had. A percentage-height child
makes its parent's height load-bearing — changing that parent to `auto` is never
a no-op.

**Figures carry their unit as a non-breaking space.** "2.93 L" was wrapping to
put a lone "L" on the next line, which reads as a rendering fault rather than a
number.

### Resolved
Day mode at 1920 rendered a blank pane. **Closed by ADR-035** — the pane was not
blank, it was white: the day scene was so over-lit that every surface clipped to
the fog colour, which sat within a few percent of the light interface's own
background. Nothing was broken; nothing was visible either.

---

## ADR-027 — Figures are sized by container query, not by viewport
**Date:** 2026-08-18 · **Status:** Accepted · **Supersedes:** the `scale` prop in ADR-021

The same fault came back three times: a figure truncating to "6…", two figures
colliding into "0.012.0", a unit orphaned on its own line. Each time it was
patched with a hand-tuned `scale` multiplier, and each time a different width
brought it back.

The cause is that **a figure sized off the viewport knows nothing about the
column it is in.** Three metrics in a 300px rail collide; the same three in a
500px rail are comfortable; the viewport is identical in both cases, so no
media query can tell them apart. Only the container can.

Every panel is now a `@container`, and `Metric` computes its own size:

```
chars = value.length            // the value actually being rendered
cqi   = span · 100 / (0.62 · chars)
font  = clamp(0.95rem, {cqi}cqi, var(--d-figure))
```

0.62em is a monospace glyph's advance width. The figure therefore occupies its
allotted fraction of *its own panel* and cannot overflow — at any viewport, at
any density, and at any width the user drags the panel to. A value that gains a
digit shrinks itself instead of colliding. The clamp keeps it legible at the
bottom and stops it going cartoonish on a projector at the top.

`MetricRow` reflows 3 → 2 → 1 on the panel's width rather than the window's.

This is what made resizable panels safe to ship at all. Without it, every drag
would be a new opportunity to reproduce the collision.

---

## ADR-028 — The console is resizable, and the drag does not go through React
**Date:** 2026-08-18 · **Status:** Accepted

A control room is not one layout. The officer watching a corridor wants the map
wide; the analyst reading panels wants the rail wide; a review on a projector
wants it wider still so the back row can read a figure. A fixed 312px rail
makes two of those three lose.

The split is draggable, keyboard-operable (`role="separator"` with arrow keys —
a wall display driven from a lectern has no mouse), double-click to reset, and
persisted per key.

**The drag writes a CSS custom property, not React state.** A `setState` per
`pointermove` re-renders the console — including the WebGL canvas's parent —
sixty times a second, dropping frames exactly while the user is judging whether
the drag feels smooth. React learns the value once, on release.

**Persistence is read through `useSyncExternalStore`, not restored in an
effect.** Restoring in an effect renders the default, sets state, then renders
again: a cascade the React compiler refuses, and a visible jump of the rail on
every load. The same reasoning as ADR-022 — storage is the store.

The command palette follows the same principle from the other direction: it is
**mounted fresh** each time rather than reset by an effect. A component that
should start clean should be created clean.

---

## ADR-029 — RBAC is drawn twice and enforced once
**Date:** 2026-08-18 · **Status:** Accepted

Seven roles, mirroring `VALID_ROLES` in the API exactly, with a capability
matrix in `apps/web/src/lib/rbac.ts`.

**The client matrix is a rendering aid and is documented as one, at the top of
the file.** Every capability is checked again by `request_scope` and enforced by
Postgres RLS. Hiding a control the user cannot use is good interface design;
relying on that hiding is how products get breached, because the API is
reachable without the interface.

A role sees only the sections it can use — not nine greyed-out entries. Disabled
items an operator can never enable train people to ignore the nav, and on a
shared control-room screen they advertise which functions exist to someone who
should not know.

**The login screen collects no password, deliberately.** In deployment it
redirects to Keycloak federated to the state SSO with mandatory MFA. A demo that
asks an official to type a password into a bespoke form teaches a government
workforce the exact habit that makes them phishable. The demo path selects a
role instead, shows that role's capabilities before you commit to it — "what
will my enforcement team actually see?" is the question that decides a
procurement — and says on screen that this is demo mode.

The role switcher is disabled in two independent places: `NEXT_PUBLIC_DEMO_MODE`
at build time, and a 403 from the API for the `X-Demo-Role` header whenever
`DEMO_MODE` is off. One of those would be a convenience; two make it an
affordance that cannot survive into production.

---

## ADR-030 — Enforcement shows the gate, not just the queue
**Date:** 2026-08-18 · **Status:** Accepted

The enforcement surface leads with the **confidence gate**, not with the
violation count: 1,051 violations, 631 below 0.85 confidence and therefore
requiring a human, and **0 auto-confirmed below the gate**.

That last figure is the one worth putting on screen. docs/04 §4 requires a
reading below 0.85 to go to a human, and the database enforces it with a CHECK
constraint, so the zero is not a claim of good behaviour — it is a number that
*cannot* be anything else. A department evaluating this can see the rule is on
rather than being told it is.

`confirmed` and `auto_confirmed` are reported separately and never summed. They
are different claims: one says a machine was confident enough to skip a human,
the other says a named person agreed. The split is what a procurement needs
before it trusts either.

No endpoint returns a registration number. Plates live as an HMAC digest and as
ciphertext; the defaulter list shows an eight-character digest prefix — enough
to tell two rows apart in a meeting, useless for re-identification. Every
defaulter score carries its SHAP explanation, which the database refuses to
store without.

---

## ADR-031 — Console strings live beside the console; "live" has to be live
**Date:** 2026-08-18 · **Status:** Accepted

The console panels were written in English while the shape of each panel was
still moving. That was the right order to build in and the wrong place to stop —
CLAUDE.md prohibits a hardcoded user-facing string, and docs/02 rule 7 makes
Hindi first-class rather than a translation layer.

`apps/web/src/lib/strings.ts` holds every console string as an `[en, hi]` pair,
deliberately as a plain table rather than next-intl messages. These are the ~90
strings of one dense operator surface, they change together whenever a panel
changes, and keeping them next to the components is what makes a missed English
string obvious in review. The marketing surfaces stay on next-intl, where
translator workflow matters more than proximity.

The Hindi is what a Jaipur traffic engineer says: "भीड़" for congestion rather
than a Sanskritised coinage, "चालान" for a challan, "लिंक" transliterated
because that is the department's own word.

**A panel titled "Counts · live" that never changes is a lie the interface
repeats every few seconds.** It now polls. Three properties matter more than the
polling:

- It **stops while the tab is hidden**, and refetches on return. A console left
  on a wall overnight should not issue a request every fifteen seconds until
  morning.
- A failed poll **keeps the last good value** and marks itself stale. Blanking a
  figure because one request timed out is worse than showing one that is fifteen
  seconds old, provided the age is visible.
- It **backs off** on repeated failure. A control room that loses its API should
  not become a client hammering a struggling server.

The pulse keys on the **value changing**, not on the poll completing. A poll
returning the same count does not flash, because nothing happened — an animation
on a static number is a lie told in motion.

---

## ADR-032 — The policy case is computed, not asserted
**Date:** 2026-08-18 · **Status:** Accepted

Low-emission zones and congestion pricing are where a traffic platform normally
shows a slide. NEETI computes them instead, from this corridor's own measured
class mix and the speed curve already calibrated against the published 17.5
km/h rush-window mean.

The lead panel is **road space against vehicle count**, two bars per class on
one row. At the evening peak two-wheelers are 61.0% of vehicles and 27.6% of
PCU; cars are 24.0% of vehicles and 43.4% of road space. Where the two bars
disagree is the entire argument for counting and classifying rather than
sampling probes — no probe product can draw that distinction, and every capacity
calculation and signal plan depends on it.

Modelled outcomes, at 19:00 on the model corridor:

| Scenario | PCU removed | Index | Peak speed |
|---|---|---|---|
| Low-emission zone (older goods + farm, 60% compliance) | 8.1% | 86.5 → 79.5 | 15.4 → 18.0 km/h |
| Congestion charge (₹12/PCU, 18% diversion) | 11.4% | 86.5 → 76.6 | 15.4 → 19.1 km/h |

Three decisions worth defending:

**The charge is per PCU, not per vehicle.** A two-wheeler occupies a quarter of
the road a car does; charging both the same is indefensible, and PCU is already
the unit every capacity calculation uses.

**Revenue is shown beside the delay it buys, never instead of it.** ₹6.7 lakh
per peak hour is reported next to +3.7 km/h, because a congestion charge sold on
revenue is a tax and a congestion charge sold on delay is a policy.

**Assumptions are a panel, not a footnote.** Compliance and diversion shares are
assumptions and are labelled as "the numbers a department should argue with".
The congestion-vs-PCU relationship is stated as first-order, valid near
saturation, optimistic once flow is free. A policy model whose assumptions are
hard to find is one designed to win an argument rather than inform one.

---

## ADR-033 — The edge section reports what a probe cannot
**Date:** 2026-08-18 · **Status:** Accepted

`Edge · CV` exists to answer one question in the room: *what does this do that
Google Maps does not?* So it reports the things a GPS probe structurally cannot
produce.

**Vehicles per minute, per camera, by class.** Per minute rather than per hour,
deliberately: an operator can check 52.2 veh/min against a live feed by counting
for sixty seconds. A per-hour figure is unfalsifiable in the room, which makes
it worth less than a smaller number that can be tested.

**Observed minutes, not wall-clock minutes.** The rate divides by `bins × 5`
rather than by 60. A camera that was down for half the day would otherwise
report as half as busy, which is a data-availability problem disguised as a
traffic finding.

Three constraints are stated on screen rather than in a document, because each
is a procurement question that will be asked:

- **No face recognition, no person tracking, no biometrics**, at any point.
  Vehicles are counted and classified; people are not identified.
- **No Ultralytics YOLO in shippable code.** AGPL-3.0 is a procurement blocker
  for a government deployment. RT-DETRv2 is Apache-2.0 and ByteTrack via
  `supervision` is MIT. Putting the licence on the screen turns a constraint
  into evidence of diligence.
- **Video never leaves the gantry.** The edge node emits counts, classes, speeds
  and violation events — metadata in bytes, not a video backhaul in megabits.
  This is the answer to "what will this cost in bandwidth", which is the second
  question every time.

And the status line stays honest: counting runs on IDD and UA-DETRAC, and is
**not yet validated on Jaipur video** — that needs a read-only RTSP feed. A
platform that claims local validation it does not have loses the room the first
time someone checks.

---

## ADR-034 — A fixed height belongs to the map, not to the pane
**Date:** 2026-08-18 · **Status:** Accepted

On a phone the Edge section's content painted straight over the panel rail
stacked below it, and the first hypothesis was Recharts leaving its `<svg>`
overflow visible. That was wrong, and the wrong fix — `overflow-hidden` on the
chart wrapper — would have clipped tooltips near the plot edge to cure a
symptom.

The cause was `max-lg:h-[45vh]` on the `<main>` cell. The map is a WebGL canvas
with **no natural height** and must be told one. A section view has real
content; giving it 45vh clips it, and the overflow paints over whatever the
stacked layout puts underneath. The height is now applied only when the map is
what's showing.

Third time this exact class of bug has appeared (ADR-026's `lg:h-auto`, the
`h-dvh` overflow that painted through the alert ticker, and this), so it is
worth stating as a rule: **a height that exists to prop up a canvas must never
be applied to a pane that may hold ordinary content.** Scope it to the canvas
case explicitly.

Recorded also because the first hypothesis was plausible and would have "worked"
on the screenshot — the lesson of ADR-020 in a different costume.

---

## ADR-035 — Daylight is one hard sun, not more light everywhere
**Date:** 2026-08-18 · **Status:** Accepted · **Closes:** the open item in ADR-026

The "blank 3D pane in day mode at 1920" was not blank. It was **white**, and it
was white everywhere — 1440 included. It only read as a fault at 1920 because
the wider pane gave the eye more uniform nothing to look at.

The day palette ran `ambientLight` at 1.5 with a 2.2 key, a 0.9 hemisphere and a
0.5 fill. Through the ACES tone curve R3F applies by default, that clips almost
every lit surface to white. Ambient light in particular contributes equally to
every face of every mesh, so raising it does not make a scene brighter — it
makes it *flatter*, and past a point every building is the same value as the
sky behind it. **It is the shadow side of a building that tells you the building
is there.**

Now: ambient 0.5, key 1.8, hemisphere 0.75, fill 0.3. One hard sun and a little
bounce.

The palette was also cold. Fog and haze were sky-blue (`#C7D6E9`), the ground a
grey `#B9BFC9`, asphalt a blue-grey `#565C66`, buildings `#C2C7D0`. Two problems
with that beyond taste:

- Jaipur's daytime air carries desert dust. A cold blue haze reads as a European
  overcast, not as this city.
- More practically, `#B9BFC9` ground sat within a few percent of the light
  interface's `--ground` at `#DDE5F0`. The 3D pane looked like an empty panel
  *however much geometry was standing in it* — which is precisely the report.

The day palette is now Jaipur sand (`#C0AC8C`), warm dust haze (`#D6CBB8`),
sun-bleached asphalt (`#6E6A61`) and warm plaster walls (`#CDBBA4`). The
hemisphere light's ground colour does real work here: it is light bouncing up
off sand that fills the underside of an overpass and keeps the shadow side from
going flat grey.

The congestion ramp is untouched, in both modes. It is the one thing that must
never change meaning — and with the lighting fixed it is now legible on the
carriageway in daylight, which it had not been.

**The lesson worth keeping:** "renders blank" and "renders invisible" are
different faults with different causes, and I spent a round checking WebGL
context state, GPU limits and canvas sizing on the first reading when the
evidence — a pane the same colour as the panel beside it — pointed at the
second.

---

## ADR-036 — A theme must not depend on a component's side effect
**Date:** 2026-08-18 · **Status:** Accepted

The new landing page rendered **black text on a transparent background** — every
palette variable undefined. `--ink`, `--ground`, the congestion ramp: all empty.

The cause: those colours were only ever defined under `[data-palette="night"]`,
and the only thing that reliably set that attribute was an effect inside the 3D
city view. The console therefore looked fine, because it mounts a 3D scene. Any
page **without** one — the landing page, the citizen view — got no colours at
all. The pre-paint `ThemeScript` was supposed to set the attribute and was not
running; that is worth fixing separately, but it should never have been the
thing standing between the product and legible text.

ADR-016 already settled that Jaipur Night is *the* product palette rather than
one of four candidates, so it now lives on bare `:root`. The
`[data-palette="…"]` blocks are kept so the `/design` comparison page can still
switch, but nothing needs them to be readable. The congestion ramp is on `:root`
for the same reason, and a stronger one: a link rendered without its band is a
measurement rendered without its meaning.

**Rule:** base colours belong in CSS at `:root`, not behind an attribute that
JavaScript has to set. A theme that depends on hydration is a theme that fails
exactly when hydration does — and the failure mode here was the *first screen an
official opens*, unreadable.

---

## ADR-037 — Public surfaces: landing and citizen
**Date:** 2026-08-18 · **Status:** Accepted

**The landing page runs on the same endpoints as the console.** No marketing
copy holds a figure the product could contradict: the 94.9% in the headline, the
2,93,035 vehicles, the 18,578 crashes and the modelled LEZ speeds are all
fetched, not typed. If the seed changes, the pitch changes with it.

Its structure is the argument in the order the argument actually runs — the
published peak, what a probe cannot tell you, composition, crashes peaking at
the same hour, and what a policy built on that composition does. No hero video
and no floating dashboard mockup: a government reviewer has seen the decoration
before, and the evidence is the more persuasive object.

**The citizen view is a different product, not a smaller console.** A citizen is
on a footpath with one hand on a phone and exactly one question — *is it worth
leaving now?* — so that is answered first, in one line, above everything.

It asks for **no location, creates no account, and stores nothing**. Asking for
a location to describe a corridor the user already named would be collecting a
trajectory to answer a question that does not need one — the opposite of
docs/07's data-minimisation position.

The advice always shows its reasoning. "Leave now" with nothing behind it is an
oracle, and an oracle is something people stop believing the first time it is
wrong; "leave now — 41 and rising into the evening peak, slowest stretch is X"
is information a person can disagree with.

The PWA manifest starts at the citizen view rather than the console, because an
installed app should open on the thing the installer wanted, and uses
`standalone` rather than `fullscreen` — someone deciding whether to leave needs
their clock and battery visible, and taking the status bar away to look more
like an app is a trade against them.

---

## ADR-038 — A speed limit is not a measured speed
**Date:** 2026-08-18 · **Status:** Accepted

The scene endpoint returned `COALESCE(measured.speed_kmh, l.free_flow_speed_kmh, 30)`.
Where no camera had seen a speed, it fell back to the link's **free-flow speed
limit** and returned it in the same field, indistinguishable from a
measurement. The citizen view rendered the result honestly and so exposed it:
*"50 km/h"* beside a congestion index of 96.

That is not a cosmetic problem. It is a contradiction any traffic engineer spots
in the first thirty seconds, and it undermines every other figure on the screen
— because if this one is a limit dressed as a measurement, which of the others
are?

Now:

- `speed_kmh` is the measured value where one exists, and otherwise is
  **derived from the congestion index** through the curve already calibrated
  against the published 17.5 km/h rush-window mean;
- `speed_source` is `"measured"` or `"modelled"` on every link, always;
- `free_flow_kmh` is returned separately, as the reference it actually is.

The interface marks a modelled speed with `~` and explains it on hover. The
numbers now agree with each other: index 96.4 reads 14.4 km/h modelled, next to
a measured 13.8 on a comparable link.

This is docs/06 §8 — "no naked number" — applied to a field that had been
quietly exempt. The rule is not only that a figure carries its quality; it is
that a figure must not silently change what it *is* depending on whether the
data arrived.

---

## ADR-039 — The officer PWA records decisions and applies nothing
**Date:** 2026-08-18 · **Status:** Accepted

docs/07 §6 forbids a model actuating anything. The officer app is where that
rule stops being a policy statement and becomes a screen: an advisory is a
recommendation until a named human accepts it, and **the acceptance is the thing
that gets recorded** — not the recommendation.

`POST /signals/decision` writes an `audit_log` row and returns `applied: false`.
That field is always false, and it exists precisely so that a future version
which genuinely drives a controller cannot be added quietly — it would have to
change the field, in a response an auditor reads.

**Authorisation is enforced twice, and the second one is the real one.**
`apps/api/src/pravaah/api/core/rbac.py` mirrors the client matrix and refuses
with 403. Four tests pin them together, including two that pin decisions rather
than mechanics: only `enforcement_supervisor` may unmask a plate, and **no
enforcement role may approve a signal plan** — the people issuing challans at a
junction are not the people retiming it. Verified end to end: viewer 403,
enforcement officer 403, rejection-without-reason 422, traffic officer 201 with
an audit id, and the audit trail itself refused to the officer and served to the
auditor.

The interface is built for one hand, outdoors, on a phone that is not new:

- Targets are 48px and sit at the **bottom** of each card, in thumb reach. A
  control-room layout shrunk to 375px is not a field tool.
- One junction is one card. An officer standing at a junction should not have
  to read a table.
- Advisories are ordered **heaviest first**. Someone opening this needs the
  junction that needs them, not `junction_id = 1`.
- A junction at capacity says so, and says that no cycle length rescues it —
  that is a geometry problem, and telling an officer the truth is more useful
  than handing them a longer green.
- A rejection requires a reason, refused client-side and server-side both,
  because "the next officer will read this" is the entire point of the record.

Every card carries the sentence *"This records a decision. It does not change a
signal."* on the card itself, not in a help page nobody opens.

---

## ADR-040 — NEETI: build the rails first, the planner second
**Date:** 2026-08-18 · **Status:** Accepted

NEETI ships as a **deterministic planner over a catalogue of five policy
questions**, with every guardrail docs/07 §5 requires already in place: a
read-only role, a 200-row cap, a 3-second statement timeout, DDL and DML
refused, and the SQL shown with every answer.

The order matters and is the decision. A text-to-SQL feature whose guardrails
arrive in version two is a text-to-SQL feature that has already run unguarded
against a government database. The rails are the product; the part that turns a
question into SQL is replaceable, and a language model would widen the question
space without changing a single guarantee.

**Every statement is a literal in the source.** The planner selects a whole
statement and binds parameters; no SQL is assembled from user input anywhere.
That makes injection *structurally impossible* rather than filtered — there is
no code path in which user text becomes SQL text. It is a stronger claim than
"we sanitise inputs", and it is the claim a security reviewer can verify by
reading one file.

**The catalogue is listed, not hidden behind a prompt.** A user who can see
exactly what may be asked does not guess, and the question space stays honest.
Free-text entry that quietly fails on anything outside a template is worse than
a list.

**The SQL is shown on every answer**, not behind a debug flag. An answer whose
query the reader cannot see is not evidence, and this platform's whole argument
is that its numbers are checkable.

The five questions are the ones a department actually asks: worst hours,
quietest freight window, vehicle mix by count *and* by road space, hours when a
crash is most likely to be fatal, and how many violations fall below the
confidence gate. Each returns its own reading, so a number never lands without
what it means. The crash-severity question excludes hours with fewer than 50
crashes — a percentage over a small base is noise, and shipping it as a finding
would be the platform doing the thing it criticises probe products for.

---

## ADR-041 — Offline: two caches, two policies, and things that are never cached
**Date:** 2026-08-18 · **Status:** Accepted

docs/03 §5 requires the demo to render with the network cable pulled. That is
not hypothetical: a government building's guest wifi is precisely what fails
during a pitch, and an officer's phone on a flyover has no signal at all.

Two caches, because the shell and the data answer different questions:

- **Shell — cache-first.** The app's own JS and CSS cannot change without a
  deploy, so disk is both correct and instant.
- **Data — network-first.** A measurement must be fresh when the network is
  there; when it is not, the last good response beats a broken page — *provided
  the interface says it is stale*, which is what the `X-PRAVAAH-Stale` header
  exists for. A stale figure presented as live is worse than no figure at all,
  and that is the same rule the polling layer already follows (ADR-031).

Three things are never cached, and each is a decision rather than an oversight:

- **Anything that is not a GET.** A decision recorded while offline must fail
  loudly rather than be replayed later into an append-only audit log, where it
  would carry a timestamp that never happened. An audit trail that can be
  written from a queue is not an audit trail.
- **`/api/v1/audit` and `/api/v1/enforcement`.** A shared phone holding a cached
  violation queue or audit trail is a data-at-rest exposure nobody signed off.
  docs/07 keeps P2 data off the device.
- **Cross-origin assets.** Caching them here would hide a supply-chain change
  behind our own storage.

The worker registers in production only. In development it caches the very files
that are meant to be hot-reloading, and `next dev` serves a different asset
graph than a build, so a worker trained on it would cache paths production does
not have.

---

## ADR-042 — One unsargable predicate cost 3.6 seconds
**Date:** 2026-08-18 · **Status:** Accepted

The console took **3.6 s to first byte**. All of it was one line, repeated four
times:

```sql
WHERE (tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::date = :on
```

Wrapping the indexed column in an expression makes the predicate unsargable.
Postgres must transform all 1.4 million rows before it can compare one, the
index is unusable, and TimescaleDB cannot exclude a single chunk. `/counts/
summary` runs three such queries, so it paid the full scan three times: 2.2 s
for one endpoint, and the server-rendered page waited on it.

Replaced with a half-open range on the raw column, bounds computed once per
request:

```sql
WHERE tc.bucket_start >= :day_start AND tc.bucket_start < :day_end
```

Half-open rather than `BETWEEN`, which includes both ends and would double-count
the midnight bucket.

| | before | after |
|---|---|---|
| `/counts/summary` | 2215 ms | **127 ms** |
| `/congestion/day-profile` | 215 ms | **8 ms** |
| page TTFB | 3599 ms | **526 ms** |
| first contentful paint | 3816 ms | **572 ms** |

Values verified identical before and after — 293,035 vehicles, 161,545.8 PCU,
peak 18:00 at 14,067.5 PCU. A fast wrong answer would have been worse than a
slow right one.

The subquery that found "the latest day" had the same fault in miniature:
`max(bucket_start AT TIME ZONE …)` cannot use the index, while `max(bucket_start)`
is an index scan. The conversion now happens once, in Python, on a single value.

**The rule:** never wrap an indexed column in a function on the left of a
comparison. Convert the *parameter* to the column's type and space, not the
column to the parameter's. The IST/UTC timezone care that ADR-012's seed work
established is right; it just belongs on the bind value.

---

## ADR-043 — The theme script goes through next/script
**Date:** 2026-08-18 · **Status:** Accepted · **Corrects:** ADR-036's note

A bare `<script>` rendered by a component made React 19 warn on every page —
"scripts inside React components are never executed when rendering on the
client" — and the warning was accurate: it ran in the server-rendered HTML but
not after a client navigation. That was the dev-overlay issue visible in the
corner of every screenshot.

An earlier comment in that file asserted `next/script`'s `beforeInteractive` was
"only valid in pages/_document". That was wrong; the bundled Next docs state it
must be placed in the **root layout** in the App Router, which
`[locale]/layout.tsx` is. Checking the version's own documentation rather than
trusting a recalled API was the whole fix.

---

## ADR-044 — Air quality is real and live, with no key
**Date:** 2026-08-18 · **Status:** Accepted

OpenAQ now gates registration behind an account, which left air quality stuck on
replay. Open-Meteo's air-quality API (CAMS) needs no key at all and returns
Jaipur PM2.5, PM10, NO2, O3 and US AQI. Live sources go from 2/7 to **3/7**.

It belongs in a *traffic* platform because the pollutants are the ones road
traffic produces: NO2 is overwhelmingly a combustion product, and PM is exhaust,
brake and tyre wear plus re-suspended road dust. That turns the LEZ case in
NEETI from an argument about road space into an argument about the air people
breathe — and the second is the one a health department acts on.

Two things it deliberately does not do. It does not call the reading a station
measurement: CAMS is a **modelled reanalysis**, real about Jaipur but not from a
Jaipur instrument, and `source_kind` says so. And it attributes **no share** of
the pollution to traffic — source apportionment needs data this platform does
not have, and a confident invented percentage is exactly what this project
refuses.

Exceedance is measured against **CPCB** 24-hour standards rather than WHO
guidelines, because a Jaipur official is accountable against CPCB and quoting a
standard they are not measured on is no use to them. A test pins that: 45 µg/m³
PM2.5 is over the WHO guideline and under CPCB's 60, and must not flag.

---

## ADR-045 — Published figures are code, and the seed is tested against them
**Date:** 2026-08-18 · **Status:** Accepted

`pravaah.adapters.published` holds the real, sourced figures the platform argues
from, separate from everything the seed generates. Jaipur police district crash
returns 2021-2025 and the TomTom Traffic Index, each with its URL.

Putting them in code rather than in a slide buys a tripwire: the test suite
asserts the **seeded warehouse still reproduces them**, so a regenerated demo
fails the build rather than drifting away from the evidence it claims to rest
on.

That tripwire immediately caught a real fault. The seed reproduced every
published *accident* count exactly — 3,205 / 3,935 / 3,893 / 3,881 / 3,664,
summing to 18,578 — but distributed deaths independently, and the result
**contradicted the platform's headline finding**: its 2024 fatality rate came
out at 35.4 against 34.6 in 2025, so severity appeared to *fall* where Jaipur
police report it rising. The one claim the whole safety layer rests on was
argued against by our own data.

`scripts/fix_crash_fatalities.py` aligns the toll to the published trajectory.
2024 deaths are not published, but they are **derivable** from two figures that
are — 2025 deaths (1,273) and the reported +3.1% rise — giving 1,235. That is
kept as `DEATHS_2024_DERIVED`, a separate constant, because derived and
published are different kinds of number and a reader deserves to know which they
are looking at.

The seed now shows the reversal in its own data: crashes 3,881 → 3,664 while the
fatality rate rises 31.82 → **34.74**, which is the published "34.7 per 100,
highest in five years".

When a death is removed the casualty is **not** removed — it moves to
`grievous`, because the person survived with a serious injury. Crashes with a
single death necessarily stop being fatal crashes, and that is the one part of
the distribution this cannot preserve; it is what a lower toll actually means.

---

## ADR-046 — Provenance is a screen, not a slide
**Date:** 2026-08-18 · **Status:** Accepted

"Is any of this real?" is the second question a government reviewer asks, right
after "does it work?" — and answering it in a slide answers it in the one place
they cannot check. The console now has a **Provenance** section that answers it
in the product:

- **Sources**, with the live ones actually live. 3 of 7. The other four say
  `replay` in plain text.
- **Datasets**, each tagged `real`, `calibrated to real`, or `generated`, with
  what it is calibrated against. Road network real from OpenStreetMap; crashes
  generated per record but reproducing Jaipur police annual returns exactly;
  counts generated against the four TomTom figures; violations and defaulter
  scores simply generated, and said so.
- **Published figures**, with the year table and links to both sources.

The table is deliberately unflattering. Four of seven sources are on replay, and
stating that plainly is what makes the three that are live believable. A
provenance screen that made everything look finished would be worth nothing.

The air-quality panel carries `real · live` as a badge, because it is currently
the only panel whose numbers are both — which makes it the proof that the
pipeline is wired rather than mocked.

**On the `beforeInteractive` lint warning:** `@next/next/no-before-interactive-script-outside-document`
predates the App Router and only knows about `pages/_document`. This version's
own docs say the strategy "must be placed inside the root layout", and
`[locale]/layout.tsx` is the root layout — it renders `<html>` and nothing sits
above it. Suppressed with that reasoning recorded, and only after checking in
the browser that the script genuinely runs: all three theme attributes land on
`<html>` and `--ink` resolves before paint.

---

## ADR-047 — Registered fleet against measured traffic
**Date:** 2026-08-18 · **Status:** Accepted

Rajasthan publishes its own vehicle population: 1,71,74,784 registered vehicles
as of 31 March 2022, 72.92% two-wheelers and 12.41% cars. Real, official, and
the second independent real source this platform can stand on.

Putting it beside the corridor's counts produces the strongest argument on the
platform, and one **no single dataset can make**:

| class | registered | on the road | road space | ratio |
|---|---|---|---|---|
| Two-wheelers | 72.92% | 61.06% | 27.69% | 0.84× |
| Cars | 12.41% | 24.06% | 43.64% | **1.94×** |
| Three-wheelers | 1.32% | 6.20% | 5.62% | **4.71×** |
| Trucks | 3.73% | 0.98% | 5.34% | 0.26× |

Registration alone says two-wheelers dominate. Counting alone says they are a
majority. Only the two together show that the road carries a **different city
from the one the registration database describes**: a car is roughly twice
over-represented on an arterial relative to how many exist, and over-represented
again in the space it takes. Autos are nearly five times over-represented, which
is what a commercial vehicle working all day looks like against a private one
parked most of it.

Three things done deliberately:

- **The caveat ships in the response**, not in a footnote. Registration is
  state-wide and traffic is one Jaipur arterial, so this compares a fleet with a
  corridor — informative about over-representation, not a substitute for an
  origin-destination survey.
- **Classes with no arterial presence are dropped**, not shown as zeroes.
  Tractors are 6.9% of the state fleet and belong on a rural road; that is not a
  finding about Tonk Road.
- **Registration categories with no counting equivalent map to `None`.** A
  trailer is not something a camera counts as a distinct vehicle. Forcing it a
  class code to make the join tidy would be inventing a measurement, and a test
  pins the unmapped set.

The panel is badged `part real` rather than `real` or `simulated`, because it is
genuinely both: one axis published by the state, the other seeded and calibrated.

---

## ADR-048 — KAVACH, and a model that honestly reported itself useless
**Date:** 2026-08-18 · **Status:** Accepted

The four ML packages were empty stubs and `segment_risk` had zero rows, while
the product referenced it. KAVACH is now real: gradient-boosted trees over
twelve interpretable features, SHAP attribution on every score, 594 segments
written with banded risk and actionable countermeasures.

Three decisions carried the work.

**It predicts severity, not frequency, and exposure is not a feature.** docs/01
§2 is the reason: Jaipur crashes fell 5.6% while deaths rose 3.1%. A department
ranking black spots by crash count spends its budget on the busiest junctions; a
department ranking by how likely a crash is to kill spends it where people die.
Including traffic volume would smuggle frequency back in and rebuild the ranking
we are trying to avoid.

**The first run scored ROC-AUC 0.491 — pure chance — and the script said so.**
That was not a modelling failure but the pipeline working: the seed had assigned
fatal and grievous outcomes independently of light, cause, road-user type and
geometry, so no relationship existed to learn. The script prints holdout metrics
**against base rate** precisely to catch this. On a dataset where 78% of crashes
were severe, "78% accuracy" would have shipped a do-nothing model.

`scripts/apply_severity_relationships.py` then re-drew which crashes are fatal
using relative odds derived from **MoRTH's published national shares** — two-
wheelers 44.5% of deaths, pedestrians 19.5%, over-speeding 72.3% of accidents
but 71.2% of deaths. That last pair is the interesting one and shaped the
weights: speeding causes an enormous *number* of crashes without making an
individual crash much more likely to kill, so its multiplier is ~1.0. A model
that gave speeding a large severity effect would be reading volume as risk.

Retrained: **ROC-AUC 0.673, PR-AUC 0.537 against a 0.337 base rate**, and the
SHAP factors name pedestrian, heavy-vehicle and two-wheeler involvement — the
relationships MoRTH publishes.

**The circularity is real and is stated wherever the model appears.** KAVACH is
now recovering a relationship a script put in. That demonstrates the pipeline
finds a signal when one exists; it is *not* evidence about Jaipur. Only
per-crash data from the department can be that, and `is_synthetic` stays true.

**Bands are multiples of the base rate, not absolute probabilities.** Fixed
floors of 0.85/0.70/0.50 put all 594 segments in "low" under a fatality target
(base 0.34) and would have put all 594 in "critical" under the injury target
(base 0.86) — the same numbers giving opposite, equally useless answers. A
multiple says what an engineer needs: this segment kills more often than a
Jaipur crash normally does, by this much. `band_for` requires the base rate
rather than defaulting it, so the bug cannot recur silently.

Two smaller things the tests pin: a protective factor survives into the
explanation rather than being filtered for being negative ("dangerous despite a
median" is a finding), and countermeasures are proposed only for factors that
*raise* risk — suggesting median treatment where the median is holding the
score down wastes a budget line.

---

## ADR-049 — Deployment blueprints, and what they deliberately omit
**Date:** 2026-08-18 · **Status:** Accepted

`render.yaml` and `apps/web/vercel.json`, matching the deployment named in the
original brief.

**The database is deliberately not declared.** It lives on Tiger Cloud
(Postgres + TimescaleDB + PostGIS + pgvector), which Render cannot provision. A
blueprint that quietly created a plain Render Postgres would deploy a console
connected to an empty database — a convincing failure, which is the worst kind.

**Every secret is `sync: false`**, so Render prompts at deploy and nothing lands
in the file. The repository is public and that is not a detail to get right
later.

`DEMO_MODE` is pinned `false` in production, where the API's lifespan handler
already refuses to start if it is true. The service failing to boot is the
correct behaviour: a demo role switcher surviving into production is an
authentication bypass, not a convenience, and this is the third independent
place that is enforced.

A nightly cron retrains KAVACH at 02:00 IST, after the day's counts have
settled. Region `singapore` for the API and `bom1` for the frontend — closest
to Jaipur, and worth roughly 40 ms against a European region on every request.

Vercel carries the security headers the API already sets, plus a
`Permissions-Policy` denying camera, microphone and geolocation. The citizen
view asks for no location by design (ADR-037); denying it at the header level
means a future dependency cannot quietly start asking.
