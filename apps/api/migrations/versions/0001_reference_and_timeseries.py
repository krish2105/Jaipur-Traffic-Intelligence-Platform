"""Reference tables, measurement hypertables and continuous aggregates.

Implements docs/05 §1. Two deliberate additions to the DDL as written there:

* `is_synthetic` on every measurement table. docs/05 §5 requires every synthetic
  record to carry the flag and the UI to badge it, but the DDL in §1 omits the
  column. Without it the requirement is unenforceable.
* `corridors` is created before `road_links`, which references it. The doc lists
  them the other way round.

Revision ID: 0001
Revises:
"""

from __future__ import annotations

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # ── reference ────────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE corridors (
          corridor_id       BIGSERIAL PRIMARY KEY,
          name_en           TEXT NOT NULL,
          name_hi           TEXT NOT NULL,
          from_node         TEXT,
          to_node           TEXT,
          is_model_corridor BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)
    op.execute("""
        COMMENT ON TABLE corridors IS
        'Tonk Road (Yaadgaar to Sanganer) is the state''s own declared Model
         Traffic Corridor from the April 2026 reform plan — docs/01 §3.'
    """)

    op.execute("""
        CREATE TABLE road_links (
          link_id                BIGSERIAL PRIMARY KEY,
          osm_id                 BIGINT,
          name_en                TEXT NOT NULL,
          name_hi                TEXT NOT NULL,
          corridor_id            BIGINT REFERENCES corridors(corridor_id),
          geom                   GEOMETRY(LineString, 4326) NOT NULL,
          length_m               NUMERIC(10,2) NOT NULL,
          lanes                  SMALLINT,
          carriageway            TEXT CHECK (carriageway IN ('divided','undivided','one_way')),
          design_capacity_pcu_hr NUMERIC(10,2),
          free_flow_speed_kmh    NUMERIC(5,2),
          has_median             BOOLEAN NOT NULL DEFAULT FALSE,
          surface_quality        SMALLINT CHECK (surface_quality BETWEEN 1 AND 5),
          updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX idx_road_links_geom ON road_links USING GIST(geom)")
    op.execute("CREATE INDEX idx_road_links_corridor ON road_links(corridor_id)")
    # Place names resolve through the database, never through translation files,
    # so 'Tonk Road' and the Devanagari form map to one link_id (docs/06 §5).
    op.execute(
        "CREATE INDEX idx_road_links_name_en_trgm ON road_links USING GIN(name_en gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX idx_road_links_name_hi_trgm ON road_links USING GIN(name_hi gin_trgm_ops)"
    )

    op.execute("""
        CREATE TABLE junctions (
          junction_id    BIGSERIAL PRIMARY KEY,
          name_en        TEXT NOT NULL,
          name_hi        TEXT NOT NULL,
          corridor_id    BIGINT REFERENCES corridors(corridor_id),
          geom           GEOMETRY(Point, 4326) NOT NULL,
          approach_count SMALLINT,
          signal_type    TEXT CHECK (signal_type IN
                           ('fixed','atcs','manual','uncontrolled','free_left')),
          atcs_enabled   BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)
    op.execute("CREATE INDEX idx_junctions_geom ON junctions USING GIST(geom)")

    op.execute("""
        CREATE TABLE vehicle_classes (
          class_code    TEXT PRIMARY KEY,
          name_en       TEXT NOT NULL,
          name_hi       TEXT NOT NULL,
          pcu_factor    NUMERIC(4,2) NOT NULL,
          is_heavy      BOOLEAN NOT NULL DEFAULT FALSE,
          is_commercial BOOLEAN NOT NULL DEFAULT FALSE,
          sort_order    SMALLINT NOT NULL DEFAULT 0
        )
    """)

    op.execute("""
        CREATE TABLE cameras (
          camera_id     BIGSERIAL PRIMARY KEY,
          external_ref  TEXT,
          source_system TEXT NOT NULL CHECK (source_system IN
                          ('abhay','iccc','jda','drone','survey','replay','public_dataset')),
          junction_id   BIGINT REFERENCES junctions(junction_id),
          link_id       BIGINT REFERENCES road_links(link_id),
          geom          GEOMETRY(Point, 4326),
          bearing_deg   NUMERIC(5,2),
          homography    JSONB,
          calibrated_at TIMESTAMPTZ,
          roi_polygons  JSONB,
          status        TEXT NOT NULL DEFAULT 'active',
          accuracy_cert JSONB,
          is_synthetic  BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)
    # docs/03 §3: homography calibration is mandatory. Pixel-space speed is
    # worthless and will be torn apart by any traffic engineer in the room.
    op.execute("""
        ALTER TABLE cameras ADD CONSTRAINT calibrated_cameras_have_homography
        CHECK (calibrated_at IS NULL OR homography IS NOT NULL)
    """)

    # ── measurement ──────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE traffic_counts (
          bucket_start   TIMESTAMPTZ NOT NULL,
          camera_id      BIGINT      NOT NULL REFERENCES cameras(camera_id),
          link_id        BIGINT      REFERENCES road_links(link_id),
          direction      TEXT        NOT NULL CHECK (direction IN ('NB','SB','EB','WB')),
          class_code     TEXT        NOT NULL REFERENCES vehicle_classes(class_code),
          vehicle_count  INTEGER     NOT NULL CHECK (vehicle_count >= 0),
          pcu            NUMERIC(10,2) NOT NULL CHECK (pcu >= 0),
          mean_speed_kmh NUMERIC(5,2),
          p85_speed_kmh  NUMERIC(5,2),
          speed_stddev   NUMERIC(5,2),
          mean_headway_s NUMERIC(6,2),
          occupancy_pct  NUMERIC(5,2),
          queue_length_m NUMERIC(7,2),
          quality_score  NUMERIC(3,2) NOT NULL CHECK (quality_score BETWEEN 0 AND 1),
          quality_flags  TEXT[]      NOT NULL DEFAULT '{}',
          is_synthetic   BOOLEAN     NOT NULL DEFAULT FALSE,
          PRIMARY KEY (bucket_start, camera_id, direction, class_code)
        )
    """)
    op.execute(
        "SELECT create_hypertable('traffic_counts','bucket_start',"
        " chunk_time_interval => INTERVAL '1 day')"
    )
    op.execute("CREATE INDEX idx_traffic_counts_link ON traffic_counts(link_id, bucket_start DESC)")

    op.execute("""
        CREATE TABLE turning_movements (
          bucket_start  TIMESTAMPTZ NOT NULL,
          junction_id   BIGINT NOT NULL REFERENCES junctions(junction_id),
          approach      TEXT NOT NULL,
          exit_leg      TEXT NOT NULL,
          class_code    TEXT NOT NULL REFERENCES vehicle_classes(class_code),
          vehicle_count INTEGER NOT NULL CHECK (vehicle_count >= 0),
          pcu           NUMERIC(10,2) NOT NULL,
          quality_score NUMERIC(3,2) NOT NULL CHECK (quality_score BETWEEN 0 AND 1),
          is_synthetic  BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY (bucket_start, junction_id, approach, exit_leg, class_code)
        )
    """)
    op.execute("SELECT create_hypertable('turning_movements','bucket_start')")

    op.execute("""
        CREATE TABLE link_congestion (
          bucket_start      TIMESTAMPTZ NOT NULL,
          link_id           BIGINT NOT NULL REFERENCES road_links(link_id),
          congestion_index  NUMERIC(5,2) NOT NULL CHECK (congestion_index BETWEEN 0 AND 100),
          vc_ratio          NUMERIC(5,3),
          speed_ratio       NUMERIC(5,3),
          queue_persistence NUMERIC(5,3),
          probe_delay_s     NUMERIC(8,2),
          source_mix        TEXT[] NOT NULL DEFAULT '{}',
          confidence        NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
          is_synthetic      BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY (bucket_start, link_id)
        )
    """)
    op.execute("SELECT create_hypertable('link_congestion','bucket_start')")

    op.execute("""
        CREATE TABLE forecasts (
          issued_at       TIMESTAMPTZ NOT NULL,
          link_id         BIGINT NOT NULL REFERENCES road_links(link_id),
          horizon_min     SMALLINT NOT NULL CHECK (horizon_min IN (15,30,60)),
          predicted_index NUMERIC(5,2) NOT NULL CHECK (predicted_index BETWEEN 0 AND 100),
          lower_80        NUMERIC(5,2) NOT NULL,
          upper_80        NUMERIC(5,2) NOT NULL,
          model_version   TEXT NOT NULL,
          PRIMARY KEY (issued_at, link_id, horizon_min),
          -- docs/04 §5: a forecast without uncertainty is not decision-support.
          CONSTRAINT interval_contains_point
            CHECK (lower_80 <= predicted_index AND predicted_index <= upper_80)
        )
    """)
    op.execute("SELECT create_hypertable('forecasts','issued_at')")

    # ── continuous aggregates ────────────────────────────────────────────────
    # The quality filter is the point: bins below 0.6 are suppressed from policy
    # outputs. The suppression is surfaced in the UI, never hidden (docs/03 §3).
    op.execute("""
        CREATE MATERIALIZED VIEW traffic_counts_hourly
        WITH (timescaledb.continuous) AS
        SELECT time_bucket('1 hour', bucket_start) AS hour,
               link_id, direction, class_code,
               SUM(vehicle_count) AS vehicle_count,
               SUM(pcu)           AS pcu,
               AVG(mean_speed_kmh) AS mean_speed_kmh,
               MIN(quality_score)  AS min_quality,
               bool_or(is_synthetic) AS has_synthetic
        FROM traffic_counts
        WHERE quality_score >= 0.6
        GROUP BY hour, link_id, direction, class_code
        WITH NO DATA
    """)
    op.execute("""
        SELECT add_continuous_aggregate_policy('traffic_counts_hourly',
          start_offset => INTERVAL '3 days',
          end_offset   => INTERVAL '1 hour',
          schedule_interval => INTERVAL '30 minutes')
    """)

    # docs/03 §7 retention. ADR-010: compression is also what keeps the seeded
    # 90 days inside Tiger Cloud's 750 MB free-plan ceiling.
    op.execute("SELECT add_retention_policy('traffic_counts', INTERVAL '3 years')")
    op.execute(
        "ALTER TABLE traffic_counts SET ("
        " timescaledb.compress,"
        " timescaledb.compress_segmentby = 'camera_id, direction, class_code')"
    )
    op.execute("SELECT add_compression_policy('traffic_counts', INTERVAL '7 days')")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS traffic_counts_hourly CASCADE")
    for table in (
        "forecasts",
        "link_congestion",
        "turning_movements",
        "traffic_counts",
        "cameras",
        "vehicle_classes",
        "junctions",
        "road_links",
        "corridors",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
