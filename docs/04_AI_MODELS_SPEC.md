# 04 — AI / ML / DL / CV / NLP Model Specifications

Hardware assumption throughout: training on RTX 3060 12GB, dev on M4 Pro, inference target Jetson Orin Nano. Anything that doesn't fit is flagged.

---

## 1. Model inventory

| ID | Model | Task | Family | Where it runs |
|---|---|---|---|---|
| M1 | Vehicle detector | Detection | RT-DETRv2 (Apache-2.0) | Edge |
| M2 | Multi-object tracker | Tracking | ByteTrack | Edge |
| M3 | IRC class head | Classification | EfficientNet-B0 / ConvNeXt-T | Edge |
| M4 | Plate detector + OCR | ANPR | Detector + PARSeq | Edge |
| M5 | Violation classifiers | Multi-label | Shared backbone, multi-head | Edge |
| M6 | Vehicle re-ID | Metric learning | OSNet | Core |
| M7 | Congestion forecaster | Spatio-temporal | Graph WaveNet / STGCN | Core |
| M7b | Forecast baseline | Tabular | LightGBM + persistence | Core |
| M8 | Incident detector | Anomaly → supervised | Isolation Forest → LightGBM | Core |
| M9 | Severity risk | Tabular | XGBoost + SHAP | Core |
| M10 | Signal policy | MARL | MAPPO in SUMO | Core (advisory) |
| M11 | Defaulter risk | Tabular | LightGBM + SHAP | Core |
| M12 | Recovery propensity | Tabular | Calibrated LightGBM | Core |
| M13 | Complaint triage | Bilingual NLP | MuRIL / IndicBERTv2 | Core |
| M14 | Retrieval | Bilingual embedding | multilingual-e5 / IndicSBERT | Core |
| M15 | Policy synthesis | LLM | Claude (hosted) / Llama-3.x-Indic (on-prem) | Core |

---

## 2. M1 — Vehicle detection

**Why RT-DETRv2 over YOLO.** Ultralytics ships AGPL-3.0. For a system intended for government deployment, that is a procurement risk and a legal exposure that a system integrator's counsel will find. RT-DETRv2 is Apache-2.0, transformer-based, NMS-free, and competitive at the accuracy/latency point we need. Use Ultralytics for rapid local experiments only, marked as such, never in shippable code.

**Classes (IRC-aligned, 12):** two-wheeler, auto-rickshaw, e-rickshaw, car/jeep/van, taxi, LCV, bus, mini-bus, truck (2-axle), truck (multi-axle), tractor/farm, non-motorised (cycle/cart/animal-drawn).

**PCU factors** (IRC:106 basis, tune to local observation and document the tuning):
2W 0.25 · auto 0.5 · e-rickshaw 0.5 · car 1.0 · LCV 1.5 · bus 3.0 · truck 3.0 · multi-axle 4.5 · tractor 4.0 · NMV 0.5

**Data strategy — this is the hard part, plan real time for it:**
1. Pre-train on public: IDD (Indian Driving Dataset), IDD-Detection, BDD100K, UA-DETRAC, VisDrone
2. Fine-tune on Jaipur footage — target 8,000–12,000 annotated frames sampled across day/night, dry/wet, four seasons and at least six junction geometries
3. Annotate in CVAT or Label Studio. Budget 40–60 hours. There is no shortcut; this is where the accuracy comes from.
4. Augment hard: motion blur, rain streaks, low light, dust haze, JPEG artefacts, heavy occlusion crops

**The two-wheeler problem, explicitly.** Indian fleets are 2W-dominant, 2W occlude each other constantly, they filter between lanes, and COCO-pretrained detectors are weakest on exactly this class. Published edge-deployment work has reported motorcycle detection accuracy in the low 20s percent while cars sat around 70% — that gap will destroy your counts if unaddressed. Mitigations: oversample 2W crops in training, use a smaller anchor/query scale, evaluate 2W separately and gate release on 2W recall ≥93%, and consider a dedicated high-resolution 2W head.

**Training config:** input 960×960, batch 4 with gradient accumulation to effective 16, AdamW, cosine schedule, 100 epochs, AMP, EMA. Roughly 10–14 hours on a 3060 — run it overnight.

**Export:** PyTorch → ONNX → TensorRT INT8 with calibration set. Verify accuracy delta post-quantisation is under 2% mAP; if it isn't, fall back to FP16.

**Eval:** mAP@0.5, mAP@0.5:0.95, per-class AP, plus a night/rain/dense-traffic breakdown. **Publish per-condition numbers in the UI.** Honest degradation reporting is a credibility asset in government, not a weakness.

---

## 3. M2 — Tracking and counting

**ByteTrack**, class-aware, because it handles low-confidence detections well — which is precisely the dense-occluded-2W case. Tune: high threshold 0.6, low 0.1, match threshold 0.8, track buffer 30 frames.

