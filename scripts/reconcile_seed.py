"""Make per-link counts imply the published congestion.

The warehouse held two views of the same corridor that disagreed (ADR-059).
The congestion index is top-down, calibrated to the published TomTom figures.
The per-link counts were bottom-up from the seed generator. Each reproduced its
own source faithfully; together they described two different roads — a corridor
at 15.5 km/h whose every junction ran at a fifth of capacity.

The bridge turned out to be already in the warehouse. `link_congestion` carries
a `vc_ratio` column — the volume-to-capacity ratio the seed *intended* each
link-hour to have, and the ratio its congestion index was derived from. At 19:00
it records 0.987, a corridor at capacity, which is entirely consistent with an
index of 86 and 15.5 km/h.

The counts simply never matched it: they deliver about 0.4. So this rescales
`traffic_counts` until each link-hour's PCU divided by its design capacity
equals the `vc_ratio` already recorded beside it.

Using the seed's own stated intent rather than inverting a speed curve matters:
it introduces no new assumption. The target is not a number I chose, it is the
number the generator wrote down and then failed to honour.

**What this does and does not fix.** It makes the warehouse self-consistent, so
a simulation can target both volume and speed without being asked to satisfy
two contradictory numbers. It does not make either number more true: the
congestion is still calibrated synthesis and the counts are still generated.
`is_synthetic` stays true on every row, and ADR-059 keeps the record of the
inconsistency so the fix is not mistaken for the problem never having existed.

    uv run python scripts/reconcile_seed.py [--dry-run]
"""

from __future__ import annotations

import argparse
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

#: A link cannot be scaled without bound. Beyond about 2.5x capacity a road is
#: in queue-discharge rather than flow, BPR stops describing it, and the number
#: would be arithmetic rather than traffic.
MAX_VC = 2.5

#: Below this the link is genuinely free-flowing and needs no adjustment.
MIN_VC = 0.05


def clamp_vc(recorded: float) -> float:
    """The recorded ratio, bounded. Beyond ~2.5x a road is in queue discharge
    rather than flow and the number stops describing traffic."""
    return float(min(MAX_VC, max(MIN_VC, recorded)))


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    load_dotenv()
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)

    # One scale factor per link per hour: what the counts SHOULD be, against
    # what they are. Per hour because congestion varies through the day and a
    # single daily factor would flatten the profile the whole platform rests on.
    rows = await conn.fetch(
        """
        WITH hourly AS (
            SELECT tc.link_id,
                   extract(hour FROM tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS hr,
                   sum(tc.pcu) / 7.0            AS pcu_per_hour,
                   count(DISTINCT tc.bucket_start) AS buckets
            FROM traffic_counts tc
            WHERE tc.bucket_start >= now() - INTERVAL '7 days'
            GROUP BY tc.link_id, hr
        ),
        congestion AS (
            SELECT lc.link_id,
                   extract(hour FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS hr,
                   avg(lc.congestion_index) AS idx,
                   avg(lc.vc_ratio)         AS vc
            FROM link_congestion lc
            WHERE lc.bucket_start >= now() - INTERVAL '7 days'
            GROUP BY lc.link_id, hr
        )
        SELECT h.link_id, h.hr, h.pcu_per_hour,
               c.idx, c.vc,
               COALESCE(l.design_capacity_pcu_hr, 2200)::float AS capacity,
               COALESCE(l.free_flow_speed_kmh, 50)::float      AS free_flow
        FROM hourly h
        JOIN congestion c ON c.link_id = h.link_id AND c.hr = h.hr
        JOIN road_links l ON l.link_id = h.link_id
        WHERE h.pcu_per_hour > 0
        """
    )
    print(f"{len(rows):,} link-hours to reconcile")

    factors: list[tuple[int, int, float]] = []
    for r in rows:
        target_vc = clamp_vc(float(r["vc"] or 0))
        target_pcu = target_vc * float(r["capacity"])
        current = float(r["pcu_per_hour"])
        if current <= 0:
            continue
        factors.append((int(r["link_id"]), int(r["hr"]), target_pcu / current))

    if not factors:
        print("nothing to do")
        await conn.close()
        return

    scales = sorted(f for _, _, f in factors)
    print(
        f"scale factors: min {scales[0]:.2f}  median {scales[len(scales) // 2]:.2f}  "
        f"max {scales[-1]:.2f}"
    )

    if args.dry_run:
        print("dry run — nothing written")
        await conn.close()
        return

    # Applied as one UPDATE per link-hour. vehicle_count and pcu scale together
    # so the class mix — the platform's central argument — is untouched.
    await conn.executemany(
        """
        UPDATE traffic_counts tc
        SET vehicle_count = GREATEST(0, round(tc.vehicle_count * $3)::int),
            pcu           = GREATEST(0, tc.pcu * $3)
        WHERE tc.link_id = $1
          AND extract(hour FROM tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int = $2
        """,
        factors,
    )
    print(f"rescaled {len(factors):,} link-hours")

    check = await conn.fetchrow(
        """
        SELECT sum(tc.vehicle_count)::bigint AS vehicles,
               round(sum(tc.pcu)) AS pcu
        FROM traffic_counts tc
        JOIN road_links l ON l.link_id = tc.link_id
        WHERE l.corridor_id = 1
          AND extract(hour FROM tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int = 19
          AND tc.bucket_start >= now() - INTERVAL '7 days'
        """
    )
    print(
        f"corridor at 19:00, 7 days: {int(check['vehicles']):,} vehicles, {int(check['pcu']):,} PCU"
    )
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
