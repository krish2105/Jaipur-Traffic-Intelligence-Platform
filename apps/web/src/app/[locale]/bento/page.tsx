import { setRequestLocale } from "next-intl/server";

import { api } from "@/lib/api";
import { BentoShell } from "@/components/console/bento";
import type { SceneLink } from "@/components/city/city-view";

export const dynamic = "force-dynamic";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

/** The bento layout, over exactly the same data and panels as /console. */
export default async function BentoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [
    corridors, summary, cameras, forecast, scene, buildings, blackspots, signals,
    readiness, weather, incidents,
  ] = await Promise.all([
    api.corridors().catch(() => []),
    // Both of these were bare — same fault as /console: an unreachable API
    // took the whole page down with an unhandled rejection instead of
    // degrading like every other call in this list already does.
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
    fetch(`${BASE}/api/v1/scene?corridor_id=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .catch(() => ({ links: [] })),
    fetch(`${BASE}/api/v1/scene/buildings`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { buildings: [] }))
      .catch(() => ({ buildings: [] })),
    api.blackspots(1).catch(() => ({ segments: [], basis: "", note: "" })),
    api.signals().catch(() => ({ advisories: [], method: "", governance: "" })),
    api.readiness().catch(() => ({ sources: [], live_count: 0, total: 0, source_mode: "", note: "" })),
    api.weather().catch(() => ({ available: false })),
    api.incidentTimeline().catch(() => ({
      hours: [], totals: { crashes: 0, deaths: 0, since: 0, until: 0 }, peak_hour: 0,
      detector: { active: 0, detected_24h: 0, method: "" }, is_synthetic: true,
    })),
  ]);

  return (
    <BentoShell
      corridors={corridors}
      summary={summary}
      cameras={cameras}
      forecast={forecast}
      links={(scene.links ?? []) as SceneLink[]}
      buildings={buildings.buildings ?? []}
      blackspots={blackspots}
      signals={signals}
      readiness={readiness}
      weather={weather}
      incidents={incidents}
    />
  );
}
