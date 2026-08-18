# 05 — Data Contracts, Schema & APIs

Single source of truth: `packages/contracts`. Pydantic v2 models are authored once and TypeScript types are generated from them. Never hand-maintain parallel definitions.

---

## 1. Database schema (PostgreSQL 16 + TimescaleDB + PostGIS + pgvector)

### Reference tables

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- Road network (from JDA inventory / OSM, PostGIS)
CREATE TABLE road_links (
  link_id          BIGSERIAL PRIMARY KEY,
  osm_id           BIGINT,
  name_en          TEXT NOT NULL,
  name_hi          TEXT NOT NULL,
  corridor_id      BIGINT REFERENCES corridors(corridor_id),
  geom             GEOMETRY(LineString, 4326) NOT NULL,
  length_m         NUMERIC(10,2) NOT NULL,
  lanes            SMALLINT,
  carriageway      TEXT CHECK (carriageway IN ('divided','undivided','one_way')),
  design_capacity_pcu_hr NUMERIC(10,2),   -- IRC-derived
  free_flow_speed_kmh    NUMERIC(5,2),
  has_median       BOOLEAN DEFAULT FALSE,
  surface_quality  SMALLINT CHECK (surface_quality BETWEEN 1 AND 5),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_road_links_geom ON road_links USING GIST(geom);

CREATE TABLE corridors (
  corridor_id  BIGSERIAL PRIMARY KEY,
  name_en      TEXT NOT NULL,           -- 'Tonk Road Model Corridor'
  name_hi      TEXT NOT NULL,
  from_node    TEXT, to_node TEXT,      -- 'Yaadgaar' -> 'Sanganer'
  is_model_corridor BOOLEAN DEFAULT FALSE
);

CREATE TABLE junctions (
  junction_id  BIGSERIAL PRIMARY KEY,
  name_en TEXT NOT NULL, name_hi TEXT NOT NULL,
  geom GEOMETRY(Point,4326) NOT NULL,
  approach_count SMALLINT,
  signal_type TEXT CHECK (signal_type IN ('fixed','atcs','manual','uncontrolled','free_left')),
  atcs_enabled BOOLEAN DEFAULT FALSE
);

-- Camera registry, with the accuracy certificate attached
CREATE TABLE cameras (
  camera_id        BIGSERIAL PRIMARY KEY,
  external_ref     TEXT,                -- Abhay / ICCC identifier
  source_system    TEXT CHECK (source_system IN ('abhay','iccc','jda','drone','survey','replay')),
  junction_id      BIGINT REFERENCES junctions(junction_id),
  link_id          BIGINT REFERENCES road_links(link_id),
  geom             GEOMETRY(Point,4326),
  bearing_deg      NUMERIC(5,2),
  homography       JSONB,               -- 3x3 matrix + reference points
  calibrated_at    TIMESTAMPTZ,
  roi_polygons     JSONB,               -- count lines + zones
  status           TEXT DEFAULT 'active',
  accuracy_cert    JSONB                -- {day_mape, night_mape, per_class, validated_on}
);

CREATE TABLE vehicle_classes (
  class_code TEXT PRIMARY KEY,          -- '2W','AUTO','ERIK','CAR','TAXI','LCV','BUS','MBUS','TRK2','TRKM','TRAC','NMV'
  name_en TEXT, name_hi TEXT,
  pcu_factor NUMERIC(4,2) NOT NULL,
  is_heavy BOOLEAN DEFAULT FALSE,
  is_commercial BOOLEAN DEFAULT FALSE
);
```

### Time-series hypertables

```sql
-- The core measurement table. Everything downstream reads from here.
CREATE TABLE traffic_counts (
  bucket_start   TIMESTAMPTZ NOT NULL,
  camera_id      BIGINT NOT NULL REFERENCES cameras(camera_id),
  link_id        BIGINT REFERENCES road_links(link_id),
  direction      TEXT NOT NULL,          -- 'NB','SB','EB','WB'
  class_code     TEXT NOT NULL REFERENCES vehicle_classes(class_code),
  vehicle_count  INTEGER NOT NULL,
  pcu            NUMERIC(10,2) NOT NULL,
  mean_speed_kmh NUMERIC(5,2),
  p85_speed_kmh  NUMERIC(5,2),
  speed_stddev   NUMERIC(5,2),
  mean_headway_s NUMERIC(6,2),
  occupancy_pct  NUMERIC(5,2),
  queue_length_m NUMERIC(7,2),
  quality_score  NUMERIC(3,2) NOT NULL,  -- 0..1, drives suppression
  quality_flags  TEXT[],                 -- {'low_light','rain','occlusion','uncalibrated'}
  PRIMARY KEY (bucket_start, camera_id, direction, class_code)
);
SELECT create_hypertable('traffic_counts','bucket_start', chunk_time_interval => INTERVAL '1 day');

-- Turning movements at junctions
CREATE TABLE turning_movements (
  bucket_start TIMESTAMPTZ NOT NULL,
  junction_id  BIGINT NOT NULL,
  approach     TEXT NOT NULL,
  exit_leg     TEXT NOT NULL,
  class_code   TEXT NOT NULL,
  vehicle_count INTEGER NOT NULL,
  pcu NUMERIC(10,2) NOT NULL,
  quality_score NUMERIC(3,2) NOT NULL,
  PRIMARY KEY (bucket_start, junction_id, approach, exit_leg, class_code)
);
SELECT create_hypertable('turning_movements','bucket_start');

CREATE TABLE link_congestion (
  bucket_start TIMESTAMPTZ NOT NULL,
  link_id BIGINT NOT NULL,
  congestion_index NUMERIC(5,2) NOT NULL,   -- 0..100, published formula
  vc_ratio NUMERIC(5,3),
  speed_ratio NUMERIC(5,3),
  queue_persistence NUMERIC(5,3),
  probe_delay_s NUMERIC(8,2),
  source_mix TEXT[],                         -- {'camera','probe','estimated'}
  confidence NUMERIC(3,2) NOT NULL,
  PRIMARY KEY (bucket_start, link_id)
);
SELECT create_hypertable('link_congestion','bucket_start');

CREATE TABLE forecasts (
  issued_at TIMESTAMPTZ NOT NULL,
  link_id BIGINT NOT NULL,
  horizon_min SMALLINT NOT NULL CHECK (horizon_min IN (15,30,60)),
  predicted_index NUMERIC(5,2) NOT NULL,
  lower_80 NUMERIC(5,2), upper_80 NUMERIC(5,2),
  model_version TEXT NOT NULL,
  PRIMARY KEY (issued_at, link_id, horizon_min)
);
SELECT create_hypertable('forecasts','issued_at');
```

### Continuous aggregates

```sql
CREATE MATERIALIZED VIEW traffic_counts_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', bucket_start) AS hour,
       link_id, direction, class_code,
       SUM(vehicle_count) AS vehicle_count,
       SUM(pcu) AS pcu,
       AVG(mean_speed_kmh) AS mean_speed_kmh,
       MIN(quality_score) AS min_quality
FROM traffic_counts
WHERE quality_score >= 0.6            -- suppress unreliable bins from policy outputs
GROUP BY hour, link_id, direction, class_code;

SELECT add_continuous_aggregate_policy('traffic_counts_hourly',
  start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes');

SELECT add_retention_policy('traffic_counts', INTERVAL '3 years');
SELECT add_compression_policy('traffic_counts', INTERVAL '7 days');
```

### Incident, safety and enforcement

```sql
CREATE TABLE incidents (
  incident_id BIGSERIAL PRIMARY KEY,
  detected_at TIMESTAMPTZ NOT NULL,
  link_id BIGINT, geom GEOMETRY(Point,4326),
  incident_type TEXT CHECK (incident_type IN ('crash','breakdown','congestion_anomaly','obstruction','waterlogging','event')),
  severity TEXT CHECK (severity IN ('low','medium','high','critical')),
  detection_source TEXT,                -- 'model','dial100','citizen','officer'
  model_confidence NUMERIC(3,2),
  verified_by TEXT, verified_at TIMESTAMPTZ,
  false_positive BOOLEAN,               -- fed back into training
  resolved_at TIMESTAMPTZ
);

CREATE TABLE crashes (
  crash_id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  link_id BIGINT, geom GEOMETRY(Point,4326),
  fir_ref TEXT,
  fatalities SMALLINT DEFAULT 0,
  grievous SMALLINT DEFAULT 0,
  minor SMALLINT DEFAULT 0,
  vehicle_classes_involved TEXT[],
  primary_cause TEXT,
  light_condition TEXT, weather TEXT,
  source TEXT DEFAULT 'police'
);

CREATE TABLE segment_risk (
  computed_on DATE NOT NULL,
  link_id BIGINT NOT NULL,
  severity_risk NUMERIC(4,3) NOT NULL,   -- calibrated probability
  risk_band TEXT CHECK (risk_band IN ('low','moderate','high','critical')),
  top_factors JSONB NOT NULL,            -- SHAP top-3 with values
  recommended_countermeasures TEXT[],
  model_version TEXT NOT NULL,
  PRIMARY KEY (computed_on, link_id)
);

-- Enforcement. Plate is encrypted; see doc 07.
CREATE TABLE violations (
  violation_id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  camera_id BIGINT, link_id BIGINT,
  violation_type TEXT NOT NULL,          -- 'red_light','speed','no_helmet','triple_riding','wrong_side','no_seatbelt','lane'
  plate_hash TEXT NOT NULL,              -- salted hash, joinable
  plate_encrypted BYTEA,                 -- envelope-encrypted, separate key
  ocr_confidence NUMERIC(3,2) NOT NULL,
  evidence_uri TEXT,                     -- MinIO, presigned on authorised access only
  review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending','confirmed','rejected','auto_confirmed')),
  reviewed_by TEXT, reviewed_at TIMESTAMPTZ,
  challan_ref TEXT
);
CREATE INDEX idx_violations_plate ON violations(plate_hash);

CREATE TABLE defaulter_scores (
  computed_on DATE NOT NULL,
  plate_hash TEXT NOT NULL,
  repeat_risk NUMERIC(4,3) NOT NULL,
  recovery_propensity NUMERIC(4,3),
  severity_weighted_score NUMERIC(6,2),
  pending_challan_count INTEGER,
  pending_amount_inr NUMERIC(12,2),
  shap_explanation JSONB NOT NULL,       -- mandatory, no unexplained scores
  model_version TEXT NOT NULL,
  PRIMARY KEY (computed_on, plate_hash)
);
```

### Governance tables

```sql
-- Immutable. Append-only. No UPDATE, no DELETE grant to any app role.
CREATE TABLE audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,                  -- 'view_plate','unmask_identity','export','run_scenario'
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  reason_code TEXT,                      -- required for sensitive actions
  ip_address INET,
  request_id UUID
);
SELECT create_hypertable('audit_log','occurred_at');

CREATE TABLE policy_documents (
  doc_id BIGSERIAL PRIMARY KEY,
  title_en TEXT, title_hi TEXT,
  doc_type TEXT,                         -- 'irc_code','mv_act','circular','dpr','notification'
  issued_by TEXT, issued_on DATE,
  content TEXT NOT NULL,
  language TEXT CHECK (language IN ('en','hi','mixed')),
  embedding vector(1024)
);
CREATE INDEX idx_policy_embedding ON policy_documents
  USING hnsw (embedding vector_cosine_ops);
```

---

## 2. Event schemas (Redpanda)

Topics are versioned in the name. Never mutate a schema in place — publish `.v2` and dual-write.

| Topic | Producer | Key | Retention |
|---|---|---|---|
| `ganana.counts.v1` | Edge | `camera_id` | 7 days |
| `ganana.turning.v1` | Edge | `junction_id` | 7 days |
| `ganana.violations.v1` | Edge | `camera_id` | 30 days |
| `drishti.congestion.v1` | Core | `link_id` | 7 days |
| `drishti.incidents.v1` | Core | `link_id` | 30 days |
| `drishti.forecasts.v1` | Core | `link_id` | 3 days |
| `system.alerts.v1` | Any | `alert_type` | 30 days |
| `system.audit.v1` | Any | `actor_id` | 90 days → cold |

```python
# packages/contracts/events.py
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime
from typing import Literal

Direction = Literal["NB", "SB", "EB", "WB"]


class ClassCount(BaseModel):
    class_code: str
    vehicle_count: int = Field(ge=0)
    pcu: float = Field(ge=0)
    mean_speed_kmh: float | None = None
    p85_speed_kmh: float | None = None


class CountEvent(BaseModel):
    """Emitted by an edge node once per 5-minute bin per camera per direction."""

    model_config = ConfigDict(frozen=True)
    schema_version: Literal["1.0"] = "1.0"
    event_id: str
    camera_id: int
    link_id: int | None
    bucket_start: datetime
    bucket_seconds: int = 300
    direction: Direction
    counts: list[ClassCount]
    total_pcu: float
    occupancy_pct: float | None = None
    queue_length_m: float | None = None
    quality_score: float = Field(ge=0, le=1)
    quality_flags: list[str] = []
    model_version: str
    edge_node_id: str
    emitted_at: datetime


class ViolationEvent(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    event_id: str
    camera_id: int
    occurred_at: datetime
    violation_type: str
    plate_hash: str  # NEVER the raw plate on the bus
    ocr_confidence: float = Field(ge=0, le=1)
    detection_confidence: float = Field(ge=0, le=1)
    evidence_uri: str
    requires_review: bool  # True whenever ocr_confidence < 0.85
    model_version: str
```

**Bus rule:** raw plate strings never travel on Redpanda. The edge encrypts the plate, writes the ciphertext directly to the database over TLS, and puts only the salted hash on the bus. This limits blast radius if the broker is ever compromised.

---

## 3. REST API

Base: `/api/v1`. Auth: OIDC bearer (Keycloak). All list endpoints paginate. All responses carry `data_quality` where measurements are involved.

### Counting

```
GET  /counts
     ?link_id= | camera_id= | corridor_id=
     &from=ISO8601&to=ISO8601
     &granularity=5m|1h|1d
     &class_code=      (repeatable)
     &direction=
     &min_quality=0.6  (default)
→ 200 {
    data: [{ bucket_start, link_id, direction, class_code,
             vehicle_count, pcu, mean_speed_kmh, quality_score }],
    meta: { total, suppressed_bins, coverage_pct, sources: ["camera"] }
  }

GET  /counts/summary?corridor_id=&date=
→ { total_vehicles, total_pcu, class_split: {...},
    peak_hour: { start, pcu }, vs_baseline_pct, data_quality }

GET  /junctions/{id}/turning-movements?from=&to=
→ { matrix: { "N": {"S":..,"E":..,"W":..}, ... }, unit: "pcu"|"vehicles" }
```

### Network intelligence

```
GET  /congestion/live                     → per-link current index, GeoJSON-ready
GET  /congestion/history?link_id=&from=&to=
GET  /forecast?link_id=&horizon=15|30|60  → { predicted_index, lower_80, upper_80, model_version }
GET  /incidents?status=active
POST /incidents/{id}/verify               → body { verified: bool, note }
GET  /risk/segments?band=high             → severity risk + SHAP factors + countermeasures
```

### Simulation

```
POST /scenarios
  body {
    corridor_id, name_en, name_hi,
    interventions: [
      { type: "signal_plan", junction_id, cycle_s, splits: {...} },
      { type: "median_closure", link_id, chainage_m },
      { type: "freight_window", link_id, banned_hours: [[7,11],[17,21]] },
      { type: "lane_reallocation", link_id, from_mode, to_mode, lanes }
    ],
    baseline_period: { from, to }
  }
→ 202 { scenario_id, status: "queued" }

GET /scenarios/{id}
→ { status, results: {
      delay_change_pct, delay_ci_80, throughput_change_pct,
      avg_speed_change_kmh, queue_change_m,
      emissions_change_pct, affected_links: [...],
      calibration_error_pct,        // MUST be shown alongside every result
      confidence: "high"|"medium"|"low"
    }}
```

### Enforcement (restricted role)

```
GET  /defaulters?band=high&limit=50
→ { data: [{ plate_masked: "RJ14••••34", plate_hash,
             repeat_risk, recovery_propensity, severity_weighted_score,
             pending_count, pending_amount_inr,
             explanation: [{feature, shap_value, direction}] }],
    fairness: { zone_distribution, class_distribution, concentration_index } }

POST /defaulters/{plate_hash}/unmask
  body { reason_code, case_ref }        // reason_code REQUIRED
→ 200 { plate }  + audit_log entry written before response

POST /enforcement/interception-plan
  body { officer_count, shift_start, shift_end, corridor_id }
→ { checkpoints: [{ link_id, geom, window, expected_contacts,
                    expected_severity_reduction }] }
```

### NEETI

```
POST /neeti/ask
  body { question, language: "hi"|"en"|"auto", context: { corridor_id?, date_range? } }
→ { answer, language,
    citations: [{ type:"data"|"document", ref, snippet }],
    sql_executed: [...],        // shown on request, always logged
    charts: [...],
    verified_numerals: true }   // false blocks rendering client-side

POST /neeti/report
  body { report_type: "junction"|"corridor"|"before_after"|"cabinet_note",
         target_id, period, language }
→ 202 { job_id } → GET /neeti/report/{job_id} → { pdf_uri, docx_uri }
```

### WebSocket

```
WS /ws/live
  → subscribe { channels: ["congestion","alerts","counts"], corridor_id }
  ← { channel, payload, ts }
Heartbeat 30s. Auto-reconnect with exponential backoff on the client.
```

---

## 4. Adapter interfaces

Every government integration implements one of these, with a replay implementation first.

```python
# packages/adapters/base.py
from typing import Protocol, AsyncIterator


class VideoSource(Protocol):
    async def frames(self, camera_id: int) -> AsyncIterator[Frame]: ...
    async def health(self) -> SourceHealth: ...


class VahanAdapter(Protocol):
    async def lookup(self, plate: str) -> VehicleRecord | None: ...

    # Replay impl reads a seeded CSV. Live impl calls the state API.
    # NOTE: any live impl must satisfy DPDP consent/purpose limits — see doc 07.


class ChallanAdapter(Protocol):
    async def pending_for(self, plate_hash: str) -> list[Challan]: ...
    async def issue(self, violation_id: int) -> ChallanRef: ...


class ProbeDataAdapter(Protocol):
    async def link_speeds(self, link_ids: list[int]) -> dict[int, SpeedSample]: ...
```

**Demo default:** `PRAVAAH_SOURCE_MODE=replay` in `.env`. Every adapter resolves to its file-backed implementation. `docker compose up` then works with the network cable pulled.

---

## 5. Seed data for the demo

Ship these in `data/seeds/` so the demo is reproducible on any machine:

- Tonk Road corridor (Yaadgaar → Sanganer) as a PostGIS linestring set with 8 junctions — this is the state's own declared Model Traffic Corridor, so using it signals you read their plan
- 6 simulated camera registrations with realistic homographies and accuracy certificates
- 90 days of synthetic-but-plausible counts, generated from real TomTom-derived Jaipur diurnal profiles (58.7% average congestion; morning peak 73.9%; evening peak 94.9%; rush-hour speed 17.5 km/h) so the shapes are honest even though the counts are synthetic
- A 5-year crash series matching the published Jaipur totals (3,205/1,106 → 3,664/1,273)
- 500 synthetic defaulter records with a deliberately realistic long-tail distribution
- 40 policy documents: IRC extracts, MV Act sections, sample state circulars

**Every synthetic record carries `is_synthetic = true`, and the UI renders a persistent "Simulated data" badge whenever any displayed figure derives from one.** Non-negotiable. A government evaluator who later discovers unlabelled synthetic data in a demo will never trust anything else you show them.
