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

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    // Measurements move every five minutes; a stale dashboard is a wrong one.
    cache: "no-store",
    ...init,
  });
  if (!response.ok) {
    throw new Error(`PRAVAAH API ${path} responded ${response.status}`);
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
  weekly: (corridorId?: number) =>
    get<WeeklyMatrix>(`/congestion/weekly${query({ corridor_id: corridorId })}`),
  incidentTimeline: () => get<IncidentTimeline>("/incidents/timeline"),
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
