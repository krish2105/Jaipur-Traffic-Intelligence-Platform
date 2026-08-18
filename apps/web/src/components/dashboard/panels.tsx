"use client";

import { useLocale, useTranslations } from "next-intl";

import type { Camera, ClassMixEntry, DataQuality, Forecast } from "@/lib/api";
import { congestionBandKey, congestionVar } from "@/lib/api";
import { formatCount, formatPcu, formatPercent } from "@/lib/format";
import type { Locale } from "@/i18n/routing";

/**
 * docs/06 §4: staggered reveal, 60ms apart, transform and opacity only.
 *
 * Deliberately CSS rather than JS. A JS-driven reveal that starts at opacity 0
 * leaves the entire dashboard invisible if hydration fails for any reason — as
 * it did once already here. A CSS animation with `both` fill always lands on
 * the final state, and the global prefers-reduced-motion rule collapses it to
 * an instant appearance rather than a hidden one.
 */
export function Reveal({ index = 0, children }: { index?: number; children: React.ReactNode }) {
  return (
    <div className="pravaah-reveal" style={{ animationDelay: `${index * 60}ms` }}>
      {children}
    </div>
  );
}

export function Panel({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="border border-rule rounded-(--radius-token-lg) bg-surface p-(--density-pad)">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-(length:--type-caption) uppercase tracking-[0.14em] text-ink-muted">
          {title}
        </h2>
        {aside}
      </header>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * docs/02 rule 6, and it is not negotiable: anything derived from a synthetic
 * row renders this badge, always. A government evaluator who later discovers
 * unlabelled synthetic data in a demo will never trust anything else you show.
 */
export function SyntheticBadge() {
  const t = useTranslations("quality");
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-(--radius-token) border border-accent-dim/50
                 px-2 py-0.5 text-[11px] uppercase tracking-wider text-accent-dim"
      title={t("simulatedExplain")}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-dim" />
      {t("simulated")}
    </span>
  );
}

export function Metric({
  label,
  value,
  unit,
  delta,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
}) {
  return (
    <div>
      <p className="text-(length:--type-caption) text-ink-muted">{label}</p>
      <p className="metric mt-1 flex items-baseline gap-1.5 text-(length:--type-metric) leading-none">
        {value}
        {unit && <span className="text-(length:--type-caption) text-ink-muted">{unit}</span>}
      </p>
      {delta && <p className="mt-1 text-(length:--type-caption) text-ink-muted">{delta}</p>}
    </div>
  );
}

export function ClassMixPanel({ mix }: { mix: ClassMixEntry[] }) {
  const t = useTranslations("dashboard");
  const locale = useLocale() as Locale;
  return (
    <Panel title={t("classMix")} aside={<SyntheticBadge />}>
      <ul className="space-y-2.5">
        {mix.slice(0, 6).map((entry) => (
          <li key={entry.class_code}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{locale === "hi" ? entry.name.hi : entry.name.en}</span>
              <span className="metric text-ink-muted">{formatPercent(entry.share, locale)}</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-sunk">
              <div
                className="h-full rounded-full bg-ink-muted"
                style={{ width: `${entry.share * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-(length:--type-caption) leading-relaxed text-ink-muted">
        {t("classMixNote")}
      </p>
    </Panel>
  );
}

/**
 * docs/03 §3: emit a quality score per bin, suppress low-quality bins from
 * policy outputs, and *show the suppression in the UI rather than hiding it*.
 * Honest degradation is a credibility asset in government, not a weakness.
 */
export function QualityPanel({
  quality,
  cameras,
}: {
  quality: DataQuality;
  cameras: Camera[];
}) {
  const t = useTranslations("quality");
  const locale = useLocale() as Locale;
  const active = cameras.filter((c) => c.status === "active").length;
  const cert = cameras[0]?.accuracy_cert;
  return (
    <Panel title={t("label")}>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">{t("cameras")}</dt>
          <dd className="metric">
            {formatCount(active, locale)} / {formatCount(cameras.length, locale)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">{t("meanScore")}</dt>
          <dd className="metric">{quality.mean_score.toFixed(2)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">{t("suppressed")}</dt>
          <dd className="metric">
            {formatCount(quality.suppressed_bins, locale)} (
            {formatPercent(quality.suppressed_pct, locale)})
          </dd>
        </div>
      </dl>
      {cert && (
        <p className="mt-4 border-t border-rule pt-3 text-(length:--type-caption) leading-relaxed text-ink-muted">
          {t("certificate", {
            day: formatPercent(1 - cert.day_mape, locale),
            night: formatPercent(1 - cert.night_mape, locale),
          })}
          <br />
          <span className="text-accent-dim">{t("provisional")}</span>
        </p>
      )}
    </Panel>
  );
}

/** docs/04 §5: a forecast without uncertainty is not decision support. */
export function ForecastPanel({ forecast }: { forecast: Forecast }) {
  const t = useTranslations("forecast");
  const tc = useTranslations("congestion");
  return (
    <Panel title={t("label")}>
      <ul className="space-y-3">
        {forecast.horizons.map((h) => (
          <li key={h.horizon_min}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-ink-muted">+{h.horizon_min} min</span>
              <span className="metric">
                {h.predicted_index.toFixed(0)}
                <span className="ml-1.5 text-(length:--type-caption) text-ink-muted">
                  {tc(congestionBandKey(h.predicted_index))}
                </span>
              </span>
            </div>
            {/* the 80% band, drawn — not a number hidden in a tooltip */}
            <div className="relative mt-1.5 h-1.5 w-full rounded-full bg-surface-sunk">
              <div
                className="absolute h-full rounded-full opacity-35"
                style={{
                  left: `${h.lower_80}%`,
                  width: `${Math.max(1, h.upper_80 - h.lower_80)}%`,
                  background: congestionVar(h.predicted_index),
                }}
              />
              <div
                className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full"
                style={{ left: `${h.predicted_index}%`, background: congestionVar(h.predicted_index) }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-(length:--type-caption) leading-relaxed text-ink-muted">
        {t("baselineNote")}
      </p>
    </Panel>
  );
}

export function CorridorMetrics({
  vehicles,
  pcu,
  peakHour,
}: {
  vehicles: number;
  pcu: number;
  peakHour: { hour: number; pcu: number } | null;
}) {
  const t = useTranslations("dashboard");
  const locale = useLocale() as Locale;
  return (
    <Panel title={t("now")} aside={<SyntheticBadge />}>
      <div className="grid grid-cols-2 gap-(--density-gap)">
        <Metric label={t("vehicles")} value={formatCount(vehicles, locale)} />
        <Metric label={t("pcu")} value={formatPcu(pcu, locale)} />
      </div>
      {peakHour && (
        <p className="mt-4 border-t border-rule pt-3 text-(length:--type-caption) text-ink-muted">
          {t("peakHour", {
            hour: `${String(peakHour.hour).padStart(2, "0")}:00`,
            pcu: formatPcu(peakHour.pcu, locale),
          })}
        </p>
      )}
    </Panel>
  );
}
