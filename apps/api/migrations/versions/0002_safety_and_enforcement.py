"""Incidents, crashes, severity risk, violations and defaulter scores.

Implements docs/05 §1 "Incident, safety and enforcement". This is the part of
the schema that carries reputational risk, so the constraints encode the
governance rules rather than leaving them to application code:

* a violation below the OCR confidence gate cannot sit in a confirmed state;
* a defaulter score cannot exist without its SHAP explanation;
* the raw plate is never stored — only a salted hash and envelope ciphertext.

Revision ID: 0002
Revises: 0001
"""

from __future__ import annotations

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE incidents (
          incident_id      BIGSERIAL PRIMARY KEY,
          detected_at      TIMESTAMPTZ NOT NULL,
          link_id          BIGINT REFERENCES road_links(link_id),
          geom             GEOMETRY(Point, 4326),
          incident_type    TEXT NOT NULL CHECK (incident_type IN
                             ('crash','breakdown','congestion_anomaly','obstruction',
                              'waterlogging','event')),
          severity         TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
          detection_source TEXT NOT NULL CHECK (detection_source IN
                             ('model','dial100','citizen','officer')),
          model_confidence NUMERIC(3,2) CHECK (model_confidence BETWEEN 0 AND 1),
          verified_by      TEXT,
          verified_at      TIMESTAMPTZ,
          false_positive   BOOLEAN,
          resolved_at      TIMESTAMPTZ,
          is_synthetic     BOOLEAN NOT NULL DEFAULT FALSE,
          -- False-positive rate is a first-class metric (docs/03 §3): an
          -- incident detector that cries wolf gets switched off in week two.
          CONSTRAINT false_positive_requires_verification
            CHECK (false_positive IS NULL OR verified_at IS NOT NULL)
        )
    """)
    op.execute("CREATE INDEX idx_incidents_geom ON incidents USING GIST(geom)")
    op.execute(
        "CREATE INDEX idx_incidents_active ON incidents(detected_at DESC) WHERE resolved_at IS NULL"
    )

    op.execute("""
        CREATE TABLE crashes (
          crash_id                 BIGSERIAL PRIMARY KEY,
          occurred_at              TIMESTAMPTZ NOT NULL,
          link_id                  BIGINT REFERENCES road_links(link_id),
          geom                     GEOMETRY(Point, 4326),
          fir_ref                  TEXT,
          fatalities               SMALLINT NOT NULL DEFAULT 0 CHECK (fatalities >= 0),
          grievous                 SMALLINT NOT NULL DEFAULT 0 CHECK (grievous >= 0),
          minor                    SMALLINT NOT NULL DEFAULT 0 CHECK (minor >= 0),
          vehicle_classes_involved TEXT[] NOT NULL DEFAULT '{}',
          primary_cause            TEXT,
          light_condition          TEXT,
          weather                  TEXT,
          source                   TEXT NOT NULL DEFAULT 'police',
          is_synthetic             BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)
    op.execute("CREATE INDEX idx_crashes_geom ON crashes USING GIST(geom)")
    op.execute("CREATE INDEX idx_crashes_occurred ON crashes(occurred_at DESC)")

    op.execute("""
        CREATE TABLE segment_risk (
          computed_on                 DATE NOT NULL,
          link_id                     BIGINT NOT NULL REFERENCES road_links(link_id),
          severity_risk               NUMERIC(4,3) NOT NULL CHECK (severity_risk BETWEEN 0 AND 1),
          risk_band                   TEXT NOT NULL CHECK (risk_band IN
                                        ('low','moderate','high','critical')),
          top_factors                 JSONB NOT NULL,
          recommended_countermeasures TEXT[] NOT NULL DEFAULT '{}',
          model_version               TEXT NOT NULL,
          PRIMARY KEY (computed_on, link_id),
          -- docs/07 §6: no unexplained score reaches a human.
          CONSTRAINT risk_score_must_be_explained
            CHECK (jsonb_typeof(top_factors) = 'array' AND jsonb_array_length(top_factors) > 0)
        )
    """)
    op.execute("""
        COMMENT ON COLUMN segment_risk.severity_risk IS
        'Probability that a crash here, in these conditions, is fatal or serious
         — NOT crash frequency. Built on docs/01: Jaipur crashes fell 5.6%% in
         2025 while deaths rose 3.1%%. Severity is the differentiator.'
    """)

    # ── enforcement. The raw plate is never stored. docs/07 §3. ──────────────
    op.execute("""
        CREATE TABLE violations (
          violation_id    BIGSERIAL PRIMARY KEY,
          occurred_at     TIMESTAMPTZ NOT NULL,
          camera_id       BIGINT REFERENCES cameras(camera_id),
          link_id         BIGINT REFERENCES road_links(link_id),
          violation_type  TEXT NOT NULL CHECK (violation_type IN
                            ('red_light','speed','no_helmet','triple_riding',
                             'wrong_side','no_seatbelt','lane')),
          plate_hash      TEXT NOT NULL,
          plate_encrypted BYTEA,
          ocr_confidence  NUMERIC(3,2) NOT NULL CHECK (ocr_confidence BETWEEN 0 AND 1),
          evidence_uri    TEXT,
          review_status   TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN
                            ('pending','confirmed','rejected','auto_confirmed')),
          reviewed_by     TEXT,
          reviewed_at     TIMESTAMPTZ,
          challan_ref     TEXT,
          is_synthetic    BOOLEAN NOT NULL DEFAULT FALSE,

          -- The join key is an HMAC-SHA256 digest. This makes a raw
          -- registration number structurally impossible to store here.
          CONSTRAINT plate_hash_is_hmac_digest CHECK (plate_hash ~ '^[0-9a-f]{64}$'),

          -- docs/04 §4: below 0.85 confidence the read must go to a human. A
          -- wrong challan is worse than a missed one.
          CONSTRAINT low_confidence_cannot_auto_confirm
            CHECK (ocr_confidence >= 0.85 OR review_status <> 'auto_confirmed'),

          -- docs/07 §6: human-in-the-loop is mandatory before any enforcement
          -- action. A confirmed violation must name who confirmed it.
          CONSTRAINT confirmation_requires_a_reviewer
            CHECK (review_status <> 'confirmed' OR
                   (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
        )
    """)
    op.execute("CREATE INDEX idx_violations_plate ON violations(plate_hash)")
    op.execute("CREATE INDEX idx_violations_review ON violations(review_status, occurred_at DESC)")

    op.execute("""
        CREATE TABLE defaulter_scores (
          computed_on             DATE NOT NULL,
          plate_hash              TEXT NOT NULL,
          repeat_risk             NUMERIC(4,3) NOT NULL CHECK (repeat_risk BETWEEN 0 AND 1),
          recovery_propensity     NUMERIC(4,3) CHECK (recovery_propensity BETWEEN 0 AND 1),
          severity_weighted_score NUMERIC(6,2),
          pending_challan_count   INTEGER CHECK (pending_challan_count >= 0),
          pending_amount_inr      NUMERIC(12,2) CHECK (pending_amount_inr >= 0),
          shap_explanation        JSONB NOT NULL,
          model_version           TEXT NOT NULL,
          is_synthetic            BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY (computed_on, plate_hash),
          CONSTRAINT defaulter_plate_hash_is_hmac_digest
            CHECK (plate_hash ~ '^[0-9a-f]{64}$'),
          -- docs/07 §6, absolutely load-bearing: SHAP is mandatory on every
          -- score. No unexplained score reaches a human. Enforced here so it
          -- cannot be skipped by a code path that forgot.
          CONSTRAINT score_must_be_explained
            CHECK (jsonb_typeof(shap_explanation) = 'array'
                   AND jsonb_array_length(shap_explanation) > 0)
        )
    """)
    op.execute("""
        COMMENT ON TABLE defaulter_scores IS
        'A road-safety targeting tool, not a revenue tool (docs/03 §3). Primary
         metric is severity-weighted risk reduction; recovery is secondary.'
    """)


def downgrade() -> None:
    for table in ("defaulter_scores", "violations", "segment_risk", "crashes", "incidents"):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
