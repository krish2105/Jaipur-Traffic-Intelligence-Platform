"""The seed must keep reproducing the published figures.

These are not tests of arithmetic. They are the tripwire that stops a demo
drifting away from the evidence it claims to rest on: if someone regenerates
the seed with a different distribution, the build fails here rather than in a
room in Jaipur.
"""

from pravaah.adapters import published as P


def test_the_five_year_total_is_the_sum_of_the_published_years() -> None:
    assert P.TOTAL_ACCIDENTS == 18_578


def test_deaths_are_none_where_they_were_not_published() -> None:
    # The important half of this: an unpublished figure must never appear as a
    # zero, and must never be quietly interpolated into a number that looks
    # sourced.
    by_year = {y.year: y.deaths for y in P.CRASHES_BY_YEAR}
    assert by_year[2023] is None
    assert by_year[2024] is None
    assert by_year[2021] == 1106


def test_the_severity_finding_holds_in_the_published_numbers() -> None:
    # Fewer crashes, more deaths. This is the whole reason black spots are
    # ranked by severity rather than by frequency — if these two ever share a
    # sign, that ranking needs rethinking, not patching.
    assert P.ACCIDENTS_CHANGE_2025_PCT < 0
    assert P.FATALITIES_CHANGE_2025_PCT > 0


def test_2025_accidents_fell_against_2024_by_the_published_percentage() -> None:
    y = {c.year: c.accidents for c in P.CRASHES_BY_YEAR}
    change = (y[2025] - y[2024]) / y[2024] * 100
    assert abs(change - P.ACCIDENTS_CHANGE_2025_PCT) < 0.15


def test_2025_fatality_rate_matches_the_published_deaths_and_accidents() -> None:
    y = {c.year: c for c in P.CRASHES_BY_YEAR}[2025]
    assert y.deaths is not None
    rate = y.deaths / y.accidents * 100
    assert abs(rate - P.FATALITY_RATE_2025) < 0.15


def test_district_accidents_sum_close_to_the_city_total() -> None:
    # Published district figures come from separate returns and do not have to
    # reconcile exactly; a wide gap would mean we had mixed years or areas.
    total = sum(d.accidents for d in P.DISTRICTS_2025)
    city = {c.year: c.accidents for c in P.CRASHES_BY_YEAR}[2025]
    assert abs(total - city) / city < 0.05