**Counting geometry.** Virtual lines per approach for through-movement plus polygon zones for turning movements. A vehicle counts when its track's centroid crosses a line with a consistent direction vector across at least three frames — the three-frame rule kills the double-count that occurs when a track jitters across the boundary.

**Turning movement counts.** Entry zone × exit zone gives you the movement matrix per junction. This is what JDA actually needs for junction redesign and it is a genuinely differentiated output — most ITS deployments never produce it.

**Speed.** Homography-projected ground-plane displacement over a known time delta, median-filtered across the track. Calibrate per camera with at least four known ground reference points. **Never report pixel-space speed.** A traffic engineer will ask how you calibrated within ninety seconds of seeing a speed number; have the answer.

**Queue length.** Occupancy-based: count stationary tracks (speed < 2 km/h) contiguously back from the stop line, project to metres via homography.

**Validation protocol (do this, it is what makes the whole system credible):** for each camera, manually count three 15-minute windows — morning peak, midday, evening peak. Compute MAPE per class. Store as the camera's accuracy certificate. Display it in the UI next to that camera's numbers. A system that tells you it is 94% accurate is trusted; a system that claims perfection is not.

---

## 4. M4 — ANPR (feeds KAVACH-E)

Two stage: plate detection (small RT-DETR head) → rectification → recognition (PARSeq or TrOCR fine-tuned).

**Indian plate specifics:** both Latin and Devanagari appear; formats vary (`RJ14AB1234`, BH-series, older formats); commercial plates are yellow, EV plates green, military and diplomatic differ; fancy fonts, decorative frames, mud, and deliberate obscuring are common. Validate output against the state RTO code table (RJ01–RJ58) and reject structurally impossible reads rather than emitting garbage.

**Confidence gating:** below 0.85 confidence, do not emit a violation. Route to a human review queue. **A wrong challan is worse than a missed one** — it generates a grievance, a news story, and a loss of trust that costs more than the fine. Encode this as a hard threshold, not a tunable.

**Privacy:** plate strings are encrypted at rest with a separate key, decrypted only on authorised access, and every decryption is audit-logged. See doc 07.

---

## 5. M7 — Congestion forecasting

**Graph construction.** Nodes are road links from the JDA/OSM network; edges are connectivity weighted by inverse travel time. Node features: measured volume, PCU, speed, occupancy, queue, time-of-day sin/cos, day-of-week, holiday flag, weather, event flag.

**Model:** Graph WaveNet (adaptive adjacency plus dilated causal convolutions) — it learns spatial dependencies the physical graph doesn't encode, which matters when a jam at Gopalpura propagates to Tonk Road via routes the adjacency matrix doesn't capture.

**Ship discipline:** build persistence and LightGBM baselines *first*. The GNN ships only if it beats both at 15, 30 and 60 minutes on held-out weeks. If it doesn't, ship the baseline and say so in the pitch — "we tested a graph neural network and it didn't beat a simpler model, so we shipped the simpler model" is a sentence that builds enormous credibility with technical evaluators and costs you nothing.

**Eval:** MAE, RMSE, MAPE per horizon; separate peak/off-peak; separate normal/incident conditions. Report prediction intervals, not point estimates. A forecast without uncertainty is not decision-support.

---

## 6. M9 — Severity risk (the differentiator)

**Target:** probability that a crash on this segment, in these conditions, is fatal or serious — not crash frequency. This is built directly on the finding that Jaipur crashes fell 5.6% while deaths rose 3.1%.

**Features:** geometry (curvature, gradient, width, median presence, access density), speed distribution (mean, 85th percentile, variance — variance matters more than mean for severity), vehicle mix (heavy-vehicle share, 2W share), light and weather, junction density, crash history, land use, pedestrian activity.

**Model:** XGBoost with monotonic constraints where domain knowledge demands them (e.g. speed variance must not decrease risk), SHAP for explanation.

**Output:** a ranked list of segments with the top three contributing factors and a specific suggested countermeasure per segment. "Segment 47 is high-risk because of 85th-percentile speed of 71 km/h, 18% heavy-vehicle share, and no median — consider speed enforcement plus median installation" is an actionable output. A risk score alone is not.

Class imbalance is severe. Use focal loss or scale_pos_weight, evaluate with PR-AUC not ROC-AUC, and calibrate probabilities with isotonic regression.

---

## 7. M10 — Signal control (advisory only)

**Environment:** SUMO network of the Tonk Road model corridor, calibrated to measured counts. **Calibration gate:** simulated volumes must be within 10% of measured, and simulated travel times within 15%, before any policy result is reportable. Without that gate, the simulation is a video game.

**Algorithm:** MAPPO, one agent per junction, with a shared critic. State: queue length and volume per approach, current phase, elapsed phase time, neighbour states. Action: extend / switch phase (discrete, with minimum-green and maximum-red safety constraints hard-coded into the environment, not learned). Reward: negative total delay, with a pedestrian-wait penalty and a fairness term across approaches.

