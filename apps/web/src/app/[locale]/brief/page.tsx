import { setRequestLocale } from "next-intl/server";

import { api } from "@/lib/api";
import { BriefView } from "@/components/brief/brief-view";

export const dynamic = "force-dynamic";

/**
 * The pitch as a page that reads its own numbers.
 *
 * Every figure is fetched from the same endpoints the console uses, so no
 * briefing copy can hold a number the product would contradict — the same rule
 * the landing page follows, for the same reason.
 *
 * Every call degrades on its own. A brief that 500s because one endpoint is
 * slow is worse than a brief with one section missing, and an official reading
 * it will not know which.
 */
export default async function Brief({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [readiness, probe, reliability, accumulation, schemes, cityData] = await Promise.all([
    api
      .readiness()
      .catch(() => ({ sources: [], live_count: 0, total: 0, source_mode: "", note: "" })),
    api.probeCoverage().catch(() => null),
    api.reliability().catch(() => null),
    api.liveAccumulation().catch(() => null),
    api.schemes().catch(() => null),
    api.cityData().catch(() => null),
  ]);

  return (
    <main className="min-h-dvh bg-[var(--ground)]">
      <BriefView
        readiness={readiness}
        probe={probe}
        reliability={reliability}
        accumulation={accumulation}
        scheme={schemes?.schemes?.[0] ?? null}
        cityData={cityData}
      />
    </main>
  );
}
