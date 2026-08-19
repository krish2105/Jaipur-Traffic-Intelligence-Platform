/**
 * Typed client for the PRAVAAH API.
 *
 * Every response that carries a measurement also carries its data quality —
 * docs/06 §8: "No naked number ever." The types below make that structural, so
 * a component cannot render a figure without having its quality in hand.
 */

import snapshot from "@/data/snapshot.json";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

/**
 * Captured API responses, keyed by the exact request path.
 *
 * The deployed console rendered 0 for every figure: Vercel cannot reach a
 * `localhost` API, so every call failed and every panel fell back to its
 * "unavailable" shape. That is honest but useless — the platform looked broken
 * rather than merely unhosted.
 *
 * docs/03 §5 already required the demo to render with the network cable
 * pulled, so this is that offline mode rather than a new idea: regenerate with
 * `uv run python scripts/export_snapshot.py` against a live API.
 *
 * It is a fallback, never a preference. A reachable API always wins, so the
 * snapshot cannot mask a backend that is up but wrong.
 */
const SNAPSHOT = snapshot as Record<string, unknown>;

export interface Bilingual {
  en: string;
  hi: string;
}

export interface Corridor {
  corridor_id: number;
  name: Bilingual;
  from_node: string | null;
  to_node: string | null;
  is_model_corridor: boolean;
  link_count: number;
  length_km: number;
}

export interface DataQuality {
  mean_score: number;
  bins: number;
  suppressed_bins: number;
  suppressed_pct: number;
}

export interface ClassMixEntry {
  class_code: string;
  name: Bilingual;
  vehicles: number;
  share: number;
}

export interface IncidentHour {
  hour: number;
  fatal: number;
  grievous: number;
  minor: number;
  congestion?: number;
}

export interface IncidentTimeline {
  hours: IncidentHour[];
  totals: { crashes: number; deaths: number; since: number; until: number };
  peak_hour: number;
  detector: { active: number; detected_24h: number; method: string };
  is_synthetic: boolean;
}

export interface ViolationType {
  violation_type: string;
  total: number;
  pending: number;
  confirmed: number;
  auto_confirmed: number;
  rejected: number;
  mean_confidence: number;
}

export interface EnforcementSummary {
  types: ViolationType[];
  by_hour: number[];
  totals: {
    total: number;
    below_confidence_gate: number;
    auto_confirmed_below_gate: number;
  };
  governance: string;
  is_synthetic: boolean;
}

export interface ShapFactor {
  feature: string;
  direction: string;
  shap_value: number;
}

export interface Defaulter {
  plate_ref: string;
  repeat_risk: number;
  recovery_propensity: number | null;
  severity_score: number | null;
  pending_challans: number;
  pending_amount_inr: number | null;
  explanation: ShapFactor[];
  model_version: string;
}

export interface Defaulters {
  defaulters: Defaulter[];
  basis: string;
  is_synthetic: boolean;
}

export interface Junction {
  junction_id: number;
  name: Bilingual;
  coordinates: [number, number];
  approaches: number;
  signal_type: string;
  congestion: number | null;
}

export interface Junctions {
  junctions: Junction[];
  is_synthetic: boolean;
}

export interface PolicyClass {
  class_code: string;
  name: Bilingual;
  pcu_factor: number;
  vehicles: number;
  pcu: number;
}

export interface PolicyScenario {
  scenario: string;
  targeted_classes: string[];
  removed_share: number;
  pcu_removed: number;
  pcu_removed_pct: number;
  baseline_index: number;
  modelled_index: number;
  baseline_speed_kmh: number;
  modelled_speed_kmh: number;
  note: Bilingual;
  revenue_inr_per_peak_hour?: number;
  price_per_pcu_inr?: number;
}

export interface PolicyScenarios {
  hour: number;
  totals: { vehicles: number; pcu: number; congestion_index: number };
  classes: PolicyClass[];
  scenarios: PolicyScenario[];
  assumptions: { model: string; speed_curve: string; elasticity: string };
  is_synthetic: boolean;
}

export interface EdgeCamera {
  camera_id: number;
  external_ref: string;
  status: string;
  junction: Bilingual;
  vehicles_24h: number;
  observed_minutes: number;
  vehicles_per_minute: number | null;
  quality: number | null;
}

