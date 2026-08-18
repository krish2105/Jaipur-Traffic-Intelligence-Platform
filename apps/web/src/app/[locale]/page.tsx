import { setRequestLocale } from "next-intl/server";

import { api } from "@/lib/api";
import { LandingView } from "@/components/landing/landing-view";

export const dynamic = "force-dynamic";

/** The landing page runs on the same endpoints as the console, deliberately:
 *  no marketing copy can then hold a figure the product would contradict. */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [summary, profile, incidents, policy] = await Promise.all([
    api.summary(1),
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
  ]);

  return (
    <LandingView summary={summary} profile={profile} incidents={incidents} policy={policy} />
  );
}
