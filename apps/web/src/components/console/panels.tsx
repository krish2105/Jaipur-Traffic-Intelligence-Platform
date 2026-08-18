"use client";

import { useLocale } from "next-intl";

import type {
  BlackSpots,
  Camera,
  CountsSummary,
  Forecast,
  DayProfile,
  SignalAdvisory,
  SourceReadiness,
  WeatherNow,
  WeeklyMatrix,
  IncidentTimeline,
} from "@/lib/api";
import { congestionBandKey, congestionVar } from "@/lib/api";
import { formatCompact, formatCount, formatPercent } from "@/lib/format";
import type { Locale } from "@/i18n/routing";
import {
  Bar,
  Metric,
  MetricPair,
  MetricRow,
  ModeDot,
  Panel,
  SyntheticTag,
} from "./primitives";
import { DayProfileChart } from "@/components/charts/day-profile";
import { CompositionChart } from "@/components/charts/composition";
import { CongestionHeatmap } from "@/components/charts/heatmap";
import { IncidentTimelineChart } from "@/components/charts/incident-timeline";


/** Live counts and PCU. The headline the whole product exists to produce. */
export function CountsPanel({
  summary,
  profile,
  nowMinutes,
}: {
  summary: CountsSummary;
  profile?: DayProfile;
  nowMinutes?: number;
}) {
  const locale = useLocale() as Locale;
  const q = summary.data_quality;
  return (
    <Panel
      title="Counts · live"
      aside={summary.is_synthetic ? <SyntheticTag label="Simulated" /> : undefined}
    >
      <MetricPair>
        <Metric
          label="Vehicles"
          value={formatCompact(summary.total_vehicles, locale)}
          quality={`quality ${q.mean_score.toFixed(2)}`}
        />
        <Metric
          label="PCU"
          value={formatCompact(summary.total_pcu, locale)}
          quality={
            q.suppressed_bins > 0
              ? `${formatCount(q.suppressed_bins, locale)} bins suppressed`
              : "no bins suppressed"
          }
        />
      </MetricPair>
      {profile && profile.points.length > 0 && (
        <div className="mt-4">
          <DayProfileChart points={profile.points} nowMinutes={nowMinutes ?? 0} />
        </div>
      )}
      {summary.peak_hour && (
        <p
          className="mt-3 text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          Peak hour {String(summary.peak_hour.hour).padStart(2, "0")}:00 ·{" "}
          <span className="font-mono tabular-nums">
            {formatCompact(summary.peak_hour.pcu, locale)}
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
  return (
    <Panel
      title="Composition"
      emphasis
      aside={summary.is_synthetic ? <SyntheticTag label="Simulated" /> : undefined}
    >
      <CompositionChart mix={summary.class_mix} />
      <p
        className="mt-4 leading-relaxed text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        Probe data reports delay, never composition. Every capacity calculation,
        signal plan and freight window depends on this split — and no probe
        product in the world can produce it.
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
    <Panel title="Data quality · today">
      {/* One row that reflows on the PANEL's width. Three across when the rail
          is wide, two when it is dragged in, one on a phone — decided by the
          container, which is the only thing that actually knows. */}
      <MetricRow>
        <Metric label="Cameras" value={`${active.length}/${cameras.length}`} span={0.3} />
        <Metric label="Mean quality" value={q.mean_score.toFixed(2)} span={0.3} />
        <Metric
          label="Suppressed"
          value={formatPercent(q.suppressed_pct, locale)}
          span={0.3}
          quality="incl. night bins"
        />
      </MetricRow>
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

/**
 * Black spots, ranked by SEVERITY rather than frequency.
 *
 * docs/01 §2 is the whole reason this panel exists: Jaipur crashes fell 5.6% in
 * 2025 while deaths rose 3.1%. A frequency ranking would miss precisely that.
 */
export function BlackSpotPanel({ data }: { data: BlackSpots }) {
  const locale = useLocale() as Locale;
  return (
    <Panel
      title="Black spots · severity"
      aside={data.segments[0]?.is_synthetic ? <SyntheticTag label="Simulated" /> : undefined}
    >
      {data.segments.length === 0 ? (
        <p className="text-[11px] text-[var(--ink-muted)]">No segment has enough crashes to rank.</p>
      ) : (
        <ul className="space-y-2">
          {data.segments.slice(0, 5).map((s) => (
            <li key={s.link_id} className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
                {locale === "hi" ? s.name.hi : s.name.en}
                {s.top_cause && (
                  <span className="ml-1.5 text-[10px] text-[var(--ink-faint)]">
                    {s.top_cause.replace(/_/g, " ")}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-[var(--ink-muted)]">
                {formatCount(s.deaths, locale)}
                <span className="ml-1 text-[10px]">deaths</span>
              </span>
              <span
                className="shrink-0 font-mono tabular-nums"
                style={{ color: congestionVar(Math.min(100, s.severity_rate * 70)) }}
              >
                {s.severity_rate.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {data.basis}. Crashes fell 5.6% in 2025 while deaths rose 3.1% — severity,
        not frequency, is what is concentrating.
      </p>
    </Panel>
  );
}

/** docs/04 §7 — the system recommends, a person decides. Every time. */
export function SignalPanel({ data }: { data: SignalAdvisory }) {
  const locale = useLocale() as Locale;
  const measured = data.advisories.filter((a) => a.has_measurement);
  return (
    <Panel title="Signal advisory" aside={<SyntheticTag label="Advisory" />}>
      <ul className="space-y-2">
        {data.advisories.slice(0, 5).map((a) => (
          <li key={a.junction_id} className="text-[12px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
                {locale === "hi" ? a.name.hi : a.name.en}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-[var(--ink-muted)]">
                {a.has_measurement ? `${a.recommended_cycle_s}s` : "—"}
              </span>
            </div>
            <div className="mt-1">
              <Bar
                fraction={a.degree_of_saturation}
                colour={congestionVar(a.degree_of_saturation * 100)}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {data.method} · {measured.length} of {data.advisories.length} junctions instrumented.
        <br />
        <span className="text-[var(--accent)]">{data.governance}</span>
      </p>
    </Panel>
  );
}

/**
 * Incidents and road safety.
 *
 * Two facts, deliberately not merged. The chart is five years of crashes by
 * hour of day, banded by injury outcome, with the congestion curve drawn over
 * it — congestion and crash volume peak at the same hours, which is what turns
 * a traffic-management case into a road-safety one. Below it sits the live
 * detector queue, which is a different object entirely: a congestion anomaly
 * is not a crash, and stacking the two would produce a total that means
 * nothing.
 *
 * The queue stays honest when it is empty. An empty queue is a true statement
 * about this instance, not a claim that the city is calm.
 */
export function IncidentPanel({ data }: { data: IncidentTimeline }) {
  const locale = useLocale() as Locale;
  const peak = String(data.peak_hour).padStart(2, "0");

  return (
    <Panel
      title="Incidents · safety"
      aside={data.is_synthetic ? <SyntheticTag label="Simulated" /> : undefined}
    >
      {data.hours.length > 0 && (
        <>
          <IncidentTimelineChart hours={data.hours} />
          <p
            className="mt-2 leading-relaxed text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            <span className="font-mono tabular-nums text-[var(--ink)]">
              {formatCount(data.totals.crashes, locale)}
            </span>{" "}
            crashes {data.totals.since}–{data.totals.until},{" "}
            <span className="font-mono tabular-nums text-[var(--congestion-critical)]">
              {formatCount(data.totals.deaths, locale)}
            </span>{" "}
            deaths. Crashes peak at{" "}
            <span className="font-mono tabular-nums text-[var(--ink)]">{peak}:00</span> — the
            same hour as congestion. The evening jam is when people are hurt.
          </p>
        </>
      )}
      <div className="mt-3 flex items-baseline justify-between rounded-[calc(var(--d-radius)-4px)] bg-[var(--surface-1)] px-3 py-2">
        <span
          className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          Detector queue
        </span>
        <span
          className="font-mono tabular-nums text-[var(--ink)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {data.detector.active} open · {data.detector.detected_24h} in 24h
        </span>
      </div>
    </Panel>
  );
}

/**
 * Live-data readiness.
 *
 * docs/10 rates "how would this work with our data?" as the question that
 * decides the pitch. This answers it on screen: every source, its actual mode,
 * and the one credential or agreement that flips it. It also keeps us honest —
 * a source cannot claim to be live here unless its key is genuinely present.
 */
export function ReadinessPanel({ data }: { data: SourceReadiness }) {
  return (
    <Panel
      title="Live data · readiness"
      aside={
        <span className="font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
          {data.live_count}/{data.total} live
        </span>
      }
    >
      <ul className="space-y-1.5">
        {data.sources.map((s) => (
          <li key={s.id} className="flex items-baseline gap-2 text-[12px]">
            <ModeDot live={s.mode === "live"} title={s.mode} />
            <span className="min-w-0 flex-1 truncate text-[var(--ink)]">{s.name}</span>
            <span className="shrink-0 text-[10px] text-[var(--ink-faint)]">{s.provider}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {data.note}
      </p>
      {data.sources.some((s) => s.needs) && (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--accent)]">
          Awaiting:{" "}
          {data.sources
            .filter((s) => s.needs)
            .map((s) => s.needs)
            .join(" · ")}
        </p>
      )}
    </Panel>
  );
}

/**
 * Conditions, and what they mean for the counts.
 *
 * docs/03 §3 — degrade honestly. When it rains the quality score drops and this
 * panel says why, rather than letting accuracy quietly sag.
 */
export function WeatherPanel({ data }: { data: WeatherNow }) {
  if (!data.available) return null;
  return (
    <Panel
      title="Conditions"
      aside={
        <span className="text-[10px] text-[var(--ink-faint)]">
          {data.provider} · {data.observed_at === "replay" ? "replay" : "live"}
        </span>
      }
    >
      <MetricRow>
        <Metric label="Temp" value={`${data.temperature_c?.toFixed(0)}°`} span={0.28} />
        <Metric
          label="Rain"
          value={`${data.precipitation_mm?.toFixed(1)}`}
          unit="mm"
          span={0.28}
        />
        <Metric
          label="Visibility"
          value={data.visibility_m != null ? `${(data.visibility_m / 1000).toFixed(1)}` : "—"}
          unit="km"
          span={0.28}
        />
      </MetricRow>
      <p
        className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed"
        style={{
          color: data.degrades_counting ? "var(--congestion-moderate)" : "var(--ink-muted)",
        }}
      >
        {data.summary}
        {data.degrades_counting
          ? " — counting accuracy reduced; affected bins are suppressed and shown as such."
          : " — no weather degradation of counting."}
      </p>
    </Panel>
  );
}


/** Seven days by twenty-four hours. Measured history, not a forecast. */
export function HeatmapPanel({ data }: { data: WeeklyMatrix }) {
  return (
    <Panel
      title="Weekly pattern"
      aside={<SyntheticTag label={data.window} />}
    >
      <CongestionHeatmap matrix={data.matrix} days={data.days} />
      <p
        className="mt-3 leading-relaxed text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        Twin peaks every weekday; Friday heaviest; Sunday materially quieter.
        Measured, not predicted.
      </p>
    </Panel>
  );
}
