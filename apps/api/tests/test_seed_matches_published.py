"""The seeded warehouse must still reproduce the published Jaipur figures.

Skipped when no database is configured, because this asserts a property of the
*data*, not of the code — a developer without a warehouse should not see a
failure they cannot act on.
"""

from __future__ import annotations

import asyncio
import os

import asyncpg
import pytest
from pravaah.adapters import published as P

DSN = (os.environ.get("DATABASE_URL") or "").replace("postgresql+asyncpg://", "postgresql://")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


async def _load() -> dict[int, tuple[int, int]]:
    conn = await asyncpg.connect(DSN)
    try:
        rows = await conn.fetch(
            """
            SELECT extract(year FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS y,
                   count(*) AS accidents,
                   sum(fatalities) AS deaths
            FROM crashes
            GROUP BY y
            """
        )
    finally:
        await conn.close()
    return {int(r["y"]): (int(r["accidents"]), int(r["deaths"])) for r in rows}


@pytest.fixture(scope="module")
def seeded() -> dict[int, tuple[int, int]]:
    # asyncpg rather than a sync engine: this project has no psycopg2 and does
    # not want one for a single read.
    #
    # An unreachable database skips rather than errors. A DATABASE_URL that is
    # set but points at a stopped Postgres is the same situation as one that is
    # unset — this machine cannot check the seed — and the suite already knows
    # how to say that. Reporting it as three errors instead turned a laptop with
    # its containers down into a red build.
    try:
        return asyncio.run(_load())
    except (OSError, asyncpg.PostgresError) as exc:
        pytest.skip(f"DATABASE_URL is set but Postgres is unreachable: {exc}")


def test_every_published_year_is_reproduced_exactly(seeded: dict[int, tuple[int, int]]) -> None:
    for year in P.CRASHES_BY_YEAR:
        assert year.year in seeded, f"{year.year} missing from the seed"
        assert seeded[year.year][0] == year.accidents, (
            f"{year.year}: seed has {seeded[year.year][0]} crashes, "
            f"Jaipur police published {year.accidents}"
        )


def test_deaths_land_within_one_percent_where_published(
    seeded: dict[int, tuple[int, int]],
) -> None:
    # Deaths are distributed by the generator rather than placed, so exactness
    # is not the bar; staying inside 1% is, because the severity argument is
    # quoted from these.
    for year in P.CRASHES_BY_YEAR:
        if year.deaths is None:
            continue
        seeded_deaths = seeded[year.year][1]
        assert abs(seeded_deaths - year.deaths) / year.deaths < 0.01, (
            f"{year.year}: seed has {seeded_deaths} deaths against a published {year.deaths}"
        )


def test_the_seed_shows_the_same_severity_reversal(
    seeded: dict[int, tuple[int, int]],
) -> None:
    # 2025 against 2024: fewer crashes, and the death rate must not fall.
    a24, d24 = seeded[2024]
    a25, d25 = seeded[2025]
    assert a25 < a24
    assert (d25 / a25) > (d24 / a24)
