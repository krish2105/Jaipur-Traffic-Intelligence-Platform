"""Ninety days of counts, congestion and forecasts.

The counts are synthetic; the shapes are not. Every value derives from the
calibrated Jaipur profile in `pravaah.adapters.profiles`, which reproduces the
four published TomTom figures exactly (see its test suite). Every row is written
with is_synthetic = TRUE so the UI can badge it — docs/02 rule 6 makes an
unlabelled synthetic figure a project-ending mistake.
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg
from pravaah.adapters import profiles as P
from pravaah.contracts.enums import PCU_FACTORS, VehicleClass

#: The profile is expressed in Jaipur local hours — "the evening peak is at
#: 19:00" means 19:00 IST. Timestamps are stored as the correct UTC instant for
#: that local time, so a reader in any timezone sees the same Jaipur day.
IST = ZoneInfo("Asia/Kolkata")

BIN_SECONDS = 300
BINS_PER_DAY = 86_400 // BIN_SECONDS

#: Which approach each camera watches. Six cameras, eight (camera, direction)
#: pairs — two of them are junctions instrumented in both directions.
CAMERA_DIRECTIONS: list[tuple[int, str]] = [
    (0, "NB"),
    (0, "SB"),
    (1, "NB"),
    (2, "SB"),
    (3, "NB"),
    (3, "SB"),
    (4, "NB"),
    (5, "SB"),
]

#: Peak-hour design flow per direction at an instrumented Tonk Road approach,
#: in vehicles/hour. Anchored to docs/01 §2: >15 lakh vehicles use Jaipur's main
#: roads daily across roughly forty instrumented-equivalent approaches.
PEAK_FLOW_VEH_HR = 3_400


def _wet_days(days: list[date], rng: random.Random) -> set[date]:
    """Jaipur monsoon is late June to mid-September. Rain degrades counting, and
    docs/03 §3 requires that degradation to be visible rather than hidden."""
    wet: set[date] = set()
    for day in days:
        monsoon = 6 <= day.month <= 9
        if rng.random() < (0.34 if monsoon else 0.03):
            wet.add(day)
    return wet


def seed(conn: psycopg.Connection, *, days: int, seed_value: int = 20260818) -> dict[str, int]:
    # S311: this is a reproducible data generator, not a security primitive.
    # A fixed seed is the point — the demo must look identical on every run.
    rng = random.Random(seed_value)  # noqa: S311
    cur = conn.cursor()

    cur.execute("SELECT camera_id, link_id FROM cameras ORDER BY camera_id")
    cameras = cur.fetchall()
    if not cameras:
        msg = "no cameras — run the reference seeder first"
        raise RuntimeError(msg)

    cur.execute(
        "SELECT link_id, free_flow_speed_kmh, design_capacity_pcu_hr FROM road_links"
        " WHERE corridor_id IS NOT NULL ORDER BY link_id"
    )
    links = cur.fetchall()

    end_day = datetime.now(IST).date()
    all_days = [end_day - timedelta(days=i) for i in range(days - 1, -1, -1)]
    # The seeded window is anchored so it always contains TomTom's worst day of
    # 2025, which is what the time-travel scrubber lands on in the demo.
    if P.WORST_DAY_2025 not in all_days:
        all_days = [P.WORST_DAY_2025, *all_days[1:]]
    wet = _wet_days(all_days, rng)

    class_codes = list(P.CLASS_SHARE)
    written = 0

    with cur.copy(
        "COPY traffic_counts (bucket_start, camera_id, link_id, direction, class_code,"
        " vehicle_count, pcu, mean_speed_kmh, p85_speed_kmh, speed_stddev, mean_headway_s,"
        " occupancy_pct, queue_length_m, quality_score, quality_flags, is_synthetic)"
        " FROM STDIN"
    ) as copy:
        for day in all_days:
            is_wet = day in wet
            day_mult = P.day_factor(day) * (0.87 if is_wet else 1.0)
            for bin_index in range(BINS_PER_DAY):
                minutes = bin_index * (BIN_SECONDS // 60)
                hour, minute = divmod(minutes, 60)
                bucket = datetime(day.year, day.month, day.day, hour, minute, tzinfo=IST)

                index = P.congestion_index(hour, minute, day)
                quality, flags = P.quality_score(hour, is_wet=is_wet)
                # Share of the day's volume in this 5-minute bin.
                bin_share = P.hour_weight(hour) / (3600 // BIN_SECONDS)

                for cam_idx, direction in CAMERA_DIRECTIONS:
                    if cam_idx >= len(cameras):
                        continue
                    camera_id, link_id = cameras[cam_idx]
                    # Directional asymmetry: inbound heavier in the morning,
                    # outbound heavier in the evening. Tidal flow is real and a
                    # traffic engineer will look for it.
                    tide = 1.0
                    if direction == "NB":
                        tide = 1.22 if hour < 12 else 0.84
                    elif direction == "SB":
                        tide = 0.82 if hour < 12 else 1.24

                    total_veh = (
                        PEAK_FLOW_VEH_HR
                        * bin_share
                        * (3600 // BIN_SECONDS)
                        * day_mult
                        * tide
                        * rng.uniform(0.90, 1.10)
                    )
                    free_flow = 45.0
                    speed = P.speed_kmh(index, free_flow)

                    for code in class_codes:
                        share = P.CLASS_SHARE[code] * rng.uniform(0.93, 1.07)
                        count = round(total_veh * share)
                        if count <= 0:
                            continue
                        pcu = round(count * PCU_FACTORS[VehicleClass(code)], 2)
                        # Heavy vehicles run slower; two-wheelers filter and run
                        # faster than the stream in congestion.
                        adj = {"2W": 1.12, "BUS": 0.86, "TRK2": 0.84, "NMV": 0.42}.get(code, 1.0)
                        mean_speed = round(min(free_flow, speed * adj), 2)
                        copy.write_row(
                            (
                                bucket,
                                camera_id,
                                link_id,
                                direction,
                                code,
                                count,
                                pcu,
                                mean_speed,
                                round(mean_speed * 1.28, 2),
                                round(mean_speed * 0.22, 2),
                                round(BIN_SECONDS / max(1, count), 2),
                                round(min(95.0, index * 0.82), 2),
                                round(max(0.0, (index - 45) * 5.6), 2),
                                quality,
                                flags,
                                True,
                            )
                        )
                        written += 1

    conn.commit()

    # ── link congestion, for every corridor link ────────────────────────────
    cong = 0
    with cur.copy(
        "COPY link_congestion (bucket_start, link_id, congestion_index, vc_ratio,"
        " speed_ratio, queue_persistence, probe_delay_s, source_mix, confidence,"
        " is_synthetic) FROM STDIN"
    ) as copy:
        for day in all_days:
            for hour in range(24):
                for minute in (0, 15, 30, 45):
                    bucket = datetime(day.year, day.month, day.day, hour, minute, tzinfo=IST)
                    base = P.congestion_index(hour, minute, day)
                    for link_id, free_flow, _capacity in links:
                        jitter = rng.uniform(0.88, 1.12)
                        index = min(100.0, max(0.0, base * jitter))
                        speed = P.speed_kmh(index, float(free_flow or 40))
                        copy.write_row(
                            (
                                bucket,
                                link_id,
                                round(index, 2),
                                round(index / 100 * 1.15, 3),
                                round(speed / float(free_flow or 40), 3),
                                round(max(0.0, (index - 55) / 45), 3),
                                round(max(0.0, (index - 20) * 3.4), 2),
                                # Both sources present: this is the fusion story from
                                # docs/01 §4 — probe gives coverage, cameras give
                                # ground truth, together they beat either alone.
                                ["camera", "probe"] if index > 30 else ["probe"],
                                0.86,
                                True,
                            )
                        )
                        cong += 1
    conn.commit()

    # ── forecasts for the most recent day ───────────────────────────────────
    fc = 0
    latest = all_days[-1]
    with cur.copy(
        "COPY forecasts (issued_at, link_id, horizon_min, predicted_index,"
        " lower_80, upper_80, model_version) FROM STDIN"
    ) as copy:
        for hour in range(24):
            issued = datetime(latest.year, latest.month, latest.day, hour, 0, tzinfo=IST)
            for link_id, _ff, _cap in links[:40]:
                for horizon in (15, 30, 60):
                    ahead = hour + horizon / 60.0
                    point = P.congestion_index(int(ahead) % 24, int((ahead % 1) * 60), latest)
                    # The band widens with the horizon, because it should — a
                    # forecast without honest uncertainty is not decision support.
                    width = 4.5 + horizon * 0.14
                    copy.write_row(
                        (
                            issued,
                            link_id,
                            horizon,
                            round(point, 2),
                            round(max(0.0, point - width), 2),
                            round(min(100.0, point + width), 2),
                            "persistence-baseline-0.1.0",
                        )
                    )
                    fc += 1
    conn.commit()

    return {"traffic_counts": written, "link_congestion": cong, "forecasts": fc}
