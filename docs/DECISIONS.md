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

### Open
Day mode at 1920 renders a blank 3D pane. Night at 1920 renders, and both modes
render at 1440 and at phone width. WebGL context is healthy, no GL error, the
canvas is correctly sized, and the frame-budget guard floors at 0.25 and gates
only vehicles — so none of those is the cause and the real one is not yet known.
Recorded rather than guessed at, because ADR-020's lesson was exactly this:
investigating a second hypothesis against an undiagnosed first one wastes both.

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
