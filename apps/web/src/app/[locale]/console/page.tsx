import { setRequestLocale } from "next-intl/server";

import { api, apiIsLive } from "@/lib/api";
import { ConsoleShell } from "@/components/console/shell";
import type { SceneLink } from "@/components/city/city-view";

export const dynamic = "force-dynamic";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

export default async function ConsolePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [
    live,
    corridors, summary, cameras, forecast, scene, buildings, blackspots, signals,
    readiness, weather, profile, weekly, incidents, probeCoverage, reliability, accumulation, schemes, cityData,
  ] =
    await Promise.all([
    apiIsLive(),
    api.corridors().catch(() => []),
    // Both of these were bare — an unreachable API took the whole console
    // down with an unhandled rejection instead of degrading like every
    // other call in this list already does.
    api.summary(1).catch(() => ({
      total_vehicles: 0,
      total_pcu: 0,
      class_mix: [],
      peak_hour: null,
      data_quality: { mean_score: 0, bins: 0, suppressed_bins: 0, suppressed_pct: 0 },
      is_synthetic: true,
    })),
    api.cameras().catch(() => []),
    api.forecast().catch(() => ({
      horizons: [],
      model_version: "",
      note: "",
      generated_at: "",
    })),
    api.scene(1).catch(() => ({ links: [] })),
    // Falls back to the captured footprints (ADR-062) rather than to nothing,
    // so an unreachable API costs the map its freshness and not its city.
    // Imported on the failure path only: it is ~300 KB, and the pages without
    // a map on them should not carry it. Resolved here rather than fetched by
    // the client, so the scene mounts once with its geometry already in hand —
    // handed them late, the canvas came back unmeasured and the pane stayed
    // blank on the deployment, which is the bug this whole change exists for.
    fetch(`${BASE}/api/v1/scene/buildings`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("buildings unavailable"))))
      .catch(async () => (await import("@/data/buildings.json")).default),
      api.blackspots(1).catch(() => ({ segments: [], basis: "", note: "" })),
      api.signals().catch(() => ({ advisories: [], method: "", governance: "" })),
      api.readiness().catch(() => ({ sources: [], live_count: 0, total: 0, source_mode: "", note: "" })),
      api.weather().catch(() => ({ available: false })),
      api.dayProfile(1).catch(() => ({ points: [], peak: null, is_synthetic: true,
        calibration: { source: "", morning_peak_pct: 0, evening_peak_pct: 0 } })),
      api.weekly(1).catch(() => ({ matrix: [], days: [], window: "", is_synthetic: true })),
      api.incidentTimeline().catch(() => ({
        hours: [], totals: { crashes: 0, deaths: 0, since: 0, until: 0 }, peak_hour: 0,
        detector: { active: 0, detected_24h: 0, method: "" }, is_synthetic: true,
      })),
      // No probe sweep yet, or the file is missing: the panel hides itself on a
      // null provider rather than rendering a row of dashes.
      api.probeCoverage().catch(() => null),
      // No history yet, or the file is missing: the panel hides itself on an
      // empty corridor list rather than showing four rows of nothing.
      api.reliability().catch(() => null),
      // The headline answer. Null when no sweep is fresh, and the panel
      // says so rather than showing an area list that is quietly stale.
      api.liveAccumulation().catch(() => null),
      api.schemes().catch(() => null),
      api.cityData().catch(() => null),
    ]);

  // The panel cannot detect this itself — a snapshot response is a
  // valid response. Recording it on the object the panel already reads
  // keeps the disclosure next to the sources it qualifies.
  const sources = live ? readiness : { ...readiness, source_mode: "snapshot" };

  return (
    <ConsoleShell
      corridors={corridors}
      summary={summary}
      cameras={cameras}
      forecast={forecast}
      links={(scene.links ?? []) as SceneLink[]}
      buildings={buildings.buildings ?? []}
      blackspots={blackspots}
      signals={signals}
      readiness={sources}
      weather={weather}
      profile={profile}
      weekly={weekly}
      incidents={incidents}
      probeCoverage={probeCoverage}
      reliability={reliability}
      accumulation={accumulation}
      scheme={schemes?.schemes?.[0] ?? null}
      cityData={cityData}
    />
  );
}
