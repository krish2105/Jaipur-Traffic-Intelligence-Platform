/**
 * Typed client for the PRAVAAH API.
 *
 * Every response that carries a measurement also carries its data quality —
 * docs/06 §8: "No naked number ever." The types below make that structural, so
 * a component cannot render a figure without having its quality in hand.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

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
}

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
