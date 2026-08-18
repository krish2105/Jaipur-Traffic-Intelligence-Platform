import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import { GnomonArc } from "@/components/instrument/gnomon-arc";
import {
  ClassMixPanel,
  CorridorMetrics,
  ForecastPanel,
  QualityPanel,
  Reveal,
} from "@/components/dashboard/panels";
import { CorridorRail } from "@/components/dashboard/corridor-rail";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/theme/language-toggle";
import { DirectionSwitcher } from "@/components/theme/direction-switcher";

export const dynamic = "force-dynamic";

/** Minutes since local midnight in Jaipur — where the brass indicator sits. */
function jaipurNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export default async function Dashboard({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ corridor?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");

  const corridors = await api.corridors().catch(() => []);
  if (corridors.length === 0) notFound();

  const first = corridors[0]!;
  const selectedId = Number((await searchParams).corridor) || first.corridor_id;
  const corridor = corridors.find((c) => c.corridor_id === selectedId) ?? first;

  const [summary, profile, cameras, forecast] = await Promise.all([
    api.summary(corridor.corridor_id),
    api.dayProfile(corridor.corridor_id),
    api.cameras(),
    api.forecast(),
  ]);

  return (
    <div className="min-h-dvh">
      <header
        className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3
                   border-b border-rule bg-surface/85 px-(--density-pad) py-3 backdrop-blur-sm"
      >
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">PRAVAAH</span>
          <span className="text-ink-muted" lang="hi">प्रवाह</span>
          <span className="ml-3 hidden text-(length:--type-caption) text-ink-muted sm:inline">
            {locale === "hi" ? corridor.name.hi : corridor.name.en}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <DirectionSwitcher />
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main
        className="grid gap-(--density-gap) p-(--density-pad)
                   lg:grid-cols-[minmax(200px,15rem)_1fr_minmax(240px,19rem)]"
      >
        <Reveal index={0}>
          <CorridorRail corridors={corridors} selectedId={corridor.corridor_id} />
        </Reveal>

        <div className="space-y-(--density-gap)">
          <Reveal index={1}>
            <section className="rounded-(--radius-token-lg) border border-rule bg-surface p-(--density-pad)">
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h1 className="text-(length:--type-h2) font-medium">{t("dayTitle")}</h1>
                <p className="text-(length:--type-caption) text-ink-muted">
                  {t("calibratedAgainst", { source: profile.calibration.source })}
                </p>
              </header>
              <GnomonArc
                points={profile.points}
                peak={profile.peak}
                nowMinutes={jaipurNowMinutes()}
                className="mx-auto mt-2 max-w-xl"
              />
            </section>
          </Reveal>

          <Reveal index={2}>
            <ForecastPanel forecast={forecast} />
          </Reveal>
        </div>

        <div className="space-y-(--density-gap)">
          <Reveal index={3}>
            <CorridorMetrics
              vehicles={summary.total_vehicles}
              pcu={summary.total_pcu}
              peakHour={summary.peak_hour}
            />
          </Reveal>
          <Reveal index={4}>
            <ClassMixPanel mix={summary.class_mix} />
          </Reveal>
          <Reveal index={5}>
            <QualityPanel quality={summary.data_quality} cameras={cameras} />
          </Reveal>
        </div>
      </main>
    </div>
  );
}
