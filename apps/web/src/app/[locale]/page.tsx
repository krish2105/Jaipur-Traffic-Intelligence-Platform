import { setRequestLocale } from "next-intl/server";

import { api } from "@/lib/api";
import { LandingView } from "@/components/landing/landing-view";

export const dynamic = "force-dynamic";

/** The landing page runs on the same endpoints as the console, deliberately:
 *  no marketing copy can then hold a figure the product would contradict. */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [summary, profile, incidents, policy, severity, allocation, severityModel] = await Promise.all([
    // `.catch()` here matches the other three calls below. Its absence was
    // the actual production bug: one unreachable call took the whole
    // Server Component down with an unhandled rejection (a bare 500, no
    // digest a reader could act on) instead of the page degrading like its
    // siblings already do.
    api.summary(1).catch(() => ({
      total_vehicles: 0,
      total_pcu: 0,
      class_mix: [],
      peak_hour: null,
      data_quality: { mean_score: 0, bins: 0, suppressed_bins: 0, suppressed_pct: 0 },
      is_synthetic: true,
    })),
    api.dayProfile(1).catch(() => ({
      points: [],
      peak: null,
      is_synthetic: true,
      calibration: { source: "", morning_peak_pct: 0, evening_peak_pct: 0 },
    })),
    api.incidentTimeline().catch(() => ({
      hours: [],
      totals: { crashes: 0, deaths: 0, since: 0, until: 0 },
      peak_hour: 0,
      detector: { active: 0, detected_24h: 0, method: "" },
      is_synthetic: true,
    })),
    api.policy(1).catch(() => ({
      hour: 19,
      totals: { vehicles: 0, pcu: 0, congestion_index: 0 },
      classes: [],
      scenarios: [],
      assumptions: { model: "", speed_curve: "", elasticity: "" },
      is_synthetic: true,
    })),
    // Null rather than an invented shape: this is the page's only real data,
    // so a fabricated fallback would be worse here than an absent section.
    api.severity().catch(() => null),
    api.allocation().catch(() => null),
    api.severityModel().catch(() => null),
  ]);

  return (
    <LandingView
      summary={summary}
      profile={profile}
      incidents={incidents}
      policy={policy}
      severity={severity}
      allocation={allocation}
      severityModel={severityModel}
    />
  );
}
