/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source of truth: packages/contracts/src/pravaah/contracts/events.py
 * Regenerate with:  make contracts
 *
 * docs/03 §6 — types are authored once in Pydantic and generated here.
 */

/**
 * Approach direction at a count line. docs/05 §1 `traffic_counts.direction`.
 */
export type Direction = "NB" | "SB" | "EB" | "WB"
/**
 * Why a bin's quality score is what it is. Surfaced in the UI — docs/03 §3
 * requires degradation to be shown, not hidden.
 */
export type QualityFlag =
  "low_light" | "rain" | "fog" | "glare" | "dust" | "occlusion" | "uncalibrated" | "partial_bin" | "camera_moved"
export type ViolationType =
  "red_light" | "speed" | "no_helmet" | "triple_riding" | "wrong_side" | "no_seatbelt" | "lane"

export interface PravaahContracts {
  AlertEvent?: AlertEvent
  AuditEvent?: AuditEvent
  ClassCount?: ClassCount
  CongestionEvent?: CongestionEvent
  CountEvent?: CountEvent
  ForecastEvent?: ForecastEvent
  TurningMovementEvent?: TurningMovementEvent
  ViolationEvent?: ViolationEvent
}
/**
 * Pushed to the dashboard over WebSocket within 2s (docs/03 §4).
 */
export interface AlertEvent {
  schema_version?: "1.0"
  event_id: string
  alert_type: string
  severity: string
  link_id?: number | null
  junction_id?: number | null
  message_key: string
  message_params?: {
    [k: string]: string | number
  }
  occurred_at: string
  is_synthetic?: boolean
}
/**
 * Append-only. docs/07 §5: app roles hold INSERT only — no UPDATE, no
 * DELETE grant. `reason_code` is required for sensitive actions.
 */
export interface AuditEvent {
  schema_version?: "1.0"
  event_id: string
  occurred_at: string
  actor_id: string
  actor_role: string
  action: string
  resource_type: string
  resource_id?: string | null
  reason_code?: string | null
  case_ref?: string | null
  ip_address?: string | null
  request_id?: string | null
}
/**
 * Counts for one vehicle class within one bin, one direction.
 */
export interface ClassCount {
  class_code: string
  vehicle_count: number
  pcu: number
  mean_speed_kmh?: number | null
  p85_speed_kmh?: number | null
}
/**
 * Per-link congestion index. The formula is published (docs/03 §3) — a
 * black-box index is unusable in a policy file; a published one becomes the
 * number everyone quotes.
 */
export interface CongestionEvent {
  schema_version?: "1.0"
  event_id: string
  link_id: number
  bucket_start: string
  congestion_index: number
  vc_ratio?: number | null
  speed_ratio?: number | null
  queue_persistence?: number | null
  probe_delay_s?: number | null
  source_mix?: string[]
  confidence: number
  emitted_at: string
}
/**
 * Emitted once per 5-minute bin, per camera, per direction.
 *
 * `quality_score` drives suppression: bins below the policy threshold are
 * excluded from policy outputs *and the suppression is shown in the UI*
 * rather than hidden (docs/03 §3).
 */
export interface CountEvent {
  schema_version?: "1.0"
  event_id: string
  camera_id: number
  link_id?: number | null
  bucket_start: string
  bucket_seconds?: number
  direction: Direction
  counts: ClassCount[]
  total_pcu: number
  occupancy_pct?: number | null
  queue_length_m?: number | null
  quality_score: number
  quality_flags?: QualityFlag[]
  is_synthetic?: boolean
  model_version: string
  edge_node_id: string
  emitted_at: string
}
/**
 * A forecast is not decision-support without its uncertainty (docs/04 §5),
 * so the 80% interval is required, not optional.
 */
export interface ForecastEvent {
  schema_version?: "1.0"
  event_id: string
  link_id: number
  issued_at: string
  horizon_min: 15 | 30 | 60
  predicted_index: number
  lower_80: number
  upper_80: number
  model_version: string
}
/**
 * Entry-leg x exit-leg matrix for a junction. docs/04 §3 — this is what JDA
 * actually needs for junction redesign, and most ITS deployments never
 * produce it.
 */
export interface TurningMovementEvent {
  schema_version?: "1.0"
  event_id: string
  junction_id: number
  bucket_start: string
  bucket_seconds?: number
  matrix: {
    [k: string]: {
      [k: string]: {
        [k: string]: number
      }
    }
  }
  quality_score: number
  is_synthetic?: boolean
  model_version: string
  emitted_at: string
}
/**
 * A detected violation. Note what is absent: the plate itself.
 *
 * `requires_review` is True whenever OCR confidence is below the gate. A wrong
 * challan is worse than a missed one — it generates a grievance, a news story,
 * and a loss of trust that costs more than the fine (docs/04 §4).
 */
export interface ViolationEvent {
  schema_version?: "1.0"
  event_id: string
  camera_id: number
  link_id?: number | null
  occurred_at: string
  violation_type: ViolationType
  plate_hash: string
  ocr_confidence: number
  detection_confidence: number
  evidence_uri: string
  requires_review: boolean
  is_synthetic?: boolean
  model_version: string
  emitted_at: string
}
