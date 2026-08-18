import { getTranslations, setRequestLocale } from "next-intl/server";

import { api } from "@/lib/api";
import { DirectionGallery } from "@/components/dashboard/direction-gallery";

export const dynamic = "force-dynamic";

/**
 * Phase 1 decision aid.
 *
 * The same live dashboard, on the same live data, rendered three ways. All
 * three directions share one component tree — what changes is a CSS custom
 * property preset plus a handful of density and motion variables. Comparing on
 * real data beats comparing mockups, and it costs days rather than a third of
 * the project.
 *
 * This route is removed once a direction is chosen.
 */
export default async function DesignPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("design");

  const corridors = await api.corridors().catch(() => []);
  const corridorId = corridors[0]?.corridor_id;
  const [summary, profile] = await Promise.all([
    api.summary(corridorId).catch(() => null),
    api.dayProfile(corridorId).catch(() => null),
  ]);

  return (
    <main className="min-h-dvh px-(--density-pad) py-(--space-7)">
      <header className="mx-auto max-w-5xl">
        <p className="text-(length:--type-caption) uppercase tracking-widest text-ink-muted">
          PRAVAAH · <span lang="hi">प्रवाह</span>
        </p>
        <h1 className="mt-2 text-(length:--type-h1) font-semibold tracking-tight">
          {t("galleryTitle")}
        </h1>
        <p className="mt-3 max-w-prose text-ink-muted">{t("galleryStandfirst")}</p>
      </header>

      <div className="mx-auto mt-(--space-7) max-w-5xl">
        {summary && profile ? (
          <DirectionGallery summary={summary} profile={profile} />
        ) : (
          <p className="text-ink-muted">{t("apiUnavailable")}</p>
        )}
      </div>
    </main>
  );
}
