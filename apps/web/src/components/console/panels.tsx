"use client";

import { useLocale } from "next-intl";

import type {
  BlackSpots,
  Camera,
  CountsSummary,
  Forecast,
  DayProfile,
  SignalAdvisory,
  ProbeCoverage,
  Reliability,
  ReliabilityRow,
  SourceReadiness,
  WeatherNow,
  WeeklyMatrix,
  IncidentTimeline,
} from "@/lib/api";
import { congestionBandKey, congestionVar } from "@/lib/api";
import { formatCompact, formatCount, formatPercent } from "@/lib/format";
import { translator } from "@/lib/strings";
import { useChanged, usePoll } from "@/lib/live";
import { api } from "@/lib/api";
import type { Locale } from "@/i18n/routing";
import {
  Bar,
  Metric,
  MetricPair,
  MetricRow,
  ModeDot,
  Panel,
  Pulse,
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
  const t = translator(locale);

  // A panel titled "live" that never changes is a lie the interface repeats
  // every few seconds. It polls, keeps the last good value on failure, and
  // stops entirely while the tab is hidden.
  const { data: fresh, updatedAt, failing } = usePoll(() => api.summary(1), {
    intervalMs: 20_000,
  });
  const current = fresh ?? summary;
  const q = current.data_quality;
  // Keyed on the value, not on the poll: a poll returning the same count must
  // not flash, because nothing happened.
  const pulsed = useChanged(current.total_vehicles);

  return (
    <Panel
      title={t("countsLive")}
      aside={
        <div className="flex shrink-0 items-center gap-2">
          {updatedAt && !failing && <Pulse label={t("live")} />}
          {failing && (
            <span
              className="text-[var(--congestion-moderate)]"
              style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
            >
              {locale === "hi" ? "पुराना" : "stale"}
            </span>
          )}
          {current.is_synthetic && <SyntheticTag label={t("simulated")} />}
        </div>
      }
    >
      <div
        className="transition-colors duration-700"
        style={{
          background: pulsed
            ? "color-mix(in oklab, var(--accent) 10%, transparent)"
            : "transparent",
          borderRadius: "calc(var(--d-radius) - 6px)",
          margin: "-4px",
          padding: "4px",
        }}
      >
      <MetricPair>
        <Metric
          label={t("vehicles")}
          value={formatCompact(current.total_vehicles, locale)}
          quality={`${t("quality")} ${q.mean_score.toFixed(2)}`}
        />
        <Metric
          label={t("pcu")}
          value={formatCompact(current.total_pcu, locale)}
          quality={
            q.suppressed_bins > 0
              ? `${formatCount(q.suppressed_bins, locale)} ${t("binsSuppressed")}`
              : t("noBinsSuppressed")
          }
        />
      </MetricPair>
      </div>
      {profile && profile.points.length > 0 && (
        <div className="mt-4">
          <DayProfileChart points={profile.points} nowMinutes={nowMinutes ?? 0} />
        </div>
      )}
      {current.peak_hour && (
        <p
          className="mt-3 text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {t("peakHour")} {String(current.peak_hour.hour).padStart(2, "0")}:00 ·{" "}
          <span className="font-mono tabular-nums">
            {formatCompact(current.peak_hour.pcu, locale)}
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
  const t = translator(useLocale() as Locale);
  return (
    <Panel
      title={t("composition")}
      emphasis
      aside={summary.is_synthetic ? <SyntheticTag label={t("simulated")} /> : undefined}
    >
      <CompositionChart mix={summary.class_mix} />
      <p
        className="mt-4 leading-relaxed text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        {t("compositionArgument")}
      </p>
    </Panel>
  );
}

/** docs/04 §5 — a forecast without its uncertainty is not decision support. */
export function ForecastPanel({ forecast }: { forecast: Forecast }) {
  const t = translator(useLocale() as Locale);
  return (
    <Panel title={t("forecast")} aside={<SyntheticTag label={t("band80")} />}>
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
  const t = translator(locale);
  const active = cameras.filter((c) => c.status === "active");
  const cert = cameras[0]?.accuracy_cert;
  const q = summary.data_quality;
  return (
    <Panel title={t("dataQuality")}>
      {/* One row that reflows on the PANEL's width. Three across when the rail
          is wide, two when it is dragged in, one on a phone — decided by the
          container, which is the only thing that actually knows. */}
      <MetricRow>
        <Metric label={t("cameras")} value={`${active.length}/${cameras.length}`} span={0.3} />
        <Metric label={t("meanQuality")} value={q.mean_score.toFixed(2)} span={0.3} />
        <Metric
          label={t("suppressed")}
          value={formatPercent(q.suppressed_pct, locale)}
          span={0.3}
          quality={t("inclNightBins")}
        />
      </MetricRow>
      {cert && (
        <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
          {formatPercent(1 - cert.day_mape, locale)} {t("daylight")} ·{" "}
          {formatPercent(1 - cert.night_mape, locale)} {t("night")}, {t("validatedPer")}.
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
  const t = translator(locale);
  return (
    <Panel
      title={t("blackSpots")}
      aside={data.segments[0]?.is_synthetic ? <SyntheticTag label={t("simulated")} /> : undefined}
    >
      {data.segments.length === 0 ? (
        <p className="text-[11px] text-[var(--ink-muted)]">{t("noSegments")}</p>
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
  const t = translator(locale);
  const measured = data.advisories.filter((a) => a.has_measurement);
  return (
    <Panel title={t("signalAdvisory")} aside={<SyntheticTag label={t("advisory")} />}>
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
  const t = translator(locale);
  const peak = String(data.peak_hour).padStart(2, "0");

  return (
    <Panel
      title={t("incidentsSafety")}
      aside={data.is_synthetic ? <SyntheticTag label={t("simulated")} /> : undefined}
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
  const t = translator(useLocale() as Locale);
  return (
    <Panel
      title={t("readiness")}
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
      {/* Snapshot data is indistinguishable from live data by inspection, which
          is why it needs saying out loud. This panel already answers "where did
          this come from", so the disclosure belongs here rather than in a
          banner competing with it. */}
      {data.source_mode === "snapshot" && (
        <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--accent)]">
          <span className="font-medium">{t("snapshotMode")}</span> — {t("snapshotNote")}
        </p>
      )}
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

const CORRIDOR_NAMES: Record<number, { en: string; hi: string }> = {
  1: { en: "Tonk Road", hi: "टोंक रोड" },
  2: { en: "JLN Marg", hi: "जेएलएन मार्ग" },
  3: { en: "Ajmer Road", hi: "अजमेर रोड" },
  4: { en: "Gopalpura Bypass", hi: "गोपालपुरा बाईपास" },
};

/**
 * Turn a Buffer Index into the sentence a commuter would say.
 *
 * 0.42 means nothing to anyone. "Budget 27 minutes for a 19 minute trip" is the
 * same fact and is the version that gets repeated in a meeting. The index is
 * still shown, because the officials who know the standard will look for it.
 */
function budgetSentence(row: ReliabilityRow, hi: boolean): string | null {
  const mean = row.mean_travel_time_s;
  const p95 = row.p95_travel_time_s;
  if (!mean || !p95) return null;
  const typical = Math.round(mean / 60);
  const budget = Math.round(p95 / 60);
  if (typical < 1 || budget <= typical) return null;
  return hi
    ? `${typical} मिनट की यात्रा के लिए ${budget} मिनट रखें`
    : `Budget ${budget} minutes for a ${typical} minute trip`;
}

/**
 * Travel time reliability, the one measure here with no model in it anywhere.
 *
 * Mean delay is what every traffic product reports and what nobody outside a
 * department feels. Variance is the lived experience: the trip that takes 19
 * minutes most days and 34 on the day it matters. FHWA measures it this way
 * across more than 30 cities, so the definitions are borrowed, not invented.
 *
 * The panel spends most of its space on the collecting state, because that is
 * what it will show for the first fortnight and a panel that renders an empty
 * shell for a fortnight teaches people to ignore it. Saying "34 of 40 sweeps,
 * 6 of 8 hours" is a promise with a date on it.
 */
export function ReliabilityPanel({ data }: { data: Reliability }) {
  const hi = (useLocale() as Locale) === "hi";
  const rows = data.corridors ?? [];
  if (rows.length === 0) return null;
  const ready = rows.filter((r) => r.sufficient);

  return (
    <Panel
      title={hi ? "यात्रा समय विश्वसनीयता" : "Travel time reliability"}
      aside={
        <span className="font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
          {ready.length}/{rows.length} {hi ? "तैयार" : "ready"}
        </span>
      }
    >
      <ul className="space-y-2.5">
        {rows.map((row) => {
          const name = CORRIDOR_NAMES[row.corridor_id ?? 0];
          const label = name ? (hi ? name.hi : name.en) : `#${row.corridor_id}`;
          const sentence = budgetSentence(row, hi);
          return (
            <li key={row.corridor_id} className="border-t border-[var(--rule)] pt-2 first:border-0 first:pt-0">
              <div className="flex items-baseline gap-2 text-[12px]">
                <ModeDot live={row.sufficient} title={row.sufficient ? "reporting" : "collecting"} />
                <span className="min-w-0 flex-1 truncate text-[var(--ink)]">{label}</span>
                {row.sufficient ? (
                  <span className="shrink-0 font-mono tabular-nums text-[var(--accent)]">
                    {(row.buffer_index ?? 0).toFixed(2)}
                  </span>
                ) : (
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--ink-faint)]">
                    {row.samples}/{data.method.min_samples} ·{" "}
                    {row.distinct_hours}/{data.method.min_distinct_hours}h
                  </span>
                )}
              </div>
              {row.sufficient && sentence && (
                <p className="mt-0.5 pl-4 text-[11px] leading-relaxed text-[var(--ink-muted)]">
                  {sentence}
                  <span className="text-[var(--ink-faint)]">
                    {" · PTI "}
                    {(row.planning_time_index ?? 0).toFixed(2)}
                  </span>
                </p>
              )}
              {!row.sufficient && row.needs && (
                <p className="mt-0.5 pl-4 text-[11px] leading-relaxed text-[var(--ink-faint)]">
                  {hi ? "अभी संग्रह हो रहा है — चाहिए " : "Collecting — needs "}
                  {row.needs}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {hi
          ? "बफ़र सूचकांक = (95वाँ प्रतिशतक − औसत) ÷ औसत। पूरी तरह मापा गया, कोई मॉडल नहीं।"
          : "Buffer Index = (95th percentile − mean) ÷ mean. Entirely measured; no model anywhere in it."}
      </p>
      {ready.length < rows.length && (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--ink-faint)]">
          {hi
            ? "एक सूचकांक तब तक रोका जाता है जब तक पर्याप्त स्वीप और दिन के पर्याप्त घंटे न हों।"
            : "An index is withheld until it has both enough sweeps and enough distinct hours behind it."}
        </p>
      )}
    </Panel>
  );
}

/**
 * The live probe layer: what it covers, how old it is, and what it cost.
 *
 * The label distinguishing a probe speed from a modelled one already existed in
 * three places — the map tooltip, the citizen list and the map fallback — and
 * none of them is on screen when the console first loads. So a viewer could
 * read a page full of live TomTom readings and see nothing saying so. This
 * panel is the one place that states it without being hunted for.
 *
 * Three things it refuses to leave out. Segments as well as links, because
 * several links share one TomTom segment and counting links alone overstates
 * how many independent measurements exist. Age, because a stale speed renders
 * as confidently as a fresh one. And the month's remaining allowance, because a
 * free tier nobody is watching is a bill nobody expected.
 */
export function ProbePanel({ data }: { data: ProbeCoverage }) {
  const hi = (useLocale() as Locale) === "hi";
  const stale = !data.is_fresh;
  const segments = data.segments_read ?? 0;
  const links = data.links_covered ?? 0;
  const total = data.corridor_links ?? 0;
  const used = data.budget?.calls_used ?? 0;
  const limit = data.budget?.monthly_limit ?? 0;

  if (!data.provider) return null;

  return (
    <Panel
      title={hi ? "लाइव प्रोब गति" : "Live probe speeds"}
      aside={
        <span className="font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
          {segments} {hi ? "खंड" : "segments"}
        </span>
      }
    >
      <div className="flex items-baseline gap-2 text-[12px]">
        <ModeDot live={!stale} title={stale ? "stale" : "fresh"} />
        <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
          {data.provider}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--ink-faint)]">
          {data.age_minutes === null
            ? "—"
            : `${Math.round(data.age_minutes)}${hi ? " मि" : "m"}`}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <dt className="text-[var(--ink-faint)]">{hi ? "कवरेज" : "Coverage"}</dt>
        <dd className="text-right font-mono tabular-nums text-[var(--ink)]">
          {links}/{total} {hi ? "लिंक" : "links"}
        </dd>
        <dt className="text-[var(--ink-faint)]">{hi ? "कॉल प्रति स्वीप" : "Calls per sweep"}</dt>
        <dd className="text-right font-mono tabular-nums text-[var(--ink)]">{segments}</dd>
        <dt className="text-[var(--ink-faint)]">{hi ? "अंतराल" : "Cadence"}</dt>
        <dd className="text-right font-mono tabular-nums text-[var(--ink)]">
          {data.cadence_minutes ?? "—"}
          {hi ? " मि" : "m"} · {data.window_ist ?? "—"}
        </dd>
        <dt className="text-[var(--ink-faint)]">{hi ? "इस माह" : "This month"}</dt>
        <dd className="text-right font-mono tabular-nums text-[var(--ink)]">
          {used.toLocaleString("en-IN")}/{limit.toLocaleString("en-IN")}
        </dd>
      </dl>

      {stale && (
        <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--accent)]">
          {hi
            ? `${data.max_age_minutes} मिनट से पुराना — लिंक फिर से मॉडल पर लौट आए हैं।`
            : `Older than ${data.max_age_minutes} minutes, so links have fallen back to modelled speeds.`}
        </p>
      )}

      {/* The limit of the source, stated where the source is shown rather than
          in a footnote nobody reaches. This is the gap the platform exists to
          fill, so it should never be discovered later. */}
      <p className="mt-3 border-t border-[var(--rule)] pt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {hi
          ? "TomTom केवल गति और देरी मापता है — कभी संख्या नहीं, कभी संरचना नहीं।"
          : "TomTom measures speed and delay only — never volume, never composition."}
      </p>
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
  const t = translator(useLocale() as Locale);
  if (!data.available) return null;
  return (
    <Panel
      title={t("conditions")}
      aside={
        <span className="text-[10px] text-[var(--ink-faint)]">
          {data.provider} · {data.observed_at === "replay" ? "replay" : "live"}
        </span>
      }
    >
      <MetricRow>
        <Metric label={t("temp")} value={`${data.temperature_c?.toFixed(0)}°`} span={0.28} />
        <Metric
          label={t("rain")}
          value={`${data.precipitation_mm?.toFixed(1)}`}
          unit="mm"
          span={0.28}
        />
        <Metric
          label={t("visibility")}
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
          ? ` ${t("weatherDegraded")}`
          : ` ${t("weatherOk")}`}
      </p>
    </Panel>
  );
}


/** Seven days by twenty-four hours. Measured history, not a forecast. */
export function HeatmapPanel({ data }: { data: WeeklyMatrix }) {
  const t = translator(useLocale() as Locale);
  return (
    <Panel
      title={t("weeklyPattern")}
      aside={<SyntheticTag label={data.window} />}
    >
      <CongestionHeatmap matrix={data.matrix} days={data.days} />
      <p
        className="mt-3 leading-relaxed text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        {t("weeklyNote")}
      </p>
    </Panel>
  );
}


/**
 * Air quality.
 *
 * The only panel on this console whose numbers are BOTH live and real, so it is
 * the one that proves the rest of the pipeline is wired rather than mocked.
 *
 * It says three things a pollution reading usually leaves out: which standard
 * it is measured against (CPCB, because that is what an Indian department is
 * accountable on), that the value is modelled rather than read from a Jaipur
 * instrument, and that no share of it is attributed to traffic. The last one
 * matters most — attributing pollution to traffic needs source apportionment
 * this platform does not have, and the temptation to put a confident
 * percentage there is exactly what would make the panel untrustworthy.
 */
export function AirPanel() {
  const locale = useLocale() as Locale;
  const hi = locale === "hi";
  const { data } = usePoll(() => api.air(), { intervalMs: 300_000 });

  if (!data?.available) return null;

  const over = data.exceeds_cpcb ?? [];
  const bandColour =
    (data.us_aqi ?? 0) <= 50
      ? "var(--congestion-free)"
      : (data.us_aqi ?? 0) <= 100
        ? "var(--congestion-light)"
        : (data.us_aqi ?? 0) <= 150
          ? "var(--congestion-moderate)"
          : (data.us_aqi ?? 0) <= 200
            ? "var(--congestion-severe)"
            : "var(--congestion-critical)";

  return (
    <Panel
      title={hi ? "वायु गुणवत्ता" : "Air quality"}
      aside={
        <span
          className="shrink-0 rounded-full px-2 py-0.5 uppercase tracking-wider"
          style={{
            fontSize: "calc(var(--d-label) * 0.85)",
            background: "color-mix(in oklab, var(--congestion-free) 18%, transparent)",
            color: "var(--congestion-free)",
          }}
        >
          {hi ? "वास्तविक · लाइव" : "real · live"}
        </span>
      }
    >
      <MetricRow>
        <Metric label="PM2.5" value={data.pm2_5?.toFixed(0) ?? "—"} unit="µg/m³" span={0.28} />
        <Metric label="PM10" value={data.pm10?.toFixed(0) ?? "—"} unit="µg/m³" span={0.28} />
        <Metric
          label="NO₂"
          value={data.nitrogen_dioxide?.toFixed(0) ?? "—"}
          unit="µg/m³"
          span={0.28}
        />
      </MetricRow>

      <div className="mt-3 flex items-center gap-2">
        <span
          className="rounded-md px-2 py-0.5 font-mono tabular-nums"
          style={{
            fontSize: "var(--d-support)",
            background: `color-mix(in oklab, ${bandColour} 18%, transparent)`,
            color: bandColour,
          }}
        >
          AQI {data.us_aqi ?? "—"}
        </span>
        <span className="text-[var(--ink-muted)]" style={{ fontSize: "var(--d-support)" }}>
          {over.length > 0
            ? hi
              ? `CPCB सीमा से ऊपर: ${over.join(", ")}`
              : `over CPCB: ${over.join(", ")}`
            : hi
              ? "सभी CPCB 24-घंटा मानकों के भीतर"
              : "within all CPCB 24-hour standards"}
        </span>
      </div>

      <p
        className="mt-3 leading-relaxed text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        {hi
          ? "NO₂ और PM यातायात से जुड़े प्रदूषक हैं। इनमें से कितना यातायात से आता है — यह यहाँ नहीं बताया गया, क्योंकि उसके लिए स्रोत-विभाजन चाहिए जो इस मंच के पास नहीं है।"
          : data.traffic_note}
      </p>
      <p
        className="mt-1.5 text-[var(--ink-faint)]"
        style={{ fontSize: "calc(var(--d-support) * 0.92)" }}
      >
        {data.provider} — {data.source_kind}
      </p>
    </Panel>
  );
}