export interface EdgeCameras {
  cameras: EdgeCamera[];
  classes: { class_code: string; name: Bilingual; vehicles: number }[];
  pipeline: {
    detector: string;
    tracker: string;
    runtime: string;
    licence_note: string;
    privacy: string;
    edge_note: string;
  };
  status: string;
  is_synthetic: boolean;
}

export interface SignalDecisionResult {
  audit_id: number;
  recorded_at: string;
  decision: string;
  junction_id: number;
  /** Always false. No code path in this system reaches a signal controller. */
  applied: boolean;
  note: string;
}

export interface AuditEntry {
  audit_id: number;
  occurred_at: string;
  actor: string;
  role: string;
  action: string;
  resource: string;
  reason: string | null;
}

export interface AuditTrail {
  entries: AuditEntry[];
  immutability: string;
}

export interface NeetiQuestion {
  id: string;
  en: string;
  hi: string;
}

export interface NeetiCatalogue {
  questions: NeetiQuestion[];
  planner: string;
  rails: {
    role: string;
    row_cap: number;
    statement_timeout_ms: number;
    ddl_dml: string;
    sql_shown: boolean;
  };
}

export interface NeetiAnswer {
  question: NeetiQuestion;
  sql: string;
  columns: string[];
  rows: Record<string, string | number | null>[];
  row_count: number;
  elapsed_ms: number;
  reading: Bilingual;
  is_synthetic: boolean;
}

export interface AirQuality {
  available: boolean;
  pm2_5?: number | null;
  pm10?: number | null;
  nitrogen_dioxide?: number | null;
  ozone?: number | null;
  us_aqi?: number | null;
  band?: string;
  exceeds_cpcb?: string[];
  standards?: { pm2_5: number; pm10: number; no2: number };
  observed_at?: string;
  provider?: string;
  source_kind?: string;
  traffic_note?: string;
  is_synthetic?: boolean;
}

export interface PublishedSource {
  name: string;
  detail: string;
  url: string;
}

export interface PublishedFigures {
  crashes: {
    by_year: { year: number; accidents: number; deaths: number | null }[];
    total_accidents: number;
    accidents_change_2025_pct: number;
    fatalities_change_2025_pct: number;
    fatality_rate_2025: number;
    rajasthan_severity_rate_pct: number;
    districts_2025: { name: Bilingual; accidents: number; deaths: number | null }[];
    source: PublishedSource;
  };
  congestion: {
    average_pct: number;
    morning_peak_pct: number;
    evening_peak_pct: number;
    rush_hour_speed_kmh: number;
    source: PublishedSource;
  };
  note: string;
  is_synthetic: boolean;
}

export interface RepresentationClass {
  class_code: string;
  name: Bilingual;
  registered: number;
  registered_pct: number;
  on_road_pct: number;
  road_space_pct: number;
  /** >1 means over-represented on this road relative to how many exist. */
  over_representation: number | null;
}

export interface Representation {
  classes: RepresentationClass[];
  fleet_total: number;
  sources: {
    registered: { name: string; url: string; is_synthetic: boolean };
    counted: { name: string; is_synthetic: boolean };
  };
  caveat: string;
}

export interface FairnessClass {
  class_code: string;
  challans: number;
  challan_share_pct: number;
  road_share_pct: number;
  /** >1 means this class carries more enforcement than its road share implies. */
  disparate_impact: number | null;
}

export interface FairnessType {
  violation_type: string;
  total: number;
  attributable_class: string | null;
  mean_confidence: number;
  below_gate_pct: number;
}

export interface FairnessCamera {
  camera_id: number;
  junction: Bilingual;
  violations: number;
  share_pct: number;
}

export interface Fairness {
  classes: FairnessClass[];
  types: FairnessType[];
  cameras: FairnessCamera[];
  camera_concentration: number | null;
  totals: { violations: number; road_vehicles_today: number };
  not_measured: string;
  denominator_note: string;
  is_synthetic: boolean;
}

export interface CountsSummary {
  total_vehicles: number;
  total_pcu: number;
  class_mix: ClassMixEntry[];
  peak_hour: { hour: number; pcu: number } | null;
  data_quality: DataQuality;
  is_synthetic: boolean;
}

export interface ProfilePoint {
  hour: number;
  minute: number;
  index: number;
  confidence: number;
}

