"""Train DRISHTI and hold it to the console's promise.

    uv run python scripts/train_forecast.py [--write]

The console says: "persistence-baseline-0.1.0 — a learned model ships only once
it beats this." This script is the test of that sentence. It trains on an
earlier period, scores both the model and persistence on a later held-out one,
and **refuses to write forecasts unless the model wins by more than 2%**.

Without `--write` it only reports, so the comparison can be run without
touching the warehouse.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from datetime import UTC, datetime, timedelta

import asyncpg
import numpy as np
from dotenv import load_dotenv
from pravaah.drishti.forecast import (
    BASELINE_VERSION,
    HORIZONS,
    MODEL_VERSION,
    Score,
    build_supervised,
    prediction_interval,
)
from sklearn.ensemble import HistGradientBoostingRegressor

BUCKET_MIN = 15


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write forecasts if the gate passes")
    ap.add_argument("--holdout-days", type=int, default=21)
    args = ap.parse_args()

    load_dotenv()
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)

    rows = await conn.fetch(
        """
        SELECT link_id, bucket_start, congestion_index
        FROM link_congestion
        WHERE bucket_start >= now() - INTERVAL '120 days'
        ORDER BY link_id, bucket_start
        """
    )
    print(f"{len(rows):,} buckets")

    by_link: dict[int, list] = {}
    for r in rows:
        by_link.setdefault(int(r["link_id"]), []).append(r)

    cutoff = rows[-1]["bucket_start"] - timedelta(days=args.holdout_days)
    print(f"holdout starts {cutoff:%Y-%m-%d}")

    scores: list[Score] = []
    models: dict[int, HistGradientBoostingRegressor] = {}
    intervals: dict[int, tuple[float, float]] = {}

    for horizon in HORIZONS:
        steps = horizon // BUCKET_MIN
        Xtr, ytr, Xte, yte, base_te = [], [], [], [], []

        for series_rows in by_link.values():
            values = np.array([float(r["congestion_index"]) for r in series_rows])
            times = [r["bucket_start"] for r in series_rows]
            hours = np.array([t.hour + t.minute / 60 for t in times])
            dows = np.array([t.weekday() for t in times])

            X, y, base = build_supervised(values, hours, dows, steps)
            if X.size == 0:
                continue
            # A row belongs to the holdout if its TARGET falls after the cutoff.
            target_times = np.array(times[len(times) - len(y) :])
            is_test = np.array([t >= cutoff for t in target_times])

            Xtr.append(X[~is_test])
            ytr.append(y[~is_test])
            Xte.append(X[is_test])
            yte.append(y[is_test])
            base_te.append(base[is_test])

        Xtr_a, ytr_a = np.vstack(Xtr), np.concatenate(ytr)
        Xte_a, yte_a = np.vstack(Xte), np.concatenate(yte)
        base_a = np.concatenate(base_te)

        model = HistGradientBoostingRegressor(
            max_depth=6, max_iter=300, learning_rate=0.07, random_state=11
        )
        model.fit(Xtr_a, ytr_a)
        predicted = model.predict(Xte_a)

        score = Score(
            horizon_min=horizon,
            model_mae=float(np.abs(predicted - yte_a).mean()),
            baseline_mae=float(np.abs(base_a - yte_a).mean()),
            n=int(yte_a.size),
        )
        scores.append(score)
        models[horizon] = model
        intervals[horizon] = prediction_interval(yte_a - predicted)

        gate = "SHIPS" if score.beats_baseline else "does NOT ship"
        print(
            f"+{horizon:>3} min  model MAE {score.model_mae:6.3f}   "
            f"persistence {score.baseline_mae:6.3f}   "
            f"{score.improvement_pct:+6.1f}%   {gate}   n={score.n:,}"
        )

    passing = [s for s in scores if s.beats_baseline]
    print(f"\n{len(passing)}/{len(scores)} horizons beat persistence by >2%")

    if not args.write:
        print("report only — pass --write to publish forecasts")
        await conn.close()
        return

    if not passing:
        # The console's promise, enforced. Nothing is written and the baseline
        # keeps serving.
        print(f"gate failed: {BASELINE_VERSION} keeps serving, nothing written")
        await conn.close()
        return

    issued = datetime.now(UTC).replace(second=0, microsecond=0)
    payload = []
    for horizon in HORIZONS:
        score = next(s for s in scores if s.horizon_min == horizon)
        if not score.beats_baseline:
            continue  # this horizon stays on the baseline
        low, high = intervals[horizon]
        steps = horizon // BUCKET_MIN
        for link_id, series_rows in by_link.items():
            values = np.array([float(r["congestion_index"]) for r in series_rows])
            times = [r["bucket_start"] for r in series_rows]
            if len(values) < 12:
                continue
            hours = np.array([t.hour + t.minute / 60 for t in times])
            dows = np.array([t.weekday() for t in times])
            X, _, _ = build_supervised(values, hours, dows, steps)
            if X.size == 0:
                continue
            point = float(models[horizon].predict(X[-1:])[0])
            payload.append(
                (
                    issued,
                    link_id,
                    horizon,
                    round(max(0.0, min(100.0, point)), 1),
                    round(max(0.0, point + low), 1),
                    round(min(100.0, point + high), 1),
                    MODEL_VERSION,
                )
            )

    await conn.executemany(
        """
        INSERT INTO forecasts
            (issued_at, link_id, horizon_min, predicted_index, lower_80, upper_80, model_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (issued_at, link_id, horizon_min) DO UPDATE
        SET predicted_index = EXCLUDED.predicted_index,
            lower_80 = EXCLUDED.lower_80,
            upper_80 = EXCLUDED.upper_80,
            model_version = EXCLUDED.model_version
        """,
        payload,
    )
    print(f"wrote {len(payload):,} forecasts as {MODEL_VERSION}")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
