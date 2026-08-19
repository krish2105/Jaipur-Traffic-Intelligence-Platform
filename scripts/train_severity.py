"""Fit the KAVACH severity model and populate `segment_risk`.

    uv run python scripts/train_severity.py [--holdout-year 2025]

**The target is fatality, not injury.** "Fatal or grievous" covers 86% of
crashes here, which leaves a model almost no room to discriminate and produces a
score that is high everywhere and therefore useless for ranking. A department
allocating a countermeasure budget is choosing where people die, so that is what
this predicts.

Trained on earlier years and evaluated on a held-out later one, not on a random
split. Crash data has a time trend — Jaipur's fatality rate rose over this
period — and a random split lets the model see the future of the very trend it
is being asked to learn, which flatters the score and teaches nothing.

The comparison that matters is against **base rate**, printed alongside. A
model that cannot beat "assume every crash is severe" on a dataset where 78% of
crashes are severe is not a model, and shipping one because it scored 0.78
accuracy is the classic way an ML feature reaches production doing nothing.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import date

import asyncpg
import numpy as np
from dotenv import load_dotenv
from pravaah.kavach.severity import (
    FEATURES,
    SegmentRisk,
    band_for,
    countermeasures_for,
    top_factors_from_shap,
)
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score

MODEL_VERSION = "kavach-severity-0.1.0"

_CRASHES = """
    SELECT c.crash_id,
           c.link_id,
           extract(year FROM c.occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS year,
           (c.light_condition = 'night')::int                       AS is_night,
           COALESCE(l.free_flow_speed_kmh, 50)::float               AS speed_limit_kmh,
           COALESCE(l.lanes, 2)::float                              AS lanes,
           COALESCE(l.has_median, false)::int                       AS is_divided,
           (c.vehicle_classes_involved && ARRAY['TRK2','TRKM','BUS','LCV'])::int
                                                                    AS heavy_vehicle_involved,
           (c.vehicle_classes_involved && ARRAY['NMV'])::int        AS pedestrian_involved,
           (c.vehicle_classes_involved && ARRAY['2W'])::int         AS two_wheeler_involved,
           (c.primary_cause = 'over_speeding')::int                 AS cause_over_speeding,
           (c.primary_cause = 'wrong_side')::int                    AS cause_wrong_side,
           (c.primary_cause = 'drunk_driving')::int                 AS cause_drunk_driving,
           (c.primary_cause = 'pedestrian_crossing')::int           AS cause_pedestrian_crossing,
           (c.weather IN ('rain','fog'))::int                       AS is_wet,
           (c.fatalities > 0)::int                                  AS severe
    FROM crashes c
    JOIN road_links l ON l.link_id = c.link_id
"""


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout-year", type=int, default=2025)
    args = ap.parse_args()

    load_dotenv()
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    rows = await conn.fetch(_CRASHES)
    print(f"{len(rows):,} crashes with a link and full features")

    X = np.array([[float(r[f]) for f in FEATURES] for r in rows], dtype=np.float64)
    y = np.array([int(r["severe"]) for r in rows], dtype=np.int64)
    years = np.array([int(r["year"]) for r in rows])
    links = np.array([int(r["link_id"]) for r in rows])

    train = years < args.holdout_year
    test = ~train
    print(f"train {train.sum():,} (< {args.holdout_year})   holdout {test.sum():,}")

    model = HistGradientBoostingClassifier(
        max_depth=4,
        max_iter=220,
        learning_rate=0.06,
        l2_regularization=1.0,
        random_state=7,
    )
    model.fit(X[train], y[train])

    probability = model.predict_proba(X[test])[:, 1]
    base_rate = float(y[train].mean())
    auc = roc_auc_score(y[test], probability)
    ap_score = average_precision_score(y[test], probability)
    print(f"\nholdout ROC-AUC {auc:.3f}   PR-AUC {ap_score:.3f}   base rate {base_rate:.3f}")
    # A model at chance is worth knowing about before it reaches a screen.
    verdict = "beats base rate" if ap_score > base_rate + 0.01 else "NO BETTER THAN BASE RATE"
    print(f"verdict: {verdict}")

    # SHAP over the full set. HistGradientBoosting exposes an exact tree
    # attribution through shap's TreeExplainer, so these are the model's real
    # contributions rather than a permutation approximation.
    import shap

    explainer = shap.TreeExplainer(model)
    shap_values = np.asarray(explainer.shap_values(X))
    if shap_values.ndim == 3:  # (n, features, classes)
        shap_values = shap_values[:, :, 1]

    all_probability = model.predict_proba(X)[:, 1]

    # Aggregate to the link: mean severity probability across that link's own
    # crashes, and the mean SHAP vector, so the explanation describes the link
    # rather than one arbitrary crash on it.
    results: list[SegmentRisk] = []
    for link_id in np.unique(links):
        mask = links == link_id
        count = int(mask.sum())
        risk = float(all_probability[mask].mean())
        factors = top_factors_from_shap(shap_values[mask].mean(axis=0), FEATURES)
        results.append(
            SegmentRisk(
                link_id=int(link_id),
                severity_risk=risk,
                risk_band=band_for(risk, base_rate),
                top_factors=factors,
                countermeasures=countermeasures_for(factors),
                crash_count=count,
            )
        )

    today = date.today()
    await conn.execute("DELETE FROM segment_risk WHERE computed_on = $1", today)
    await conn.executemany(
        """
        INSERT INTO segment_risk
            (computed_on, link_id, severity_risk, risk_band, top_factors,
             recommended_countermeasures, model_version)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        """,
        [
            (
                today,
                r.link_id,
                round(r.severity_risk, 3),
                r.risk_band,
                json.dumps([f.as_json() for f in r.top_factors]),
                list(r.countermeasures),
                MODEL_VERSION,
            )
            for r in results
        ],
    )

    bands = await conn.fetch(
        "SELECT risk_band, count(*) FROM segment_risk WHERE computed_on = $1 GROUP BY 1",
        today,
    )
    print(f"\nwrote {len(results)} segments  ·  {dict((b[0], b[1]) for b in bands)}")
    worst = sorted(results, key=lambda r: r.severity_risk, reverse=True)[:5]
    print("\nhighest severity risk:")
    for r in worst:
        drivers = ", ".join(f"{f.label_en} {f.direction}" for f in r.top_factors[:2])
        print(f"  link {r.link_id:<6} {r.severity_risk:.3f} {r.risk_band:<9} {drivers}")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