export interface DayProfile {
  points: ProfilePoint[];
  peak: ProfilePoint | null;
  is_synthetic: boolean;
  calibration: {
    source: string;
    morning_peak_pct: number;
    evening_peak_pct: number;
  };
}

export interface AccuracyCert {
  day_mape: number;
  night_mape: number;
  per_class: Record<string, number>;
  validated_on: string | null;
  status: string;
  basis: string;
}

export interface Camera {
  camera_id: number;
  external_ref: string;
  source_system: string;
  status: string;
  junction: Bilingual;
  position: { lon: number; lat: number };
  calibrated_at: string | null;
  accuracy_cert: AccuracyCert | null;
  is_synthetic: boolean;
}

export interface ForecastHorizon {
  horizon_min: number;
  predicted_index: number;
  lower_80: number;
  upper_80: number;
  issued_at: string;
}

export interface Forecast {
  horizons: ForecastHorizon[];
  model_version: string;
  note: string;
  generated_at: string;
}

export interface BlackSpot {
  link_id: number;
  name: Bilingual;
  crashes: number;
  deaths: number;
  grievous: number;
  severity_rate: number;
  top_cause: string | null;
  top_light: string | null;
  is_synthetic: boolean;
}

export interface BlackSpots {
  segments: BlackSpot[];
  basis: string;
  note: string;
}

export interface Advisory {
  junction_id: number;
  name: Bilingual;
  signal_type: string;
  measured_pcu_per_hour: number;
  degree_of_saturation: number;
  recommended_cycle_s: number;
  quality: number;
  has_measurement: boolean;
}

export interface SignalAdvisory {
  advisories: Advisory[];
  method: string;
  governance: string;
}

export interface SourceRow {
  id: string;
  name: string;
  provider: string;
  mode: "live" | "replay";
  detail: string;
  needs: string | null;
}

export interface SourceReadiness {
  sources: SourceRow[];
  live_count: number;
  total: number;
  source_mode: string;
  note: string;
}

export interface WeatherNow {
  available: boolean;
  temperature_c?: number;
  precipitation_mm?: number;
  visibility_m?: number | null;
  wind_kmh?: number;
  is_day?: boolean;
  summary?: string;
  degrades_counting?: boolean;
  observed_at?: string;
  provider?: string;
}

export interface WeeklyMatrix {
  matrix: number[][];
  days: string[];
  window: string;
  is_synthetic: boolean;
}

/** Jaipur's published severity gap. The one payload with no synthetic data in it. */
export interface SeverityFinding {
  crashes: { year: number; count: number; prev: number; change_pct: number };
  deaths: {
    year: number; count: number; prev: number;
    prev_is_derived: boolean; change_pct: number;
  };
  fatality_rate_per_100: number;
  fatality_rate_is_five_year_high: boolean;
  enforcement: {
    mix_pct: Record<string, number>;
    challans_2025: number;
    challans_2024: number;
    recovery_rate_pct: number;
    jaipur_fine_revenue_cr: number;
  };
  severity_drivers: {
    helmet_fatality_share_pct: number;
    unhelmeted_share_of_2w_deaths_pct: number;
    two_wheeler_crash_share_pct: number;
  };
  argument: Bilingual;
  sources: Record<string, { title: string; url: string; accessed: string; note: string }>;
  is_synthetic: boolean;
}

/** The reallocation, with the model that produced it attached. */
export interface EnforcementAllocation {
  current_pct: Record<string, number>;
  recommended_pct: Record<string, number>;
  delta_pct: Record<string, number>;
  marginal_return_now: Record<string, number>;
  lives_per_year: { current: number; recommended: number; gain: number };
  assumptions: {
    attributable_fractions: Record<string, number>;
    saturation_k: number;
    floor_share: number;
    fractions_overlap: boolean;
    combination: string;
    basis_deaths: number;
    basis_year: number;
  };
  sensitivity: { k: number; helmet_share_pct: number; lives: number }[];
  robustness: {
    holds_for_k: number[];
    fails_for_k: number[];
    holds_above_k: number | null;
    note: string;
  };
  is_synthetic: boolean;
}

