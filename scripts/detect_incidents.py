"""Run the congestion-anomaly detector over the stored history.

This is the detector the incidents panel was previously honest about *not*
having run. It invents nothing: every incident it writes is a residual against
that link's own median for that weekday-hour, computed from data already in the
warehouse. The congestion underneath is seeded, so every row is written with
``is_synthetic = TRUE`` and the UI badges it — docs/07 and CLAUDE.md both make
unlabelled synthetic data a hard prohibition, and a chart is exactly where that
prohibition gets forgotten.

    uv run python scripts/detect_incidents.py [--hours 24] [--reset]

Baselines come from history *older* than the detection window, so the window
being scored cannot pull its own baseline up and hide itself.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from datetime import datetime, timedelta

import asyncpg
from dotenv import load_dotenv
from pravaah.adapters.anomaly import confidence_for, is_anomalous, severity_for

#: Consecutive anomalous buckets on one link are one incident, not four. A
#: queue with four rows for the same jam is a queue an officer stops reading.
_JOIN_GAP = timedelta(minutes=30)
_BUCKET = timedelta(minutes=15)

#: MAD to standard-deviation scale for a normal distribution. Without it the
#: z-scores are not comparable to the thresholds in anomaly.py, which are
#: written in sigma.
_MAD_TO_SIGMA = 1.4826

_CANDIDATES = """
WITH baseline AS (
    SELECT lc.link_id,
           extract(dow  FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS dow,
           extract(hour FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS hour,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lc.congestion_index) AS median
    FROM link_congestion lc
    WHERE lc.bucket_start <  now() - make_interval(hours => $1)
      AND lc.bucket_start >= now() - make_interval(hours => $1) - INTERVAL '90 days'
    GROUP BY 1, 2, 3
),
spread AS (
    SELECT b.link_id, b.dow, b.hour, b.median,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(lc.congestion_index - b.median))
             AS mad
    FROM baseline b
    JOIN link_congestion lc
      ON lc.link_id = b.link_id
     AND extract(dow  FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int = b.dow
     AND extract(hour FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int = b.hour
    WHERE lc.bucket_start <  now() - make_interval(hours => $1)
      AND lc.bucket_start >= now() - make_interval(hours => $1) - INTERVAL '90 days'
    GROUP BY 1, 2, 3, 4
)
SELECT lc.link_id,
       lc.bucket_start,
       lc.congestion_index::float                    AS observed,
       s.median::float                               AS median,
       GREATEST(s.mad, 0.5)::float                   AS mad,
       ST_Centroid(l.geom)::text                     AS centroid
FROM link_congestion lc
JOIN road_links l ON l.link_id = lc.link_id
JOIN spread s
  ON s.link_id = lc.link_id
 AND s.dow  = extract(dow  FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int
 AND s.hour = extract(hour FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int
WHERE lc.bucket_start >  now() - make_interval(hours => $1)
  AND lc.bucket_start <= now()
ORDER BY lc.link_id, lc.bucket_start
"""


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--reset", action="store_true", help="clear model-detected incidents first")
    args = ap.parse_args()

    load_dotenv()
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url)

    if args.reset:
        cleared = await conn.execute(
            "DELETE FROM incidents WHERE detection_source = 'model' AND is_synthetic"
        )
        print(f"cleared {cleared.split()[-1]} previously detected incidents")

    rows = await conn.fetch(_CANDIDATES, args.hours)
    print(f"scored {len(rows):,} link-buckets against their own weekday-hour baseline")

    # Fold consecutive hits on a link into one incident. `open_` is the run in
    # progress; a gap wider than _JOIN_GAP or a change of link closes it.
    incidents: list[tuple] = []
    open_: dict | None = None

    def close(run: dict) -> None:
        incidents.append((
            run["start"],
            run["link_id"],
            run["centroid"],
            severity_for(run["peak_z"]),
            round(confidence_for(run["peak_z"]), 2),
            run["end"] + _BUCKET,
        ))

    for r in rows:
        residual = r["observed"] - r["median"]
        z = residual / (r["mad"] * _MAD_TO_SIGMA)
        if not is_anomalous(residual, z):
            continue
        if (
            open_ is not None
            and open_["link_id"] == r["link_id"]
            and r["bucket_start"] - open_["end"] <= _JOIN_GAP
        ):
            open_["end"] = r["bucket_start"]
            open_["peak_z"] = max(open_["peak_z"], z)
            continue
        if open_ is not None:
            close(open_)
        open_ = {
            "link_id": r["link_id"],
            "centroid": r["centroid"],
            "start": r["bucket_start"],
            "end": r["bucket_start"],
            "peak_z": z,
        }
    if open_ is not None:
        close(open_)

    # An incident whose run reaches the present has not been observed to end.
    # Writing a resolved_at in the future would put a resolved incident in the
    # active queue's past, which is how a queue silently empties itself.
    now = datetime.now(tz=rows[0]["bucket_start"].tzinfo) if rows else None
    payload = [
        (start, link, geom, sev, conf, None if now and end > now else end)
        for start, link, geom, sev, conf, end in incidents
    ]

    await conn.executemany(
        """
        INSERT INTO incidents (detected_at, link_id, geom, incident_type, severity,
                               detection_source, model_confidence, resolved_at, is_synthetic)
        VALUES ($1, $2, ST_GeomFromEWKT($3), 'congestion_anomaly', $4, 'model', $5, $6, TRUE)
        """,
        payload,
    )
    by_band = await conn.fetch(
        "SELECT severity, count(*) FROM incidents WHERE detection_source='model' GROUP BY 1"
    )
    active = await conn.fetchval(
        "SELECT count(*) FROM incidents WHERE resolved_at IS NULL AND detection_source='model'"
    )
    print(f"wrote {len(payload)} incidents  ·  {dict((r[0], r[1]) for r in by_band)}")
    print(f"{active} still open at now()")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
