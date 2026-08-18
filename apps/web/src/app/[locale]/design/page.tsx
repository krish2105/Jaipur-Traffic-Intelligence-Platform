import { setRequestLocale } from "next-intl/server";

import { api } from "@/lib/api";
import { CardStyleGallery } from "@/components/console/card-gallery";

export const dynamic = "force-dynamic";

/**
 * Card-language decision aid.
 *
 * One panel, three treatments, the same live data. Judging a card language from
 * a description does not work — the whole complaint was that panels looked flat
 * and cramped, and that is only visible rendered.
 */
export default async function DesignPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Neither call was guarded — an internal design-review page, so lower
  // stakes than the public ones, but the same unhandled-rejection fault:
  // one unreachable API took the whole page down rather than showing the
  // "apiUnavailable" state this page's own copy already promises.
  const [summary, profile] = await Promise.all([
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
  ]);
  return <CardStyleGallery summary={summary} profile={profile} />;
}