/** Calibrated severity risk. Carries its own model, not just its answer. */
export interface SeverityModel {
  anchor: {
    observed_deaths_per_100_crashes: number;
    year: number;
    source: string;
    calibration_residual: number;
  };
  two_wheeler_odds_ratio: {
    aggregate: number;
    unhelmeted_low: number;
    unhelmeted_high: number;
    derived_from: string;
  };
  assumptions: Record<string, { low: number; high: number; basis: string; is_assumption: boolean }>;
  scenarios: Record<string, { deaths_per_100_crashes: number; ci_low: number; ci_high: number }>;
  hour_effect: {
    available: boolean;
    loo_mae?: number;
    loo_mae_relative?: number;
    peak_hour?: number;
    n_hours?: number;
    fitted_on?: string;
    is_synthetic_input?: boolean;
  };
  method: string;
  upgrade_path: string;
  draws: number;
  is_synthetic: boolean;
  is_fitted: boolean;
}

/** One screening area: a thana catchment or a Commissionerate zone. */
export interface Area {
  name: string;
  kind: "thana_catchment" | "commissionerate_zone";
  station: { lon: number; lat: number } | null;
  links: number;
  links_modelled: number;
  links_measured: number;
  vehicles_per_hour: number;
  pcu_per_hour: number;
  /** null means not measured, which is not the same as zero. */
  mean_congestion: number | null;
  max_congestion: number | null;
  worst_link: {
    link_id: number | string;
    name: string | null;
    congestion_index: number;
    speed_kmh: number;
  } | null;
  coverage: number;
}

export interface AreaScreening {
  zones: Area[];
  thanas: Area[];
  cordon_plan: {
    area: string;
    cordon_links: number;
    cameras_needed: number;
    cumulative_cameras: number;
  }[];
  stations_total: number;
  links_total: number;
  boundary_basis: string;
  cordon_note: string;
  cordon_caveat?: string;
  coverage_note: string;
  vehicle_counts_available: boolean;
  vehicle_count_note: string;
  is_synthetic: boolean;
}

/** Cordon accumulation: how many vehicles are inside an area, hour by hour. */
export interface AreaAccumulation {
  method: string;
  areas: {
    area: string;
    cordon_cameras: number;
    peak_inside: number;
    peak_hour: number;
    mean_inside: number;
    resident_baseline: number;
    conserved: boolean;
    hourly: number[];
    drift: Record<
      string,
      { phantom_vehicles_per_day: number; reanchor_every_hours: number | null }
    >;
  }[];
  drift_note: string;
  flow_is_synthetic: boolean;
  flow_note: string;
  is_synthetic: boolean;
}

/**
 * The demo role, read from the session at call time.
 *
 * Sent as `X-Demo-Role`, which the API accepts ONLY while DEMO_MODE is on and
 * refuses with a 403 otherwise. In deployment this is replaced by the Keycloak
 * bearer token and the header stops existing — the server already treats its
 * presence in production as an error rather than ignoring it, which is the
 * difference between a demo affordance and an authentication bypass.
 *
 * Read per request rather than captured once: an officer switching role in the
 * demo must see the next request answered as the new role, not the old one.
 */
function demoRoleHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("pravaah-session");
    if (!raw) return {};
    const role = (JSON.parse(raw) as { role?: string }).role;
    return role ? { "X-Demo-Role": role } : {};
  } catch {
    return {};
  }
}

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${BASE}/api/v1${path}`, {
      // Measurements move every five minutes; a stale dashboard is a wrong one.
      cache: "no-store",
      ...init,
      headers: { ...demoRoleHeader(), ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      throw new Error(`PRAVAAH API ${path} responded ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    const frozen = SNAPSHOT[path];
    // Rethrowing when there is no snapshot is deliberate: the caller's own
    // `.catch()` still produces the empty state, and a path nobody captured
    // stays visibly missing instead of silently resolving to something stale.
    if (frozen === undefined) throw error;
    return frozen as T;
  }
}

/**
 * Whether the live API answered, resolved once per render.
 *
 * The snapshot is indistinguishable from live data by inspection — that is the
 * point of capturing it — so the page has to ask separately in order to label
 * it. Without this the deployment would present four-month-old figures as
 * current, which is the precise failure docs/06 §8 exists to prevent.
 */
