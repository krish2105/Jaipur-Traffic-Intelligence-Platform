import { getTranslations, setRequestLocale } from "next-intl/server";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/theme/language-toggle";
import { DirectionSwitcher } from "@/components/theme/direction-switcher";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <main className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-rule px-(--density-pad) py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">PRAVAAH</span>
          <span className="text-ink-muted" lang="hi">प्रवाह</span>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-(--density-pad) py-(--space-9)">
        <p className="text-ink-muted text-(length:--type-caption) uppercase tracking-widest">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 text-(length:--type-display) leading-[1.05] font-semibold tracking-tight">
          {t("headline")}
        </h1>
        <p className="mt-5 max-w-prose text-ink-muted">{t("standfirst")}</p>

        <hr className="my-(--space-7) rule" />

        <h2 className="text-(length:--type-h2) font-medium">{t("chooseDirectionTitle")}</h2>
        <p className="mt-2 max-w-prose text-ink-muted text-(length:--type-caption)">
          {t("chooseDirectionHelp")}
        </p>
        <div className="mt-4">
          <DirectionSwitcher />
        </div>

        <div className="mt-(--space-7) grid gap-(--density-gap) sm:grid-cols-3">
          {(["free", "moderate", "critical"] as const).map((band) => (
            <div key={band} className="border border-rule p-(--density-pad) rounded-(--radius-token-lg)">
              <div
                className="h-1.5 w-full rounded-full"
                style={{ background: `var(--congestion-${band})` }}
                aria-hidden="true"
              />
              <p className="mt-3 text-(length:--type-caption) text-ink-muted">
                {t(`band.${band}`)}
              </p>
              <p className="metric mt-1 text-(length:--type-metric) leading-none">
                {band === "free" ? "18" : band === "moderate" ? "61" : "94"}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