**Baselines to beat:** fixed-time, Webster's method, and max-pressure control. Max-pressure especially — it is simple, near-optimal in theory, needs no training, and a good MARL result must beat it or the MARL is not worth deploying.

**Deployment stance — repeat this in the pitch verbatim:** the model produces a *recommended* signal plan. A traffic engineer reviews it. A human applies it. There is no path from model output to signal actuation in v1. This is both the ethically correct position and the one that makes approval possible; an official who hears "the AI will control the lights" hears "the AI will be blamed for a crash."

---

## 8. M11/M12 — Defaulter intelligence

**M11 repeat-offender risk.** Features: violation count and mix, severity weighting, temporal clustering, spatial pattern, vehicle age and class, days since last violation, payment history. Deliberately *excluded*: owner name, address, and any proxy for community, religion or caste. Document the exclusion list in the model card — you will be asked.

**M12 recovery propensity.** Calibrated probability that a pending challan is recoverable, so limited enforcement effort targets the recoverable. Reframes the module from punishment to efficiency, which is a much easier sell.

**Fairness monitoring (mandatory, computed and displayed):** demographic parity across RTO zones, equalised odds across vehicle classes, and a geographic concentration index. If the model recommends interception at a rate 3× higher in one zone, that is either a real finding or a bias — either way it must be visible on screen before anyone acts on it.

**Interception planning.** Given risk-ranked vehicles with spatiotemporal patterns, a coverage-maximisation optimisation over candidate checkpoints, subject to available officer count. Frame the output as expected safety impact, not expected revenue. Both the framing and the objective function.

---

## 9. NEETI — Bilingual NLP stack

**M13 complaint triage.** Fine-tune MuRIL on traffic complaints from Rajasthan Sampark, 1090, social media. Labels: category (congestion / signal fault / encroachment / parking / road condition / safety), urgency, location extraction, sentiment. Handles Devanagari, romanised Hindi, and code-mixed input — all three appear constantly and a model trained only on clean Devanagari will fail on the actual data.

**M14 retrieval.** Hybrid: BM25 (with a Hindi analyser) plus multilingual-e5-large dense vectors in pgvector, fused with reciprocal rank fusion, reranked by a cross-encoder. Cross-lingual by construction — a Hindi query must retrieve English IRC documents.

**M15 synthesis.** Claude for the hosted demo; Llama-3.x-Indic or Sarvam for an on-prem story (have this answer ready — "can it run inside our network without calling a foreign API?" is a certainty in a government room, and "yes, here is the on-prem model path" wins it).

**Agent tools:** `query_warehouse` (text-to-SQL over a governed semantic layer, read-only role, statement timeout, allowlisted tables), `search_documents`, `run_simulation`, `generate_chart`, `compare_periods`.

**The anti-hallucination gate.** Do not rely on prompting. Implement a numeric verification pass: after generation, extract every numeral from the output and verify each against the tool-call result set. Any unverifiable number blocks rendering and triggers a regeneration. In a government context a hallucinated statistic is not an inconvenience, it is the end of the project.

**Text-to-SQL safety:** read-only database role, allowlisted schema, statement timeout, row limit, no DDL, no DML, generated SQL logged and shown to the user on request.

---

## 10. MLOps

| Concern | Tool | Rule |
|---|---|---|
| Experiments | MLflow | Every run logged; no untracked training |
| Registry | MLflow | Staging → Production with a human promotion gate |
| Versioning | DVC | Data and models versioned with the code that made them |
| Drift | Evidently | Weekly on features and predictions; alert on threshold |
| Model cards | Markdown in `ml/cards/` | Purpose, data, metrics, limitations, fairness, excluded features |
| Reproducibility | Seeded configs | Any result must reproduce from `ml/configs/` |

**Retraining triggers:** accuracy drops >5% against the validation certificate; feature drift over threshold; new camera or changed camera angle; seasonal boundary; 3 months elapsed.

**Every model ships with a model card.** In a government deployment this is not documentation hygiene, it is the artefact that answers an audit.

---

## 11. Evaluation summary

| Model | Primary metric | Gate |
|---|---|---|
| M1 detection | mAP@0.5 | ≥0.85 overall; 2W AP ≥0.80 |
| M2 counting | MAPE vs manual | ≤8% day, ≤15% night |
| M3 classification | Macro-F1 | ≥0.90; 2W recall ≥0.93 |
| M4 ANPR | Char accuracy | ≥0.95 above conf. gate |
| M7 forecast | MAE @30 min | Beats persistence and LightGBM |
| M8 incident | Detection latency / FPR | ≤2 min; ≤2 false alarms/day/corridor |
| M9 severity | PR-AUC | ≥0.65, calibrated |
| M10 signal | Delay reduction in sim | Beats max-pressure |
| M11 defaulter | PR-AUC + fairness | ≥0.70; parity within tolerance |
| M13 triage | Macro-F1 | ≥0.85 across all three script forms |
| NEETI | Faithfulness | 100% numeric verification, zero unsourced figures |
