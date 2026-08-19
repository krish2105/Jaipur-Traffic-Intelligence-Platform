"""Banding and exceedance logic, which is where a pollution figure acquires a
claim — and therefore where a wrong one does real damage."""

from pravaah.adapters.air import AirQuality


def _aq(**kwargs: float | int | None) -> AirQuality:
    base: dict[str, float | int | str | None] = {
        "pm2_5": None,
        "pm10": None,
        "nitrogen_dioxide": None,
        "ozone": None,
        "carbon_monoxide": None,
        "us_aqi": None,
        "observed_at": "",
    }
    base.update(kwargs)
    return AirQuality(**base)  # type: ignore[arg-type]


def test_exceedance_uses_indian_standards_not_who() -> None:
    # 45 ug/m3 PM2.5 is over the WHO 24h guideline and under CPCB's 60. A
    # Jaipur official is accountable against CPCB, so this must NOT flag.
    assert _aq(pm2_5=45.0).exceeds_cpcb == ()
    assert _aq(pm2_5=61.0).exceeds_cpcb == ("PM2.5",)


def test_a_missing_pollutant_is_never_an_exceedance() -> None:
    # An absent reading must not be treated as a zero or as a breach.
    assert _aq().exceeds_cpcb == ()


def test_multiple_exceedances_are_all_reported() -> None:
    assert set(_aq(pm2_5=70.0, pm10=140.0, nitrogen_dioxide=90.0).exceeds_cpcb) == {
        "PM2.5",
        "PM10",
        "NO2",
    }


def test_aqi_bands_match_the_us_scale() -> None:
    assert _aq(us_aqi=50).band == "good"
    assert _aq(us_aqi=113).band == "unhealthy_sensitive"
    assert _aq(us_aqi=301).band == "hazardous"
    assert _aq().band == "unknown"
