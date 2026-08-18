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
