"use client";

import { useLocale } from "next-intl";

import type { Camera, CountsSummary, Forecast } from "@/lib/api";
import { congestionBandKey, congestionVar } from "@/lib/api";
import { formatCount, formatPcu, formatPercent } from "@/lib/format";
import type { Locale } from "@/i18n/routing";
import { Bar, Metric, Panel, SyntheticTag } from "./primitives";

const CLASS_LABEL: Record<string, { en: string; hi: string }> = {
  "2W": { en: "Two-wheeler", hi: "दोपहिया" },
  CAR: { en: "Car / jeep / van", hi: "कार / जीप / वैन" },
  AUTO: { en: "Auto-rickshaw", hi: "ऑटो-रिक्शा" },
  ERIK: { en: "E-rickshaw", hi: "ई-रिक्शा" },
  LCV: { en: "Light commercial", hi: "हल्का व्यावसायिक" },
  BUS: { en: "Bus", hi: "बस" },
  TRK2: { en: "Truck", hi: "ट्रक" },
  NMV: { en: "Non-motorised", hi: "गैर-मोटर चालित" },
};

/** Live counts and PCU. The headline the whole product exists to produce. */
export function CountsPanel({ summary }: { summary: CountsSummary }) {
  const locale = useLocale() as Locale;
  const q = summary.data_quality;
  return (
    <Panel
      title="Counts · live"
      aside={summary.is_synthetic ? <SyntheticTag label="Simulated" /> : undefined}
    >
      <div className="grid grid-cols-2 gap-4">
        <Metric
          label="Vehicles"
          value={formatCount(summary.total_vehicles, locale)}
          quality={`quality ${q.mean_score.toFixed(2)}`}
        />
        <Metric
          label="PCU"
          value={formatPcu(summary.total_pcu, locale)}
          quality={
            q.suppressed_bins > 0
              ? `${formatCount(q.suppressed_bins, locale)} bins suppressed`
              : "no bins suppressed"
          }
        />
      </div>
      {summary.peak_hour && (
        <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] text-[var(--ink-muted)]">
          Peak hour {String(summary.peak_hour.hour).padStart(2, "0")}:00 ·{" "}
          <span className="font-mono tabular-nums">
            {formatPcu(summary.peak_hour.pcu, locale)}
          </span>{" "}
          PCU
        </p>
      )}
    </Panel>
  );
}

/**
 * Composition. The panel a probe-data product structurally cannot draw, and
 * the reason docs/01 §4 says this whole platform exists.
 */
export function CompositionPanel({ summary }: { summary: CountsSummary }) {
  const locale = useLocale() as Locale;
  return (
    <Panel
      title="Composition"
      aside={summary.is_synthetic ? <SyntheticTag label="Simulated" /> : undefined}
    >
      <ul className="space-y-2">
        {summary.class_mix.slice(0, 6).map((entry) => {
          const label = CLASS_LABEL[entry.class_code] ?? entry.name;
          return (
            <li key={entry.class_code}>
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="text-[var(--ink)]">
                  {locale === "hi" ? label.hi : label.en}
                </span>
                <span className="font-mono tabular-nums text-[var(--ink-muted)]">
                  {formatPercent(entry.share, locale)}
                </span>
              </div>
              <div className="mt-1">
                <Bar fraction={entry.share} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        Probe data reports delay, never composition. Every capacity calculation,
        signal plan and freight window depends on this split.
      </p>
    </Panel>
  );
}

/** docs/04 §5 — a forecast without its uncertainty is not decision support. */
export function ForecastPanel({ forecast }: { forecast: Forecast }) {
  return (
    <Panel title="Forecast" aside={<SyntheticTag label="80% band" />}>
      <ul className="space-y-2.5">
        {forecast.horizons.map((h) => (
          <li key={h.horizon_min}>
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="text-[var(--ink-muted)]">+{h.horizon_min} min</span>
              <span className="font-mono tabular-nums text-[var(--ink)]">
                {h.predicted_index.toFixed(0)}
                <span className="ml-1.5 text-[10px] text-[var(--ink-muted)]">
                  {congestionBandKey(h.predicted_index)}
                </span>
              </span>
            </div>
            <div className="relative mt-1.5 h-1.5 w-full rounded-full bg-[var(--surface-3)]">
              <div
                className="absolute h-full rounded-full opacity-40"
                style={{
                  left: `${h.lower_80}%`,
                  width: `${Math.max(1, h.upper_80 - h.lower_80)}%`,
                  background: congestionVar(h.predicted_index),
                }}
              />
              <div
                className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full"
                style={{
                  left: `${h.predicted_index}%`,
                  background: congestionVar(h.predicted_index),
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {forecast.model_version} — a learned model ships only once it beats this.
      </p>
    </Panel>
  );
}

/**
 * docs/03 §3 — degrade honestly. Suppression is reported, never hidden, and
 * each camera shows the accuracy it was actually validated at.
 */
export function QualityPanel({
  summary,
  cameras,
}: {
  summary: CountsSummary;
  cameras: Camera[];
}) {
  const locale = useLocale() as Locale;
  const active = cameras.filter((c) => c.status === "active");
  const cert = cameras[0]?.accuracy_cert;
  const q = summary.data_quality;
  return (
    <Panel title="Data quality">
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Cameras" value={`${active.length}/${cameras.length}`} />
        <Metric label="Mean" value={q.mean_score.toFixed(2)} />
        <Metric label="Suppressed" value={formatPercent(q.suppressed_pct, locale)} />
      </div>
      {cert && (
        <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
          Validated {formatPercent(1 - cert.day_mape, locale)} daylight ·{" "}
          {formatPercent(1 - cert.night_mape, locale)} night, published per camera.
          <br />
          <span className="text-[var(--accent)]">{cert.status}</span> — {cert.basis}
        </p>
      )}
    </Panel>
  );
}
