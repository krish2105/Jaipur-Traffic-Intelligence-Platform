"""Align seeded crash fatalities with the published Jaipur trajectory.

The seed reproduced every published *accident* count exactly but distributed
deaths independently, and the result contradicted the platform's headline
finding: its 2024 fatality rate came out at 35.4 against 34.6 in 2025, so
severity appeared to *fall* where Jaipur police report it rising.

That is the one claim the whole safety layer rests on. A demo whose own data
argues against its central slide is worse than a demo with no data.

This rescales fatalities per year to the published (or, for 2024, derived)
totals, preserving the existing shape — which crash was fatal, and at what hour
— by adjusting the count on already-fatal crashes rather than by reassigning
severity to different ones.

    uv run python scripts/fix_crash_fatalities.py [--dry-run]
"""

from __future__ import annotations

import argparse
import asyncio
import os

import asyncpg
from dotenv import load_dotenv
from pravaah.adapters.published import CRASHES_BY_YEAR, DEATHS_2024_DERIVED

TARGETS: dict[int, int] = {
    **{y.year: y.deaths for y in CRASHES_BY_YEAR if y.deaths is not None},
    2024: DEATHS_2024_DERIVED,
}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    load_dotenv()
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)

    rows = await conn.fetch(
        """
        SELECT extract(year FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS y,
               count(*) AS accidents,
               sum(fatalities) AS deaths
        FROM crashes GROUP BY y ORDER BY y
        """
    )
    print(f"{'year':6}{'accidents':>10}{'deaths':>9}{'target':>9}{'rate':>8}")
    plan: list[tuple[int, int]] = []
    for r in rows:
        target = TARGETS.get(r["y"])
        rate = 100 * r["deaths"] / r["accidents"]
        print(
            f"{r['y']:<6}{r['accidents']:>10}{r['deaths']:>9}"
            f"{(target if target else '—'):>9}{rate:>7.2f}"
        )
        if target is not None and target != r["deaths"]:
            plan.append((r["y"], target))

    if not plan:
        print("\nnothing to change")
        await conn.close()
        return

    if args.dry_run:
        print(f"\nwould adjust {len(plan)} years")
        await conn.close()
        return

    for year, target in plan:
        # Scale every fatal crash's death count toward the target, then settle
        # the remainder one crash at a time. Keeps the hour-of-day and
        # cause distribution of fatal crashes exactly as seeded.
        current = await conn.fetchval(
            """
            SELECT sum(fatalities) FROM crashes
            WHERE extract(year FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int = $1
            """,
            year,
        )
        delta = target - int(current)

        if delta > 0:
            # More deaths: raise the toll on crashes that were already fatal,
            # so the hour-of-day and cause distribution of fatal crashes is
            # untouched. A grievous injury becomes a death.
            remaining = delta
            while remaining > 0:
                ids = await conn.fetch(
                    """
                    SELECT crash_id FROM crashes
                    WHERE extract(year FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int = $1
                      AND fatalities > 0
                      AND grievous > 0
                    ORDER BY crash_id
                    LIMIT $2
                    """,
                    year,
                    remaining,
                )
                if not ids:
                    break
                await conn.executemany(
                    """
                    UPDATE crashes
                    SET fatalities = fatalities + 1, grievous = grievous - 1
                    WHERE crash_id = $1
                    """,
                    [(r["crash_id"],) for r in ids],
                )
                remaining -= len(ids)
        else:
            # Fewer deaths. A death removed does not mean a casualty removed:
            # the person survived with a serious injury, so the fatality moves
            # to `grievous`. Crashes with a single death necessarily stop being
            # fatal crashes, which is what a lower toll actually means and is
            # the one part of the distribution this cannot preserve.
            remaining = -delta
            while remaining > 0:
                ids = await conn.fetch(
                    """
                    SELECT crash_id FROM crashes
                    WHERE extract(year FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int = $1
                      AND fatalities > 0
                    ORDER BY fatalities DESC, crash_id
                    LIMIT $2
                    """,
                    year,
                    remaining,
                )
                if not ids:
                    break
                await conn.executemany(
                    """
                    UPDATE crashes
                    SET fatalities = fatalities - 1, grievous = grievous + 1
                    WHERE crash_id = $1
                    """,
                    [(r["crash_id"],) for r in ids],
                )
                remaining -= len(ids)

        final = await conn.fetchval(
            """
            SELECT sum(fatalities) FROM crashes
            WHERE extract(year FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int = $1
            """,
            year,
        )
        print(f"{year}: {int(current)} -> {int(final)} (target {target})")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
