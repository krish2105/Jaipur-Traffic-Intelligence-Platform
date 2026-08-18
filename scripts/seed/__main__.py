"""Seed the PRAVAAH demo database.

    make seed                 # 90 days, the docs/05 §5 default
    uv run python -m scripts.seed --days 14 --reset

Everything written here is reproducible from a fixed seed, so the demo looks
identical on every machine and on every run. Synthetic rows carry
is_synthetic = TRUE without exception (docs/02 rule 6).
"""

from __future__ import annotations

import argparse
import os
import sys
import time

import psycopg

from . import measurements, reference, safety


def _dsn() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        sys.exit("DATABASE_URL is not set (source .env first)")
    return url.replace("postgresql+asyncpg://", "postgresql://").replace(
        "postgresql+psycopg://", "postgresql://"
    )


TABLES = (
    "defaulter_scores",
    "violations",
    "segment_risk",
    "crashes",
    "incidents",
    "forecasts",
    "link_congestion",
    "turning_movements",
    "traffic_counts",
    "policy_documents",
    "cameras",
    "junctions",
    "road_links",
    "corridors",
    "vehicle_classes",
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the PRAVAAH demo database")
    parser.add_argument("--days", type=int, default=90, help="days of measurement history")
    parser.add_argument("--reset", action="store_true", help="truncate seeded tables first")
    args = parser.parse_args()

    started = time.monotonic()
    with psycopg.connect(_dsn()) as conn:
        if args.reset:
            with conn.cursor() as cur:
                cur.execute(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE")
            conn.commit()
            print("  reset: seeded tables truncated")

        print("  seeding reference data (real OSM geometry)…")
        totals = reference.seed(conn)
        print(f"  seeding {args.days} days of measurements…")
        totals |= measurements.seed(conn, days=args.days)
        print("  seeding safety and enforcement…")
        totals |= safety.seed(conn)

    # The refresh cannot run inside a transaction block, so it gets its own
    # autocommit connection after the seeding connection has closed.
    with psycopg.connect(_dsn(), autocommit=True) as refresh_conn, refresh_conn.cursor() as cur:
        cur.execute("CALL refresh_continuous_aggregate('traffic_counts_hourly', NULL, NULL)")
    print("  continuous aggregate refreshed")

    elapsed = time.monotonic() - started
    print(f"\n  ── seeded in {elapsed:.1f}s ──")
    width = max(len(k) for k in totals) + 2
    for name, count in totals.items():
        print(f"    {name:<{width}} {count:>10,}")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