export async function apiIsLive(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/api/v1/meta/sources`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** When the bundled snapshot was captured, for the label that says so. */
export const SNAPSHOT_CAPTURED_AT: string =
  (SNAPSHOT["/meta/published"] as { generated_at?: string } | undefined)?.generated_at ?? "";

/** POST, for the few actions that record a human decision. */
export async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...demoRoleHeader() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = `responded ${response.status}`;
    try {
      detail = ((await response.json()) as { detail?: string }).detail ?? detail;
    } catch {
      // A non-JSON error body is still an error; the status carries it.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
};

export const api = {
  corridors: () => get<Corridor[]>("/corridors"),
  severity: () => get<SeverityFinding>("/safety/severity"),
  areas: () => get<AreaScreening>("/areas"),
  accumulation: () => get<AreaAccumulation>("/areas/accumulation"),
  severityModel: () => get<SeverityModel>("/safety/severity-model"),
  allocation: () => get<EnforcementAllocation>("/enforcement/allocation"),
  // Routed through get() rather than fetched raw in the page, so the 3D scene
  // falls back to the snapshot like every other panel. Fetched directly, it
  // was the one call that still went dark on a deployment with no API.
  scene: (corridorId = 1) => get<{ links: unknown[] }>(`/scene?corridor_id=${corridorId}`),
  summary: (corridorId?: number, date?: string) =>
    get<CountsSummary>(`/counts/summary${query({ corridor_id: corridorId, date })}`),
  dayProfile: (corridorId?: number, date?: string) =>
    get<DayProfile>(`/congestion/day-profile${query({ corridor_id: corridorId, date })}`),
  cameras: () => get<Camera[]>("/cameras"),
  forecast: (linkId?: number) => get<Forecast>(`/forecast${query({ link_id: linkId })}`),
  blackspots: (corridorId?: number) =>
    get<BlackSpots>(`/safety/blackspots${query({ corridor_id: corridorId })}`),
  signals: () => get<SignalAdvisory>("/signals/advisory"),
  readiness: () => get<SourceReadiness>("/meta/sources"),
  weather: () => get<WeatherNow>("/meta/weather"),
  air: () => get<AirQuality>("/meta/air"),
  published: () => get<PublishedFigures>("/meta/published"),
  weekly: (corridorId?: number) =>
    get<WeeklyMatrix>(`/congestion/weekly${query({ corridor_id: corridorId })}`),
  incidentTimeline: () => get<IncidentTimeline>("/incidents/timeline"),
  enforcement: () => get<EnforcementSummary>("/enforcement/summary"),
  fairness: () => get<Fairness>("/enforcement/fairness"),
  defaulters: (limit = 10) => get<Defaulters>(`/enforcement/defaulters?limit=${limit}`),
  junctions: () => get<Junctions>("/junctions"),
  edge: () => get<EdgeCameras>("/edge/cameras"),
  audit: () => get<AuditTrail>("/audit/recent"),
  neetiQuestions: () => get<NeetiCatalogue>("/neeti/questions"),
  neetiAsk: (id: string) => get<NeetiAnswer>(`/neeti/ask?question_id=${encodeURIComponent(id)}`),
  decideSignal: (body: {
    junction_id: number;
    decision: "accepted" | "rejected" | "deferred";
    note: string;
    cycle_s: number;
  }) => post<SignalDecisionResult>("/signals/decision", body),
  representation: (corridorId = 1) =>
    get<Representation>(`/policy/representation?corridor_id=${corridorId}`),
  policy: (corridorId = 1) =>
    get<PolicyScenarios>(`/policy/scenarios?corridor_id=${corridorId}`),
};

/**
 * The published congestion ramp (docs/06 §1). Fixed, identical everywhere, and
 * never used for anything but congestion and severity — the moment sindoor
 * appears on a "Save" button the whole safety layer loses its signal.
 */
export function congestionVar(index: number): string {
  if (index <= 25) return "var(--congestion-free)";
  if (index <= 50) return "var(--congestion-light)";
  if (index <= 70) return "var(--congestion-moderate)";
  if (index <= 85) return "var(--congestion-severe)";
  return "var(--congestion-critical)";
}

export function congestionBandKey(index: number): string {
  if (index <= 25) return "free";
  if (index <= 50) return "light";
  if (index <= 70) return "moderate";
  if (index <= 85) return "severe";
  return "critical";
}
