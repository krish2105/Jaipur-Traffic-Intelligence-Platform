"""Audit log, policy corpus, database roles and row-level security.

Implements docs/07 §5. The load-bearing idea:

    "ABAC on top: an officer sees only their assigned corridors. Enforced in the
     query layer via PostgreSQL row-level security, not in application code —
     application-layer filtering is one missing WHERE clause away from a breach."

So the API sets three session variables per transaction and the database decides
what is visible. A forgotten filter in a router cannot leak another corridor's
rows, and NEETI's generated SQL is subject to exactly the same policies.

Revision ID: 0003
Revises: 0002
"""

from __future__ import annotations

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── audit log ────────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE audit_log (
          audit_id      BIGSERIAL,
          occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          actor_id      TEXT NOT NULL,
          actor_role    TEXT NOT NULL,
          action        TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id   TEXT,
          reason_code   TEXT,
          case_ref      TEXT,
          ip_address    INET,
          request_id    UUID,
          PRIMARY KEY (audit_id, occurred_at),
          -- docs/07 §5: unmasking is a logged, reason-coded action. Without the
          -- reason code the row cannot be written, so the API cannot return a
          -- plate without one either.
          CONSTRAINT sensitive_actions_need_a_reason
            CHECK (action NOT IN ('unmask_identity','view_plate','export')
                   OR reason_code IS NOT NULL)
        )
    """)
    op.execute("SELECT create_hypertable('audit_log','occurred_at')")
    op.execute("CREATE INDEX idx_audit_actor ON audit_log(actor_id, occurred_at DESC)")
    op.execute("CREATE INDEX idx_audit_action ON audit_log(action, occurred_at DESC)")

    # An UPDATE to an audit row is never legitimate. Grants are the primary
    # control (below); this trigger is defence in depth, because a grant can be
    # widened by accident and a trigger is noisier to remove.
    op.execute("""
        CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'audit_log is append-only (docs/07 §5); % is not permitted',
            TG_OP USING ERRCODE = 'insufficient_privilege';
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER audit_log_no_update
        BEFORE UPDATE ON audit_log
        FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only()
    """)

    # ── policy corpus (NEETI) ────────────────────────────────────────────────
    # 1024 dims = multilingual-e5-large. Cross-lingual by construction, so a
    # Hindi query retrieves English IRC documents (docs/04 §9).
    op.execute("""
        CREATE TABLE policy_documents (
          doc_id      BIGSERIAL PRIMARY KEY,
          title_en    TEXT NOT NULL,
          title_hi    TEXT NOT NULL,
          doc_type    TEXT NOT NULL CHECK (doc_type IN
                        ('irc_code','mv_act','circular','dpr','notification','study')),
          issued_by   TEXT,
          issued_on   DATE,
          source_uri  TEXT,
          content     TEXT NOT NULL,
          language    TEXT NOT NULL CHECK (language IN ('en','hi','mixed')),
          embedding   VECTOR(1024),
          is_synthetic BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)
    op.execute(
        "CREATE INDEX idx_policy_embedding ON policy_documents "
        "USING hnsw (embedding vector_cosine_ops)"
    )
    # Hybrid retrieval: BM25-style lexical alongside dense vectors, fused with
    # RRF, because Hindi and code-mixed queries break pure-dense retrieval.
    op.execute(
        "CREATE INDEX idx_policy_content_trgm ON policy_documents USING GIN (content gin_trgm_ops)"
    )

    # ── database roles ───────────────────────────────────────────────────────
    # Roles are provisioned by infra/postgres/00-extensions.sql as a superuser,
    # not here. A migration runs as the application user, which has no
    # CREATEROLE on Tiger Cloud and must not have it locally either. Fail with
    # an instruction rather than a permissions traceback.
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='pravaah_app')
          OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='pravaah_ro') THEN
            RAISE EXCEPTION
              'Roles pravaah_app / pravaah_ro are missing. Run '
              'infra/postgres/00-extensions.sql as a superuser first '
              '(scripts/dev_stack.sh up does this).';
          END IF;
        END $$
    """)

    op.execute("GRANT USAGE ON SCHEMA public TO pravaah_app, pravaah_ro")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pravaah_app")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pravaah_app")

    # docs/07 §5: "app roles have INSERT only, no UPDATE or DELETE grant."
    op.execute("REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM pravaah_app")
    op.execute("GRANT INSERT, SELECT ON audit_log TO pravaah_app")

    # ── row-level security: ABAC by corridor ─────────────────────────────────
    op.execute("""
        CREATE OR REPLACE FUNCTION app_roles() RETURNS text[] AS $$
          SELECT COALESCE(string_to_array(current_setting('app.roles', true), ','), '{}')
        $$ LANGUAGE sql STABLE
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION app_has_role(r text) RETURNS boolean AS $$
          SELECT r = ANY(app_roles())
        $$ LANGUAGE sql STABLE
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION app_corridors() RETURNS bigint[] AS $$
          SELECT COALESCE(
            string_to_array(current_setting('app.corridors', true), ',')::bigint[], '{}')
        $$ LANGUAGE sql STABLE
    """)
    op.execute("""
        COMMENT ON FUNCTION app_corridors() IS
        'Corridors the current request is scoped to. Empty array means unscoped,
         which only data_admin, analyst, auditor and viewer ever get.'
    """)

    # An officer scoped to specific corridors sees only those. Everyone else
    # sees the network. Applied to the tables that carry a corridor identity.
    op.execute("ALTER TABLE road_links ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY road_links_corridor_scope ON road_links
        FOR SELECT TO pravaah_app
        USING (
          cardinality(app_corridors()) = 0
          OR corridor_id = ANY(app_corridors())
        )
    """)
    op.execute("ALTER TABLE junctions ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY junctions_corridor_scope ON junctions
        FOR SELECT TO pravaah_app
        USING (
          cardinality(app_corridors()) = 0
          OR corridor_id = ANY(app_corridors())
        )
    """)
    # traffic_counts is a compressed hypertable, and TimescaleDB rejects
    # ALTER TABLE ... ENABLE ROW LEVEL SECURITY once columnstore is on. Dropping
    # compression is not an option (ADR-010: it is what keeps the seeded 90 days
    # inside Tiger Cloud's 750 MB ceiling), and dropping the scoping is not an
    # option either (docs/07 §5: enforcement belongs in the query layer).
    #
    # A security_barrier view gives the same guarantee on a compressed
    # hypertable: the application is granted SELECT on the view only, never on
    # the base table, so a forgotten WHERE clause still cannot cross corridors.
    # The barrier flag stops a cheap user-supplied function being pushed below
    # the filter to leak rows. See ADR-013.
    op.execute("""
        CREATE VIEW traffic_counts_scoped WITH (security_barrier = true) AS
        SELECT * FROM traffic_counts tc
        WHERE cardinality(app_corridors()) = 0
           OR tc.link_id IN (SELECT link_id FROM road_links
                             WHERE corridor_id = ANY(app_corridors()))
    """)
    op.execute("REVOKE SELECT ON traffic_counts FROM pravaah_app")
    op.execute("GRANT SELECT ON traffic_counts_scoped TO pravaah_app")
    op.execute("""
        COMMENT ON VIEW traffic_counts_scoped IS
        'Corridor-scoped read surface for traffic_counts. The application has no
         SELECT grant on the base hypertable — read through this view only.'
    """)

    # docs/07 §5: the auditor reads the audit log and CANNOT read P2. Enforced
    # by policy, not by remembering to check a role in a router.
    op.execute("ALTER TABLE violations ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY violations_p2_roles_only ON violations
        FOR SELECT TO pravaah_app
        USING (
          app_has_role('enforcement_officer')
          OR app_has_role('enforcement_supervisor')
          OR app_has_role('traffic_officer')
          OR app_has_role('data_admin')
        )
    """)
    op.execute("ALTER TABLE defaulter_scores ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY defaulter_scores_p2_roles_only ON defaulter_scores
        FOR SELECT TO pravaah_app
        USING (
          app_has_role('enforcement_officer')
          OR app_has_role('enforcement_supervisor')
          OR app_has_role('data_admin')
        )
    """)

    # ── NEETI's allowlisted read-only surface ────────────────────────────────
    # docs/07 §5: text-to-SQL runs as a read-only role against an allowlisted
    # schema. Only P0 (non-personal) data is reachable — no violations, no
    # defaulter scores, no audit log, by construction rather than by prompt.
    op.execute("CREATE SCHEMA IF NOT EXISTS neeti")
    op.execute("GRANT USAGE ON SCHEMA neeti TO pravaah_ro")
    op.execute("REVOKE ALL ON SCHEMA public FROM pravaah_ro")
    for view, source in [
        ("counts", "traffic_counts_scoped"),
        ("counts_hourly", "traffic_counts_hourly"),
        ("turning_movements", "turning_movements"),
        ("congestion", "link_congestion"),
        ("forecasts", "forecasts"),
        ("road_links", "road_links"),
        ("corridors", "corridors"),
        ("junctions", "junctions"),
        ("vehicle_classes", "vehicle_classes"),
        ("crashes", "crashes"),
        ("segment_risk", "segment_risk"),
        ("incidents", "incidents"),
    ]:
        # S608 is suppressed deliberately: `view` and `source` come from the
        # hardcoded list literal directly above, so no user input reaches
        # this SQL. This loop IS the allowlist that constrains NEETI's
        # text-to-SQL surface.
        op.execute(f"CREATE VIEW neeti.{view} AS SELECT * FROM public.{source}")  # noqa: S608
        op.execute(f"GRANT SELECT ON neeti.{view} TO pravaah_ro")

    op.execute("""
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pravaah_app
    """)


def downgrade() -> None:
    for table in ("road_links", "junctions", "traffic_counts", "violations", "defaulter_scores"):
        op.execute(f"ALTER TABLE IF EXISTS {table} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP SCHEMA IF EXISTS neeti CASCADE")
    op.execute("DROP TABLE IF EXISTS policy_documents CASCADE")
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_is_append_only()")
    op.execute("DROP TABLE IF EXISTS audit_log CASCADE")
    op.execute("DROP FUNCTION IF EXISTS app_corridors()")
    op.execute("DROP FUNCTION IF EXISTS app_has_role(text)")
    op.execute("DROP FUNCTION IF EXISTS app_roles()")
