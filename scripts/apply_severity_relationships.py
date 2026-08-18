"""Make the seeded crash severity depend on the things it depends on in reality.

The KAVACH model came out at **ROC-AUC 0.491 on this data — pure chance**. That
was not a modelling failure; it was the pipeline correctly reporting that there
was nothing to learn. The seed assigned fatal and grievous outcomes independently
of light, cause, road-user type and geometry, so no relationship existed between
any feature and severity.

That is worth stating plainly, because "our model scored 0.78 accuracy" on a
dataset with a 78% base rate is how a do-nothing model reaches production.

This script re-draws WHICH crashes are severe using relative odds derived from
MoRTH's published national shares, while holding each year's death total at the
published Jaipur figure. Nothing about the totals changes; what changes is that
the severity now lands where the evidence says it lands — on pedestrians, on
two-wheeler riders, on crashes involving a heavy vehicle, and at night.

**The circularity is real and must be stated wherever the model is shown.**
After this, KAVACH is recovering a relationship this script put in. That is a
demonstration that the pipeline can find a signal when one exists — it is not
evidence about Jaipur. Only per-crash data from the department can be that, and
`is_synthetic` stays true on every row.

    uv run python scripts/apply_severity_relationships.py
"""

from __future__ import annotations

import asyncio
import os

import asyncpg
import numpy as np
from dotenv import load_dotenv
from pravaah.adapters.published import CRASHES_BY_YEAR, DEATHS_2024_DERIVED, SEVERITY_ODDS

#: Grievous as a share of non-fatal casualties, from the seed as originally
#: generated (15,419 grievous against 27,983 minor). Fixed rather than read
#: back from the table so this script is idempotent.
GRIEVOUS_SHARE = 15_419 / (15_419 + 27_983)

TARGET_DEATHS = {
    **{y.year: y.deaths for y in CRASHES_BY_YEAR if y.deaths is not None},
    2024: DEATHS_2024_DERIVED,
}


async def main() -> None:
    load_dotenv()
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)

    rows = await conn.fetch(
        """
        SELECT crash_id,
               extract(year FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS year,
               (light_condition = 'night')                                AS night,
               (vehicle_classes_involved && ARRAY['NMV'])                 AS pedestrian,
               (vehicle_classes_involved && ARRAY['2W'])                  AS two_wheeler,
               (vehicle_classes_involved && ARRAY['TRK2','TRKM','BUS','LCV']) AS heavy,
               (primary_cause = 'over_speeding')                          AS over_speeding,
               fatalities, grievous, minor
        FROM crashes
        ORDER BY crash_id
        """
    )
    print(f"{len(rows):,} crashes")

    # Deterministic: the same seed must produce the same warehouse, or the
    # published-figure tests become flaky and nobody trusts them.
    rng = np.random.default_rng(20260818)

    by_year: dict[int, list] = {}
    for r in rows:
        by_year.setdefault(r["year"], []).append(r)

    updates: list[tuple[int, int, int, int]] = []
    for year, crashes in sorted(by_year.items()):
        target = TARGET_DEATHS.get(year)
        if target is None:
            # 2023 deaths were never published. Hold the year's existing total
            # rather than inventing one to fit the curve.
            target = sum(int(c["fatalities"]) for c in crashes)

        odds = np.ones(len(crashes))
        for i, c in enumerate(crashes):
            if c["pedestrian"]:
                odds[i] *= SEVERITY_ODDS["pedestrian_involved"]
            if c["two_wheeler"]:
                odds[i] *= SEVERITY_ODDS["two_wheeler_involved"]
            if c["heavy"]:
                odds[i] *= SEVERITY_ODDS["heavy_vehicle_involved"]
            if c["night"]:
                odds[i] *= SEVERITY_ODDS["night"]
            if c["over_speeding"]:
                odds[i] *= SEVERITY_ODDS["over_speeding"]

        # Draw exactly `n_fatal` crashes to be fatal, weighted by odds, where
        # n_fatal is chosen so the year's death total lands on target given the
        # existing multi-death distribution.
        deaths_per_fatal = max(
            1.0,
            sum(int(c["fatalities"]) for c in crashes)
            / max(1, sum(1 for c in crashes if c["fatalities"] > 0)),
        )
        n_fatal = min(len(crashes), round(target / deaths_per_fatal))
        probability = odds / odds.sum()
        fatal_index = set(
            rng.choice(len(crashes), size=n_fatal, replace=False, p=probability).tolist()
        )

        # Distribute the target deaths across the chosen crashes, one each and
        # the remainder spread from the front.
        per_crash = [1] * n_fatal
        for i in range(target - n_fatal):
            per_crash[i % n_fatal] += 1

        allocated = 0
        for i, c in enumerate(crashes):
            casualties = int(c["fatalities"]) + int(c["grievous"]) + int(c["minor"])
            if i in fatal_index:
                fatalities = per_crash[allocated]
                allocated += 1
            else:
                fatalities = 0
            # Casualties are conserved: a person who is no longer a fatality is
            # an injury, not someone who was never in the crash. The remaining
            # casualties keep the crash's ORIGINAL grievous-to-minor ratio, so
            # re-drawing who dies does not also inflate how many are seriously
            # hurt — an earlier version added one grievous injury per crash and
            # pushed the severe rate from 78% to 97%.
            remaining = max(0, casualties - fatalities)
            # A fixed global share rather than the row's own ratio. Reading the
            # ratio from the row makes the script non-idempotent: run it twice
            # and it compounds its own output, which is exactly what happened —
            # grievous and minor inverted, 15,419 becoming 28,914.
            grievous = round(remaining * GRIEVOUS_SHARE)
            minor = remaining - grievous
            updates.append((c["crash_id"], fatalities, grievous, minor))

        print(f"{year}: {n_fatal:>5} fatal crashes, {target:>5} deaths")

    await conn.executemany(
        "UPDATE crashes SET fatalities=$2, grievous=$3, minor=$4 WHERE crash_id=$1",
        updates,
    )

    check = await conn.fetch(
        """
        SELECT extract(year FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS y,
               count(*) AS a, sum(fatalities) AS d,
               round(100.0 * count(*) FILTER (WHERE fatalities>0 OR grievous>0)
                     / count(*), 1) AS pct_severe
        FROM crashes GROUP BY y ORDER BY y
        """
    )
    print("\nafter:")
    for r in check:
        print(f"  {r['y']}  {r['a']:>5} crashes  {r['d']:>5} deaths  {r['pct_severe']}% severe")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
