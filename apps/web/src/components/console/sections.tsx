"use client";

import { CorpusSearch } from "./corpus-search";
import { AreaScreeningPanel } from "./area-screening";
import { useEffect, useState } from "react";

import {
  api,
  congestionVar,
  type BlackSpots,
  type Camera,
  type CountsSummary,
  type Defaulters,
  type EnforcementSummary,
  type IncidentTimeline,
  type Junctions,
  type PolicyScenarios,
  type EdgeCameras,
  type NeetiAnswer,
  type NeetiCatalogue,
  type PublishedFigures,
  type Representation,
  type Fairness,
  type SourceReadiness,
  type SignalAdvisory,
  type WeeklyMatrix,
} from "@/lib/api";
import type { AreaScreening } from "@/lib/api";
import type { SceneLink } from "@/components/city/city-view";
import type { Locale } from "@/i18n/routing";
import { formatCount } from "@/lib/format";
import { useCan } from "@/lib/rbac";
import { IncidentTimelineChart } from "@/components/charts/incident-timeline";
import { CongestionHeatmap } from "@/components/charts/heatmap";
import { Bar, Metric, MetricRow, ModeDot, Panel, Pulse, SyntheticTag } from "./primitives";

/**
 * The non-map sections.
 *
 * Each one is fetched only when it is opened. The console already ships a
 * WebGL scene and ten panels on first paint; loading an enforcement queue
 * nobody has asked for on top of that spends the frame budget on a screen the
 * user is not looking at.
 */

function useLazy<T>(load: () => Promise<T>, active: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    load()
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure each render; keying on `active` is what makes
    // this fire exactly once per opening rather than on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { data, error };
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="mb-5">
        <h1 className="font-display text-2xl tracking-tight">{title}</h1>
        <p
          className="mt-1 max-w-2xl leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {subtitle}
        </p>
      </header>
      <div className="grid gap-3">{children}</div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div
      className="grid place-items-center rounded-[var(--d-radius)] bg-[var(--surface-2)] py-16
                 text-[var(--ink-faint)]"
      style={{ fontSize: "var(--d-support)", boxShadow: "var(--rim)" }}
    >
      <Pulse label={label} />
    </div>
  );
}

function Denied({ hi }: { hi: boolean }) {
  return (
    <div
      className="rounded-[var(--d-radius)] bg-[var(--surface-2)] p-8 text-center"
      style={{ boxShadow: "var(--rim)" }}
    >
      <p className="text-[var(--ink)]" style={{ fontSize: "var(--d-body)" }}>
        {hi ? "इस अनुभाग की अनुमति नहीं" : "Not permitted for this role"}
      </p>
      <p
        className="mx-auto mt-2 max-w-md leading-relaxed text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        {hi
          ? "यह इंटरफ़ेस परत है। सर्वर भी इसी अनुरोध को अस्वीकार करता है — छिपाना सुरक्षा नहीं है।"
          : "This is the interface layer. The server refuses the same request independently — hiding a control is not access control."}
      </p>
    </div>
  );
}

export function SectionView({
  section,
  locale,
  links,
  summary,
  signals,
  incidents,
  blackspots,
  weekly,
  cameras,
}: {
  section: string;
  locale: Locale;
  links: SceneLink[];
  summary: CountsSummary;
  signals: SignalAdvisory;
  incidents: IncidentTimeline;
  blackspots: BlackSpots;
  weekly: WeeklyMatrix;
  cameras: Camera[];
}) {
  const hi = locale === "hi";
  const can = useCan();

  if (section === "counts") {
    return <CountsSection {...{ hi, links, summary, locale }} />;
  }
  if (section === "junctions") {
    return <JunctionsSection hi={hi} active />;
  }
  if (section === "edge") {
    return <EdgeSection hi={hi} locale={locale} />;
  }
  if (section === "incidents") {
    return <IncidentsSection {...{ hi, incidents, blackspots }} />;
  }
  if (section === "signals") {
    return <SignalsSection hi={hi} signals={signals} />;
  }
  if (section === "enforcement") {
    if (!can("read:enforcement")) return <Shell title={hi ? "प्रवर्तन" : "Enforcement"} subtitle=""><Denied hi={hi} /></Shell>;
    return <EnforcementSection hi={hi} locale={locale} canUnmask={can("unmask:plate")} canDefaulters={can("read:defaulters")} />;
  }
  if (section === "areas") {
    return <AreasSection hi={hi} />;
  }
  if (section === "neeti") {
    return <NeetiSection hi={hi} locale={locale} />;
  }
  if (section === "provenance") {
    return <ProvenanceSection hi={hi} locale={locale} />;
  }
  if (section === "reports") {
    return <ReportsSection hi={hi} weekly={weekly} cameras={cameras} />;
  }
  return null;
}

/* ── counts ─────────────────────────────────────────────────────────────── */

function CountsSection({
  hi,
  links,
  summary,
  locale,
}: {
  hi: boolean;
  links: SceneLink[];
  summary: CountsSummary;
  locale: Locale;
}) {
  const [sort, setSort] = useState<"congestion" | "flow" | "speed">("congestion");
  const sorted = [...links].sort((a, b) =>
    sort === "flow"
      ? b.flow - a.flow
      : sort === "speed"
        ? a.speed_kmh - b.speed_kmh
        : b.congestion_index - a.congestion_index,
  );

  return (
    <Shell
      title={hi ? "गणना" : "Counts"}
      subtitle={
        hi
          ? "प्रत्येक लिंक, उसकी मापी गई गिनती और गुणवत्ता के साथ। दबाए गए लिंक खाली सड़कें नहीं हैं — वे वे सड़कें हैं जिन पर हम रिपोर्ट देने से इनकार करते हैं।"
          : "Every link with its measured count and quality. A suppressed link is not a clear road — it is a road we decline to report on."
      }
    >
      <Panel title={hi ? "कुल" : "Totals"} aside={<SyntheticTag label={hi ? "अनुरूपित" : "Simulated"} />}>
        <MetricRow>
          <Metric
            label={hi ? "वाहन" : "Vehicles"}
            value={formatCount(summary.total_vehicles, locale)}
            span={0.3}
          />
          <Metric
            label="PCU"
            value={formatCount(summary.total_pcu, locale)}
            span={0.3}
          />
          <Metric
            label={hi ? "गुणवत्ता" : "Quality"}
            value={summary.data_quality.mean_score.toFixed(2)}
            span={0.3}
            quality={`${summary.data_quality.suppressed_bins} ${hi ? "बिन दबाए" : "bins suppressed"}`}
          />
        </MetricRow>
      </Panel>

      <Panel
        title={hi ? "लिंक" : "Links"}
        aside={
          <div className="flex gap-1">
            {(["congestion", "flow", "speed"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSort(k)}
                aria-pressed={sort === k}
                className="rounded-md px-2 py-0.5 text-[var(--ink-faint)] transition-colors
                           hover:text-[var(--ink)] aria-[pressed=true]:bg-[var(--surface-3)]
                           aria-[pressed=true]:text-[var(--ink)]"
                style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
              >
                {k === "congestion" ? (hi ? "भीड़" : "Index") : k === "flow" ? (hi ? "प्रवाह" : "Flow") : (hi ? "गति" : "Speed")}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem]" style={{ fontSize: "var(--d-support)" }}>
            <thead>
              <tr
                className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
                style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
              >
                <th className="pb-2 font-medium">{hi ? "लिंक" : "Link"}</th>
                <th className="pb-2 font-medium">{hi ? "भीड़" : "Congestion"}</th>
                <th className="pb-2 text-right font-medium">{hi ? "प्रवाह" : "Flow"}</th>
                <th className="pb-2 text-right font-medium">{hi ? "गति" : "Speed"}</th>
                <th className="pb-2 text-right font-medium">{hi ? "लेन" : "Lanes"}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => (
                <tr
                  key={l.link_id}
                  className="border-t border-[var(--rule)] transition-colors hover:bg-[var(--surface-3)]"
                >
                  <td className="max-w-[16rem] truncate py-2">{hi ? l.name.hi : l.name.en}</td>
                  <td className="w-40 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 shrink-0 font-mono tabular-nums">
                        {l.congestion_index.toFixed(0)}
                      </span>
                      <Bar
                        fraction={l.congestion_index / 100}
                        colour={
                          l.suppressed
                            ? "var(--quality-suppressed)"
                            : congestionVar(l.congestion_index)
                        }
                      />
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                    {l.flow > 0 ? Math.round(l.flow).toLocaleString("en-IN") : "—"}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                    {l.speed_kmh.toFixed(0)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-[var(--ink-faint)]">
                    {l.lanes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Shell>
  );
}

/* ── junctions ──────────────────────────────────────────────────────────── */

function JunctionsSection({ hi, active }: { hi: boolean; active: boolean }) {
  const { data } = useLazy<Junctions>(() => api.junctions(), active);

  return (
    <Shell
      title={hi ? "चौराहे" : "Junctions"}
      subtitle={
        hi
          ? "आठ उपकरणीकृत चौराहे। ATCS वाले प्रतिक्रिया दे सकते हैं; निश्चित-समय वाले नहीं। यह अंतर ही अनुकूली नियंत्रण का पूरा मामला है।"
          : "Eight instrumented junctions. The ATCS ones can respond; the fixed-timer ones cannot. That difference is the entire case for adaptive control."
      }
    >
      {!data ? (
        <Loading label={hi ? "लोड हो रहा है" : "Loading"} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.junctions.map((j) => (
            <Panel
              key={j.junction_id}
              title={hi ? j.name.hi : j.name.en}
              aside={
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 uppercase tracking-wider"
                  style={{
                    fontSize: "calc(var(--d-label) * 0.85)",
                    background:
                      j.signal_type === "atcs"
                        ? "color-mix(in oklab, var(--congestion-free) 22%, transparent)"
                        : "var(--surface-3)",
                    color:
                      j.signal_type === "atcs" ? "var(--congestion-free)" : "var(--ink-muted)",
                  }}
                >
                  {j.signal_type}
                </span>
              }
            >
              <MetricRow>
                <Metric
                  label={hi ? "भीड़" : "Congestion"}
                  value={j.congestion != null ? j.congestion.toFixed(0) : "—"}
                  span={0.4}
                  {...(j.congestion == null
                    ? {
                        quality: hi
                          ? "250 मी के भीतर कोई मापा लिंक नहीं"
                          : "no measured link within 250 m",
                      }
                    : {})}
                />
                <Metric
                  label={hi ? "पहुँच" : "Approaches"}
                  value={String(j.approaches)}
                  span={0.4}
                />
              </MetricRow>
            </Panel>
          ))}
        </div>
      )}
    </Shell>
  );
}


/* ── edge & computer vision ─────────────────────────────────────────────── */

function EdgeSection({ hi, locale }: { hi: boolean; locale: Locale }) {
  const { data } = useLazy<EdgeCameras>(() => api.edge(), true);
  const totalClass = data ? data.classes.reduce((a, c) => a + c.vehicles, 0) : 0;

  return (
    <Shell
      title={hi ? "एज · कंप्यूटर विज़न" : "Edge · computer vision"}
      subtitle={
        hi
          ? "यही वह चीज़ है जो प्रोब उत्पाद नहीं कर सकते। वे देरी का अनुमान लगाते हैं; यह वाहन गिनता है, उनका वर्ग बताता है, और हर कैमरे की अपनी सत्यापित सटीकता साथ दिखाता है।"
          : "This is the part a probe product cannot do. Probes estimate delay; this counts vehicles, classifies them, and shows each camera's own validated accuracy beside its output."
      }
    >
      {!data ? (
        <Loading label={hi ? "एज नोड्स" : "Edge nodes"} />
      ) : (
        <>
          <Panel
            title={hi ? "प्रति कैमरा थ्रूपुट" : "Throughput per camera"}
            emphasis
            aside={<SyntheticTag label={hi ? "अनुरूपित" : "Simulated"} />}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem]" style={{ fontSize: "var(--d-support)" }}>
                <thead>
                  <tr
                    className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
                    style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
                  >
                    <th className="pb-2 font-medium">{hi ? "स्थान" : "Location"}</th>
                    <th className="pb-2 font-medium">{hi ? "स्थिति" : "Status"}</th>
                    <th className="pb-2 text-right font-medium">
                      {hi ? "वाहन/मिनट" : "Veh/min"}
                    </th>
                    <th className="pb-2 text-right font-medium">{hi ? "24 घं" : "24h"}</th>
                    <th className="pb-2 text-right font-medium">{hi ? "गुणवत्ता" : "Quality"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cameras.map((c) => (
                    <tr
                      key={c.camera_id}
                      className="border-t border-[var(--rule)] transition-colors hover:bg-[var(--surface-3)]"
                    >
                      <td className="py-2">
                        {hi ? c.junction.hi : c.junction.en}
                        <span className="ml-2 font-mono text-[var(--ink-faint)]">
                          {c.external_ref}
                        </span>
                      </td>
                      <td className="py-2">
                        <ModeDot
                          live={c.status === "active"}
                          title={c.status}
                        />
                        <span className="ml-1.5 text-[var(--ink-muted)]">{c.status}</span>
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {c.vehicles_per_minute ?? "—"}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                        {formatCount(c.vehicles_24h, locale)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-[var(--ink-faint)]">
                        {c.quality?.toFixed(2) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p
              className="mt-3 leading-relaxed text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {hi
                ? "प्रति मिनट बताया गया है, प्रति घंटा नहीं — एक ऑपरेटर साठ सेकंड गिनकर इसे लाइव फ़ीड के विरुद्ध जाँच सकता है। प्रति-घंटा आँकड़ा कमरे में असत्यापनीय है।"
                : "Reported per minute, not per hour: an operator can check it against a live feed by counting for sixty seconds. A per-hour figure is unfalsifiable in the room."}
            </p>
          </Panel>

          <Panel title={hi ? "वर्गीकरण · 24 घंटे" : "Classification · 24h"}>
            <ul className="grid gap-2">
              {data.classes.map((c) => (
                <li key={c.class_code}>
                  <div
                    className="flex items-baseline justify-between gap-2"
                    style={{ fontSize: "var(--d-support)" }}
                  >
                    <span className="min-w-0 truncate">{hi ? c.name.hi : c.name.en}</span>
                    <span className="shrink-0 font-mono tabular-nums text-[var(--ink-muted)]">
                      {formatCount(c.vehicles, locale)}
                    </span>
                  </div>
                  <div className="mt-1">
                    <Bar
                      fraction={totalClass ? c.vehicles / totalClass : 0}
                      colour="var(--accent)"
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={hi ? "पाइपलाइन" : "Pipeline"}>
            <dl className="grid gap-2.5" style={{ fontSize: "var(--d-support)" }}>
              {(
                [
                  [hi ? "डिटेक्टर" : "Detector", data.pipeline.detector],
                  [hi ? "ट्रैकर" : "Tracker", data.pipeline.tracker],
                  [hi ? "रनटाइम" : "Runtime", data.pipeline.runtime],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                    {label}
                  </dt>
                  <dd className="min-w-0 truncate text-right font-mono text-[var(--ink)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 grid gap-2.5">
              {[data.pipeline.privacy, data.pipeline.licence_note, data.pipeline.edge_note].map(
                (note) => (
                  <p
                    key={note}
                    className="rounded-lg bg-[var(--surface-1)] px-3 py-2 leading-relaxed
                               text-[var(--ink-muted)]"
                    style={{ fontSize: "var(--d-support)" }}
                  >
                    {note}
                  </p>
                ),
              )}
            </div>

            <p
              className="mt-3 leading-relaxed text-[var(--accent)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {data.status}
            </p>
          </Panel>
        </>
      )}
    </Shell>
  );
}

/* ── incidents ──────────────────────────────────────────────────────────── */

function IncidentsSection({
  hi,
  incidents,
  blackspots,
}: {
  hi: boolean;
  incidents: IncidentTimeline;
  blackspots: BlackSpots;
}) {
  return (
    <Shell
      title={hi ? "घटनाएँ और सुरक्षा" : "Incidents & safety"}
      subtitle={
        hi
          ? "दुर्घटनाएँ और भीड़-विसंगतियाँ अलग-अलग वस्तुएँ हैं और अलग रखी गई हैं। इन्हें जोड़ने से ऐसा कुल बनता है जिसका कोई अर्थ नहीं।"
          : "Crashes and congestion anomalies are different objects and are kept apart. Adding them would produce a total that means nothing."
      }
    >
      <Panel
        title={hi ? "घंटे के अनुसार दुर्घटनाएँ" : "Crashes by hour"}
        emphasis
        aside={<SyntheticTag label={hi ? "अनुरूपित" : "Simulated"} />}
      >
        <IncidentTimelineChart hours={incidents.hours} height={200} />
        <p
          className="mt-3 leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {hi
            ? `${incidents.totals.crashes.toLocaleString("en-IN")} दुर्घटनाएँ, ${incidents.totals.deaths.toLocaleString("en-IN")} मौतें (${incidents.totals.since}–${incidents.totals.until})। शिखर ${String(incidents.peak_hour).padStart(2, "0")}:00 — वही घंटा जब भीड़ चरम पर होती है।`
            : `${incidents.totals.crashes.toLocaleString("en-IN")} crashes and ${incidents.totals.deaths.toLocaleString("en-IN")} deaths, ${incidents.totals.since}–${incidents.totals.until}. The peak is ${String(incidents.peak_hour).padStart(2, "0")}:00 — the same hour congestion peaks.`}
        </p>
      </Panel>

      <Panel title={hi ? "डिटेक्टर" : "Detector"}>
        <MetricRow>
          <Metric
            label={hi ? "खुली" : "Open"}
            value={String(incidents.detector.active)}
            span={0.3}
          />
          <Metric
            label={hi ? "24 घंटे में" : "In 24h"}
            value={String(incidents.detector.detected_24h)}
            span={0.3}
          />
        </MetricRow>
        <p
          className="mt-3 leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {hi
            ? "विधि: उसी लिंक के अपने सप्ताह-दिन-घंटा माध्यिका के विरुद्ध मजबूत अवशेष। बीजित प्रोफ़ाइल चिकनी है, इसलिए कुछ ही विसंगतियाँ मिलती हैं — यह सच है, कमी नहीं।"
            : `Method: ${incidents.detector.method}. The seeded profile is smooth, so few anomalies exist to find — that is a true result rather than a shortfall.`}
        </p>
      </Panel>

      <Panel title={hi ? "ब्लैक स्पॉट · गंभीरता" : "Black spots · severity"}>
        <ul className="grid gap-2">
          {blackspots.segments.slice(0, 8).map((s, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 border-b border-[var(--rule)] pb-2 last:border-0"
              style={{ fontSize: "var(--d-support)" }}
            >
              <span className="min-w-0 truncate">
                {hi ? s.name.hi : s.name.en}
                <span className="ml-2 text-[var(--ink-faint)]">
                  {s.deaths} {hi ? "मौतें" : "deaths"} · {s.crashes}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-[var(--congestion-critical)]">
                {s.severity_rate.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        <p
          className="mt-3 leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {blackspots.note}
        </p>
      </Panel>
    </Shell>
  );
}

/* ── signals ────────────────────────────────────────────────────────────── */

function SignalsSection({ hi, signals }: { hi: boolean; signals: SignalAdvisory }) {
  return (
    <Shell
      title={hi ? "सिग्नल" : "Signals"}
      subtitle={
        hi
          ? "हर योजना सलाहकार है। कोई कोड पथ सिग्नल नियंत्रक तक नहीं पहुँचता — एक इंजीनियर समीक्षा करता है, एक मनुष्य लागू करता है।"
          : "Every plan here is advisory. No code path reaches a signal controller: an engineer reviews, a human applies."
      }
    >
      <Panel
        title={hi ? "सलाह" : "Advisories"}
        aside={
          <span
            className="shrink-0 rounded-full bg-[var(--surface-3)] px-2 py-0.5 uppercase
                       tracking-wider text-[var(--accent)]"
            style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
          >
            {hi ? "सलाहकार" : "Advisory"}
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem]" style={{ fontSize: "var(--d-support)" }}>
            <thead>
              <tr
                className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
                style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
              >
                <th className="pb-2 font-medium">{hi ? "चौराहा" : "Junction"}</th>
                <th className="pb-2 text-right font-medium">{hi ? "संतृप्ति" : "Saturation"}</th>
                <th className="pb-2 text-right font-medium">{hi ? "चक्र" : "Cycle"}</th>
                <th className="pb-2 text-right font-medium">{hi ? "गुणवत्ता" : "Quality"}</th>
              </tr>
            </thead>
            <tbody>
              {signals.advisories.map((a) => (
                <tr key={a.junction_id} className="border-t border-[var(--rule)]">
                  <td className="py-2">
                    {hi ? a.name.hi : a.name.en}
                    <span className="ml-2 text-[var(--ink-faint)]">{a.signal_type}</span>
                  </td>
                  <td
                    className="py-2 text-right font-mono tabular-nums"
                    style={{
                      // Above 0.9 the junction is at capacity and no cycle
                      // length rescues it — that is a geometry problem, and
                      // saying so is more useful than a longer green.
                      color:
                        a.degree_of_saturation >= 0.9
                          ? "var(--congestion-critical)"
                          : a.degree_of_saturation >= 0.75
                            ? "var(--congestion-severe)"
                            : "var(--ink)",
                    }}
                  >
                    {a.degree_of_saturation.toFixed(2)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {a.has_measurement ? `${a.recommended_cycle_s}s` : "—"}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-[var(--ink-faint)]">
                    {a.has_measurement ? a.quality.toFixed(2) : (hi ? "अमापित" : "unmeasured")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p
          className="mt-3 leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {signals.method} — {signals.governance}
        </p>
      </Panel>
    </Shell>
  );
}

/* ── enforcement ────────────────────────────────────────────────────────── */

const VIOLATION_LABEL: Record<string, { en: string; hi: string }> = {
  no_helmet: { en: "No helmet", hi: "बिना हेलमेट" },
  red_light: { en: "Red light", hi: "लाल बत्ती" },
  speed: { en: "Speeding", hi: "तेज़ गति" },
  triple_riding: { en: "Triple riding", hi: "तिहरी सवारी" },
  wrong_side: { en: "Wrong side", hi: "गलत दिशा" },
  no_seatbelt: { en: "No seatbelt", hi: "बिना सीटबेल्ट" },
  lane: { en: "Lane discipline", hi: "लेन अनुशासन" },
};

function EnforcementSection({
  hi,
  locale,
  canUnmask,
  canDefaulters,
}: {
  hi: boolean;
  locale: Locale;
  canUnmask: boolean;
  canDefaulters: boolean;
}) {
  const { data } = useLazy<EnforcementSummary>(() => api.enforcement(), true);
  const { data: def } = useLazy<Defaulters>(() => api.defaulters(8), canDefaulters);

  return (
    <Shell
      title={hi ? "प्रवर्तन" : "Enforcement"}
      subtitle={
        hi
          ? "नंबर प्लेट केवल HMAC डाइजेस्ट और सिफरटेक्स्ट के रूप में रखी जाती है — कभी सादे पाठ में नहीं। इसे प्रकट करना एक अलग, लेखा-परीक्षित कार्रवाई है।"
          : "A plate is stored as an HMAC digest and as ciphertext, never as text. Revealing one is a separate, audited action with a reason code."
      }
    >
      {!data ? (
        <Loading label={hi ? "कतार लोड हो रही है" : "Loading queue"} />
      ) : (
        <>
          <Panel title={hi ? "विश्वास द्वार" : "Confidence gate"} emphasis>
            <MetricRow>
              <Metric
                label={hi ? "कुल" : "Total"}
                value={formatCount(data.totals.total, locale)}
                span={0.3}
              />
              <Metric
                label={hi ? "0.85 से नीचे" : "Below 0.85"}
                value={formatCount(data.totals.below_confidence_gate, locale)}
                span={0.3}
                quality={hi ? "मानव समीक्षा अनिवार्य" : "human review required"}
              />
              <Metric
                label={hi ? "द्वार उल्लंघन" : "Gate breaches"}
                value={String(data.totals.auto_confirmed_below_gate)}
                span={0.3}
                quality={hi ? "डेटाबेस बाधा द्वारा असंभव" : "made impossible by a DB constraint"}
              />
            </MetricRow>
            <p
              className="mt-3 leading-relaxed text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {data.governance}
            </p>
          </Panel>

          <Panel title={hi ? "उल्लंघन कतार" : "Violation queue"}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem]" style={{ fontSize: "var(--d-support)" }}>
                <thead>
                  <tr
                    className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
                    style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
                  >
                    <th className="pb-2 font-medium">{hi ? "प्रकार" : "Type"}</th>
                    <th className="pb-2 text-right font-medium">{hi ? "कुल" : "Total"}</th>
                    <th className="pb-2 text-right font-medium">{hi ? "लंबित" : "Pending"}</th>
                    <th className="pb-2 text-right font-medium">{hi ? "पुष्ट" : "Confirmed"}</th>
                    <th className="pb-2 text-right font-medium">{hi ? "स्वतः" : "Auto"}</th>
                    <th className="pb-2 text-right font-medium">OCR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.types.map((t) => (
                    <tr
                      key={t.violation_type}
                      className="border-t border-[var(--rule)] transition-colors hover:bg-[var(--surface-3)]"
                    >
                      <td className="py-2">
                        {VIOLATION_LABEL[t.violation_type]?.[hi ? "hi" : "en"] ?? t.violation_type}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">{t.total}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-[var(--congestion-moderate)]">
                        {t.pending}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-[var(--congestion-free)]">
                        {t.confirmed}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                        {t.auto_confirmed}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-[var(--ink-faint)]">
                        {t.mean_confidence.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!canUnmask && (
              <p
                className="mt-3 leading-relaxed text-[var(--ink-faint)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {hi
                  ? "इस भूमिका के पास नंबर प्लेट देखने की अनुमति नहीं है। केवल प्रवर्तन पर्यवेक्षक, कारण कोड के साथ।"
                  : "This role may not reveal a plate. Enforcement supervisor only, with a reason code."}
              </p>
            )}
          </Panel>

          <FairnessPanel hi={hi} locale={locale} />

          {canDefaulters && (
            <Panel title={hi ? "डिफॉल्टर · गंभीरता-भारित" : "Defaulters · severity-weighted"}>
              {!def ? (
                <Loading label={hi ? "लोड" : "Loading"} />
              ) : (
                <>
                  <ul className="grid gap-2.5">
                    {def.defaulters.map((d) => (
                      <li
                        key={d.plate_ref}
                        className="rounded-lg bg-[var(--surface-1)] p-3"
                        style={{ fontSize: "var(--d-support)" }}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-mono text-[var(--ink-muted)]">
                            {d.plate_ref}…
                          </span>
                          <span className="font-mono tabular-nums text-[var(--congestion-severe)]">
                            {d.severity_score?.toFixed(1) ?? "—"}
                          </span>
                        </div>
                        <p className="mt-1 text-[var(--ink-faint)]">
                          {d.pending_challans} {hi ? "लंबित चालान" : "pending challans"}
                          {d.pending_amount_inr != null &&
                            ` · ₹${d.pending_amount_inr.toLocaleString("en-IN")}`}
                        </p>
                        {/* docs/07 §6: no unexplained score reaches a human.
                            The DB refuses to store one, so this is always here. */}
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {d.explanation.slice(0, 3).map((f, i) => (
                            <li
                              key={i}
                              className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[var(--ink-muted)]"
                              style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
                            >
                              {f.feature} {f.direction === "increases" ? "↑" : "↓"}{" "}
                              {f.shap_value.toFixed(2)}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                  <p
                    className="mt-3 leading-relaxed text-[var(--ink-muted)]"
                    style={{ fontSize: "var(--d-support)" }}
                  >
                    {def.basis}
                  </p>
                </>
              )}
            </Panel>
          )}
        </>
      )}
    </Shell>
  );
}

/* ── NEETI: policy ──────────────────────────────────────────────────────── */

const SCENARIO_LABEL: Record<string, { en: string; hi: string }> = {
  low_emission_zone: { en: "Low-emission zone", hi: "कम-उत्सर्जन क्षेत्र" },
  congestion_charge: { en: "Congestion charge", hi: "भीड़ शुल्क" },
};

function AreasSection({ hi }: { hi: boolean }) {
  const { data } = useLazy<AreaScreening>(() => api.areas(), true);
  return (
    <Shell
      title={hi ? "क्षेत्र स्क्रीनिंग" : "Area screening"}
      subtitle={
        hi
          ? "कौन सा इलाका कितना लदा है। सीमाएँ थानों के आसपास अनुमानित हैं, अधिसूचित नहीं — विभाग की अपनी शीट आते ही बदल जाएँगी।"
          : "Which part of the city is loaded, and by how much. Boundaries are approximated around police stations, not gazetted, and swap out the day the department supplies its own."
      }
    >
      {!data ? (
        <Loading label={hi ? "क्षेत्र जोड़े जा रहे हैं" : "Aggregating areas"} />
      ) : (
        <AreaScreeningPanel data={data} hi={hi} />
      )}
    </Shell>
  );
}

function NeetiSection({ hi, locale }: { hi: boolean; locale: Locale }) {
  const { data } = useLazy<PolicyScenarios>(() => api.policy(1), true);

  return (
    <Shell
      title={hi ? "नीति" : "NEETI · policy"}
      subtitle={
        hi
          ? "यह स्लाइड नहीं है। हर आँकड़ा इसी कॉरिडोर के मापे गए वर्ग-मिश्रण और अंशांकित गति-वक्र से गणना किया गया है — और हर धारणा नाम लेकर बताई गई है।"
          : "Not a slide. Every figure is computed from this corridor's own measured class mix and the calibrated speed curve — and every assumption is named rather than buried."
      }
    >
      {!data ? (
        <Loading label={hi ? "मॉडल चल रहा है" : "Running the model"} />
      ) : (
        <>
          {/* The catalogue answers questions someone thought to anticipate.
              This answers the rest, from the specification, with citations. */}
          <CorpusSearch hi={hi} />

          <RepresentationPanel hi={hi} locale={locale} />

          {/* The PCU argument, which is the whole reason class mix matters. */}
          <Panel
            title={hi ? "सड़क स्थान बनाम वाहन संख्या" : "Road space vs vehicle count"}
            emphasis
            aside={<SyntheticTag label={hi ? "अनुरूपित" : "Simulated"} />}
          >
            <MetricRow>
              <Metric
                label={hi ? "वाहन" : "Vehicles"}
                value={formatCount(data.totals.vehicles, locale)}
                span={0.3}
              />
              <Metric
                label="PCU"
                value={formatCount(Math.round(data.totals.pcu), locale)}
                span={0.3}
              />
              <Metric
                label={hi ? "भीड़" : "Congestion"}
                value={data.totals.congestion_index.toFixed(1)}
                span={0.3}
                quality={`${String(data.hour).padStart(2, "0")}:00`}
              />
            </MetricRow>

            <ul className="mt-4 grid gap-2">
              {data.classes.slice(0, 6).map((c) => {
                const vehShare = c.vehicles / data.totals.vehicles;
                const pcuShare = c.pcu / data.totals.pcu;
                return (
                  <li key={c.class_code}>
                    <div
                      className="flex items-baseline justify-between gap-2"
                      style={{ fontSize: "var(--d-support)" }}
                    >
                      <span className="min-w-0 truncate">
                        {hi ? c.name.hi : c.name.en}
                        <span className="ml-1.5 text-[var(--ink-faint)]">
                          ×{c.pcu_factor}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-[var(--ink-muted)]">
                        {(vehShare * 100).toFixed(1)}% → {(pcuShare * 100).toFixed(1)}%
                      </span>
                    </div>
                    {/* Two bars, same row: share of vehicles above, share of
                        road space below. Where they disagree is the argument. */}
                    <div className="mt-1 grid gap-0.5">
                      <Bar fraction={vehShare} colour="var(--ink-faint)" />
                      <Bar fraction={pcuShare} colour="var(--accent)" />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p
              className="mt-3 leading-relaxed text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {hi
                ? "ऊपर की पट्टी वाहनों का हिस्सा है, नीचे की सड़क-स्थान का। दोपहिया संख्या में सबसे आगे हैं पर सड़क स्थान में नहीं — किसी भी प्रोब उत्पाद से यह अंतर नहीं निकाला जा सकता।"
                : "The upper bar is share of vehicles, the lower share of road space. Two-wheelers lead on count and not on space — a distinction no probe product can draw."}
            </p>
          </Panel>

          {data.scenarios.map((sc) => {
            const gain =
              ((sc.modelled_speed_kmh - sc.baseline_speed_kmh) / sc.baseline_speed_kmh) * 100;
            return (
              <Panel
                key={sc.scenario}
                title={SCENARIO_LABEL[sc.scenario]?.[hi ? "hi" : "en"] ?? sc.scenario}
                aside={
                  <span
                    className="shrink-0 rounded-full bg-[var(--surface-3)] px-2 py-0.5
                               uppercase tracking-wider text-[var(--accent)]"
                    style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
                  >
                    {hi ? "मॉडल" : "Modelled"}
                  </span>
                }
              >
                <MetricRow>
                  <Metric
                    label={hi ? "PCU हटाया" : "PCU removed"}
                    value={`${sc.pcu_removed_pct}%`}
                    span={0.3}
                  />
                  <Metric
                    label={hi ? "भीड़" : "Congestion"}
                    value={`${sc.baseline_index}→${sc.modelled_index}`}
                    span={0.3}
                  />
                  <Metric
                    label={hi ? "शीर्ष गति" : "Peak speed"}
                    value={`${sc.modelled_speed_kmh}`}
                    unit="km/h"
                    span={0.3}
                    delta={{ value: `${gain.toFixed(0)}%`, direction: "down" }}
                    quality={`${hi ? "अभी" : "now"} ${sc.baseline_speed_kmh}`}
                  />
                </MetricRow>

                {sc.revenue_inr_per_peak_hour != null && (
                  <p
                    className="mt-3 rounded-lg bg-[var(--surface-1)] px-3 py-2 text-[var(--ink-muted)]"
                    style={{ fontSize: "var(--d-support)" }}
                  >
                    ₹{sc.revenue_inr_per_peak_hour.toLocaleString("en-IN")}{" "}
                    {hi ? "प्रति शीर्ष घंटा" : "per peak hour"} · ₹{sc.price_per_pcu_inr}/PCU
                    <span className="ml-2 text-[var(--ink-faint)]">
                      {hi
                        ? "— राजस्व देरी में कमी के साथ दिखाया गया है, उसके बदले नहीं"
                        : "— revenue shown beside the delay it buys, not instead of it"}
                    </span>
                  </p>
                )}

                <p
                  className="mt-3 leading-relaxed text-[var(--ink-muted)]"
                  style={{ fontSize: "var(--d-support)" }}
                >
                  {hi ? sc.note.hi : sc.note.en}
                </p>
              </Panel>
            );
          })}

          {/* The assumptions are a panel, not a footnote. A policy model whose
              assumptions are hard to find is a policy model designed to win an
              argument rather than inform one. */}
          <Panel title={hi ? "धारणाएँ" : "Assumptions"}>
            <dl className="grid gap-3" style={{ fontSize: "var(--d-support)" }}>
              {(
                [
                  ["model", hi ? "मॉडल" : "Model"],
                  ["speed_curve", hi ? "गति वक्र" : "Speed curve"],
                  ["elasticity", hi ? "प्रत्यास्थता" : "Elasticity"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt className="uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                    {label}
                  </dt>
                  <dd className="mt-0.5 leading-relaxed text-[var(--ink-muted)]">
                    {data.assumptions[key]}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <NeetiAsk hi={hi} />
        </>
      )}
    </Shell>
  );
}

/* ── reports ────────────────────────────────────────────────────────────── */

function ReportsSection({
  hi,
  weekly,
  cameras,
}: {
  hi: boolean;
  weekly: WeeklyMatrix;
  cameras: Camera[];
}) {
  return (
    <Shell
      title={hi ? "रिपोर्ट" : "Reports"}
      subtitle={
        hi
          ? "मापी गई इतिहास, पूर्वानुमान नहीं। यही वह दृश्य है जहाँ 'शुक्रवार सबसे खराब दिन था' जैसा दावा उद्धरण से जाँच-योग्य बनता है।"
          : "Measured history, not a forecast. This is where a claim like “Friday was the worst day” becomes checkable rather than quoted."
      }
    >
      <Panel title={hi ? "साप्ताहिक पैटर्न" : "Weekly pattern"} emphasis>
        <CongestionHeatmap matrix={weekly.matrix} days={weekly.days} />
        <p
          className="mt-3 leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {weekly.window}
        </p>
      </Panel>

      <Panel title={hi ? "कैमरा प्रमाणन" : "Camera certification"}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem]" style={{ fontSize: "var(--d-support)" }}>
            <thead>
              <tr
                className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
                style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
              >
                <th className="pb-2 font-medium">{hi ? "कैमरा" : "Camera"}</th>
                <th className="pb-2 font-medium">{hi ? "स्थिति" : "Status"}</th>
                <th className="pb-2 text-right font-medium">{hi ? "दिन" : "Day"}</th>
                <th className="pb-2 text-right font-medium">{hi ? "रात" : "Night"}</th>
              </tr>
            </thead>
            <tbody>
              {cameras.map((c) => (
                <tr key={c.camera_id} className="border-t border-[var(--rule)]">
                  <td className="py-2">{hi ? c.junction.hi : c.junction.en}</td>
                  <td className="py-2 text-[var(--ink-muted)]">{c.status}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {c.accuracy_cert ? `${((1 - c.accuracy_cert.day_mape) * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {c.accuracy_cert
                      ? `${((1 - c.accuracy_cert.night_mape) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Shell>
  );
}


/* ── NEETI: ask ─────────────────────────────────────────────────────────── */

function NeetiAsk({ hi }: { hi: boolean }) {
  const { data: catalogue } = useLazy<NeetiCatalogue>(() => api.neetiQuestions(), true);
  const [answer, setAnswer] = useState<NeetiAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(id: string) {
    setBusy(true);
    setError(null);
    try {
      setAnswer(await api.neetiAsk(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={hi ? "प्रश्न-से-SQL" : "Question to SQL"}>
      {!catalogue ? (
        <Loading label={hi ? "सूची" : "Catalogue"} />
      ) : (
        <>
          {/* The catalogue is listed rather than hidden behind a prompt. A user
              who can see exactly what may be asked does not have to guess, and
              the question space stays honest. */}
          <div className="flex flex-wrap gap-1.5">
            {catalogue.questions.map((q) => (
              <button
                key={q.id}
                type="button"
                disabled={busy}
                onClick={() => void ask(q.id)}
                aria-current={answer?.question.id === q.id}
                className="rounded-full bg-[var(--surface-1)] px-3 py-1.5 text-left
                           text-[var(--ink-muted)] transition-colors
                           hover:bg-[var(--surface-3)] hover:text-[var(--ink)]
                           disabled:opacity-50
                           aria-[current=true]:bg-[var(--surface-3)]
                           aria-[current=true]:text-[var(--ink)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {hi ? q.hi : q.en}
              </button>
            ))}
          </div>

          {error && (
            <p
              className="mt-3 text-[var(--congestion-severe)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {error}
            </p>
          )}

          {answer && (
            <div className="mt-4">
              <div className="overflow-x-auto">
                <table className="w-full" style={{ fontSize: "var(--d-support)" }}>
                  <thead>
                    <tr
                      className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
                      style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
                    >
                      {answer.columns.map((c) => (
                        <th key={c} className="whitespace-nowrap pb-2 pr-4 font-medium">
                          {c.replace(/_/g, " ")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {answer.rows.slice(0, 8).map((row, i) => (
                      <tr key={i} className="border-t border-[var(--rule)]">
                        {answer.columns.map((c) => (
                          <td
                            key={c}
                            className="whitespace-nowrap py-1.5 pr-4 font-mono tabular-nums"
                          >
                            {row[c] ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p
                className="mt-3 leading-relaxed text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {hi ? answer.reading.hi : answer.reading.en}
              </p>

              {/* Shown every time, never behind a disclosure. An answer whose
                  query the reader cannot see is not evidence. */}
              <details className="mt-3">
                <summary
                  className="cursor-pointer text-[var(--accent)]"
                  style={{ fontSize: "var(--d-support)" }}
                >
                  {hi
                    ? `चलाया गया SQL · ${answer.row_count} पंक्तियाँ · ${answer.elapsed_ms} ms`
                    : `SQL that ran · ${answer.row_count} rows · ${answer.elapsed_ms} ms`}
                </summary>
                <pre
                  className="mt-2 overflow-x-auto rounded-lg bg-[var(--surface-1)] p-3
                             font-mono leading-relaxed text-[var(--ink-muted)]"
                  style={{ fontSize: "calc(var(--d-support) * 0.92)" }}
                >
                  {answer.sql}
                </pre>
              </details>
            </div>
          )}

          <p
            className="mt-4 leading-relaxed text-[var(--ink-faint)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {catalogue.planner}
          </p>
          <p
            className="mt-2 font-mono text-[var(--ink-faint)]"
            style={{ fontSize: "calc(var(--d-support) * 0.92)" }}
          >
            {catalogue.rails.role} · cap {catalogue.rails.row_cap} ·{" "}
            {catalogue.rails.statement_timeout_ms} ms · DDL/DML {catalogue.rails.ddl_dml}
          </p>
        </>
      )}
    </Panel>
  );
}


/* ── provenance ─────────────────────────────────────────────────────────── */

/**
 * Where every number on this platform comes from.
 *
 * This section exists because "is any of this real?" is the question a
 * government reviewer asks second, right after "does it work?", and answering
 * it in a slide is answering it in the one place they cannot check. Answering
 * it in the product — with the live sources actually live, and the synthetic
 * ones named as synthetic beside what they are calibrated against — is the
 * difference between a claim and a demonstration.
 *
 * The table below is deliberately unflattering. Four of seven sources are on
 * replay, and saying so plainly is what makes the three that are live
 * believable.
 */

const DATASETS: {
  table: string;
  en: string;
  hi: string;
  rows: string;
  kind: "real" | "calibrated" | "generated";
  basis_en: string;
  basis_hi: string;
}[] = [
  {
    table: "road_links",
    en: "Road network",
    hi: "सड़क नेटवर्क",
    rows: "594 links · 8 junctions",
    kind: "real",
    basis_en: "OpenStreetMap geometry, fetched and tiled. Real carriageways, lane counts and building footprints.",
    basis_hi: "OpenStreetMap ज्यामिति। वास्तविक सड़कें, लेन संख्या और भवन।",
  },
  {
    table: "crashes",
    en: "Crash records",
    hi: "दुर्घटना रिकॉर्ड",
    rows: "18,578",
    kind: "calibrated",
    basis_en: "Individual records generated; annual totals reproduce Jaipur police district returns exactly, 2021–2025. Asserted by the test suite.",
    basis_hi: "व्यक्तिगत रिकॉर्ड निर्मित; वार्षिक कुल जयपुर पुलिस के आँकड़ों से ठीक मेल खाते हैं।",
  },
  {
    table: "traffic_counts",
    en: "Vehicle counts",
    hi: "वाहन गणना",
    rows: "1,403,654",
    kind: "calibrated",
    basis_en: "Generated against the TomTom Traffic Index: 94.9% evening peak, 73.9% morning, 17.5 km/h rush mean. All four reproduced exactly.",
    basis_hi: "TomTom सूचकांक के विरुद्ध निर्मित: 94.9% शाम, 73.9% सुबह, 17.5 किमी/घंटा।",
  },
  {
    table: "link_congestion",
    en: "Congestion index",
    hi: "भीड़ सूचकांक",
    rows: "777,600",
    kind: "calibrated",
    basis_en: "Derived from the same calibrated profile. Speed follows a curve solved so the rush-window mean lands on the published figure.",
    basis_hi: "उसी अंशांकित प्रोफ़ाइल से। गति वक्र प्रकाशित आँकड़े पर सेट है।",
  },
  {
    table: "violations",
    en: "Violations",
    hi: "उल्लंघन",
    rows: "1,051",
    kind: "generated",
    basis_en: "No real challan data exists in this instance. Plates are HMAC digests throughout; there is no plaintext registration number to leak.",
    basis_hi: "इस इंस्टेंस में कोई वास्तविक चालान डेटा नहीं। नंबर प्लेट केवल HMAC डाइजेस्ट।",
  },
  {
    table: "defaulter_scores",
    en: "Defaulter scores",
    hi: "डिफॉल्टर स्कोर",
    rows: "500",
    kind: "generated",
    basis_en: "Generated. Every score carries a SHAP explanation — the database refuses to store one without.",
    basis_hi: "निर्मित। हर स्कोर SHAP व्याख्या के साथ — डेटाबेस बिना उसके संग्रह करने से मना करता है।",
  },
];

const KIND_LABEL: Record<string, { en: string; hi: string; colour: string }> = {
  real: { en: "real", hi: "वास्तविक", colour: "var(--congestion-free)" },
  calibrated: { en: "calibrated to real", hi: "वास्तविक से अंशांकित", colour: "var(--congestion-moderate)" },
  generated: { en: "generated", hi: "निर्मित", colour: "var(--ink-faint)" },
};

function ProvenanceSection({ hi, locale }: { hi: boolean; locale: Locale }) {
  const { data: pub } = useLazy<PublishedFigures>(() => api.published(), true);
  const { data: sources } = useLazy<SourceReadiness>(() => api.readiness(), true);

  return (
    <Shell
      title={hi ? "स्रोत और प्रामाणिकता" : "Data provenance"}
      subtitle={
        hi
          ? "हर आँकड़ा कहाँ से आता है। लाइव स्रोत वास्तव में लाइव हैं; अनुरूपित डेटा को अनुरूपित कहा गया है, साथ में यह भी कि वह किसके विरुद्ध अंशांकित है।"
          : "Where every number comes from. The live sources are genuinely live; the synthetic ones are named as synthetic, beside what they are calibrated against."
      }
    >
      {sources && (
        <Panel
          title={hi ? "स्रोत" : "Sources"}
          emphasis
          aside={
            <span
              className="shrink-0 font-mono tabular-nums text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {sources.live_count}/{sources.total} {hi ? "लाइव" : "live"}
            </span>
          }
        >
          <ul className="grid gap-2">
            {sources.sources.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 border-b border-[var(--rule)] pb-2 last:border-0"
                style={{ fontSize: "var(--d-support)" }}
              >
                <ModeDot live={s.mode === "live"} title={s.mode} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 text-[var(--ink-faint)]">{s.provider}</span>
                <span
                  className="w-16 shrink-0 text-right uppercase tracking-wider"
                  style={{
                    color:
                      s.mode === "live" ? "var(--congestion-free)" : "var(--ink-faint)",
                    fontSize: "calc(var(--d-label) * 0.9)",
                  }}
                >
                  {s.mode}
                </span>
              </li>
            ))}
          </ul>
          <p
            className="mt-3 leading-relaxed text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {sources.note}
          </p>
        </Panel>
      )}

      <Panel title={hi ? "डेटासेट" : "Datasets"}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]" style={{ fontSize: "var(--d-support)" }}>
            <thead>
              <tr
                className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
                style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
              >
                <th className="pb-2 pr-3 font-medium">{hi ? "डेटा" : "Dataset"}</th>
                <th className="pb-2 pr-3 font-medium">{hi ? "पंक्तियाँ" : "Rows"}</th>
                <th className="pb-2 pr-3 font-medium">{hi ? "प्रकार" : "Kind"}</th>
                <th className="pb-2 font-medium">{hi ? "आधार" : "Basis"}</th>
              </tr>
            </thead>
            <tbody>
              {DATASETS.map((d) => (
                <tr key={d.table} className="border-t border-[var(--rule)] align-top">
                  <td className="py-2.5 pr-3">
                    {hi ? d.hi : d.en}
                    <span className="ml-2 font-mono text-[var(--ink-faint)]">{d.table}</span>
                  </td>
                  <td className="py-2.5 pr-3 font-mono tabular-nums text-[var(--ink-muted)]">
                    {d.rows}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className="whitespace-nowrap rounded-full px-2 py-0.5 uppercase tracking-wider"
                      style={{
                        fontSize: "calc(var(--d-label) * 0.85)",
                        background: `color-mix(in oklab, ${KIND_LABEL[d.kind]!.colour} 16%, transparent)`,
                        color: KIND_LABEL[d.kind]!.colour,
                      }}
                    >
                      {KIND_LABEL[d.kind]![hi ? "hi" : "en"]}
                    </span>
                  </td>
                  <td className="py-2.5 leading-relaxed text-[var(--ink-muted)]">
                    {hi ? d.basis_hi : d.basis_en}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {pub && (
        <Panel title={hi ? "प्रकाशित आँकड़े" : "Published figures"} emphasis>
          <p
            className="leading-relaxed text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {pub.note}
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[26rem]" style={{ fontSize: "var(--d-support)" }}>
              <thead>
                <tr
                  className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
                  style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
                >
                  <th className="pb-2 font-medium">{hi ? "वर्ष" : "Year"}</th>
                  <th className="pb-2 text-right font-medium">{hi ? "दुर्घटनाएँ" : "Accidents"}</th>
                  <th className="pb-2 text-right font-medium">{hi ? "मौतें" : "Deaths"}</th>
                  <th className="pb-2 text-right font-medium">{hi ? "प्रति 100" : "Per 100"}</th>
                </tr>
              </thead>
              <tbody>
                {pub.crashes.by_year.map((y) => (
                  <tr key={y.year} className="border-t border-[var(--rule)]">
                    <td className="py-1.5 font-mono tabular-nums">{y.year}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatCount(y.accidents, locale)}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {y.deaths != null ? formatCount(y.deaths, locale) : (
                        <span
                          className="text-[var(--ink-faint)]"
                          title={hi ? "प्रकाशित नहीं" : "not published"}
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                      {y.deaths != null ? ((y.deaths / y.accidents) * 100).toFixed(1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p
            className="mt-3 leading-relaxed text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {hi
              ? `2025 में दुर्घटनाएँ ${pub.crashes.accidents_change_2025_pct}% घटीं और मौतें ${pub.crashes.fatalities_change_2025_pct}% बढ़ीं — प्रति 100 दुर्घटनाओं पर ${pub.crashes.fatality_rate_2025} मौतें, पाँच वर्षों में सर्वाधिक। इसीलिए ब्लैक स्पॉट गंभीरता से क्रमित हैं, आवृत्ति से नहीं।`
              : `In 2025 accidents fell ${pub.crashes.accidents_change_2025_pct}% while deaths rose ${pub.crashes.fatalities_change_2025_pct}% — ${pub.crashes.fatality_rate_2025} deaths per 100 crashes, the highest in five years. That is why black spots rank by severity, not frequency.`}
          </p>

          <div className="mt-4 grid gap-2">
            {[pub.crashes.source, pub.congestion.source].map((src) => (
              <a
                key={src.url}
                href={src.url}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg bg-[var(--surface-1)] px-3 py-2 transition-colors
                           hover:bg-[var(--surface-3)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                <span className="text-[var(--accent)]">{src.name}</span>
                <span className="mt-0.5 block text-[var(--ink-faint)]">{src.detail}</span>
              </a>
            ))}
          </div>
        </Panel>
      )}
    </Shell>
  );
}


/**
 * Registered fleet against measured traffic against road space.
 *
 * The strongest argument on the platform, and the only one that needs two
 * independent real sources to make: Rajasthan's own published vehicle
 * population on one side, this corridor's counts on the other.
 *
 * Registration alone says two-wheelers dominate. Counting alone says they are a
 * majority. Only the two together show that the road is carrying a different
 * city from the one the registration database describes — a car is 12.4% of the
 * fleet and roughly a quarter of arterial traffic, so it is about twice
 * over-represented on the road relative to how many exist, and over-represented
 * again in the space it occupies.
 */
function RepresentationPanel({ hi, locale }: { hi: boolean; locale: Locale }) {
  const { data } = useLazy<Representation>(() => api.representation(1), true);
  if (!data) return null;

  // Classes with no presence on an urban arterial (tractors, maxi cabs) are
  // dropped rather than shown as a row of zeroes. Their absence is correct and
  // uninteresting: a tractor is 6.9% of the state fleet and belongs on a rural
  // road, which is not a finding about Tonk Road.
  const shown = data.classes.filter((c) => c.on_road_pct > 0.2);

  return (
    <Panel
      title={hi ? "पंजीकृत बनाम सड़क पर" : "Registered vs on the road"}
      emphasis
      aside={
        <span
          className="shrink-0 rounded-full px-2 py-0.5 uppercase tracking-wider"
          style={{
            fontSize: "calc(var(--d-label) * 0.85)",
            background: "color-mix(in oklab, var(--congestion-free) 18%, transparent)",
            color: "var(--congestion-free)",
          }}
        >
          {hi ? "आंशिक रूप से वास्तविक" : "part real"}
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem]" style={{ fontSize: "var(--d-support)" }}>
          <thead>
            <tr
              className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
              style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
            >
              <th className="pb-2 pr-3 font-medium">{hi ? "वर्ग" : "Class"}</th>
              <th className="pb-2 pr-3 text-right font-medium">
                {hi ? "पंजीकृत" : "Registered"}
              </th>
              <th className="pb-2 pr-3 text-right font-medium">
                {hi ? "सड़क पर" : "On road"}
              </th>
              <th className="pb-2 pr-3 text-right font-medium">
                {hi ? "स्थान" : "Space"}
              </th>
              <th className="pb-2 text-right font-medium">
                {hi ? "अनुपात" : "Ratio"}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const over = c.over_representation ?? 1;
              return (
                <tr key={c.class_code} className="border-t border-[var(--rule)]">
                  <td className="py-2 pr-3">{hi ? c.name.hi : c.name.en}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                    {c.registered_pct}%
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">
                    {c.on_road_pct}%
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-[var(--accent)]">
                    {c.road_space_pct}%
                  </td>
                  <td
                    className="py-2 text-right font-mono tabular-nums"
                    style={{
                      color:
                        over >= 1.5
                          ? "var(--congestion-severe)"
                          : over < 1
                            ? "var(--congestion-free)"
                            : "var(--ink)",
                    }}
                  >
                    {over.toFixed(2)}×
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p
        className="mt-3 leading-relaxed text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        {hi
          ? `राजस्थान में ${formatCount(data.fleet_total, locale)} पंजीकृत वाहन। "अनुपात" बताता है कि कोई वर्ग इस सड़क पर अपनी पंजीकरण हिस्सेदारी के मुकाबले कितना अधिक दिखता है — 1 से ऊपर यानी अधिक-प्रतिनिधित्व।`
          : `${formatCount(data.fleet_total, locale)} registered vehicles in Rajasthan. The ratio is how much of this road a class takes compared with how many of them exist — above 1 is over-represented.`}
      </p>
      <p
        className="mt-2 leading-relaxed text-[var(--ink-faint)]"
        style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
      >
        {data.caveat}
      </p>
      <a
        href={data.sources.registered.url}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-2 inline-block text-[var(--accent)]"
        style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
      >
        {data.sources.registered.name}
      </a>
    </Panel>
  );
}


/**
 * Enforcement fairness.
 *
 * The panel deliberately opens by saying what it does NOT measure. A fairness
 * dashboard that quietly omits demographics reads as an oversight; one that
 * states it holds no caste, religion, gender or income data and will not
 * acquire any is making a commitment a reviewer can hold it to.
 *
 * What it does measure is the real equity question for Indian traffic
 * enforcement: whether the burden falls hardest on the road users least able
 * to carry it. Two-wheeler riders are the test case — and on this data they
 * carry noticeably more of it than their share of the road implies.
 */
function FairnessPanel({ hi, locale }: { hi: boolean; locale: Locale }) {
  const { data } = useLazy<Fairness>(() => api.fairness(), true);
  if (!data) return null;

  const worst = data.classes.reduce<number>(
    (a, c) => Math.max(a, c.disparate_impact ?? 0),
    0,
  );

  return (
    <Panel
      title={hi ? "प्रवर्तन निष्पक्षता" : "Enforcement fairness"}
      emphasis
      aside={
        <span
          className="shrink-0 rounded-full px-2 py-0.5 font-mono tabular-nums"
          style={{
            fontSize: "calc(var(--d-label) * 0.9)",
            background: `color-mix(in oklab, ${
              worst >= 1.2 ? "var(--congestion-severe)" : "var(--congestion-free)"
            } 18%, transparent)`,
            color: worst >= 1.2 ? "var(--congestion-severe)" : "var(--congestion-free)",
          }}
        >
          {worst.toFixed(2)}×
        </span>
      }
    >
      {/* What is not measured, first. */}
      <p
        className="rounded-lg bg-[var(--surface-1)] px-3 py-2.5 leading-relaxed text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        {hi
          ? "जनसांख्यिकीय निष्पक्षता यहाँ नहीं मापी जाती और न मापी जाएगी। इस मंच के पास जाति, धर्म, लिंग या आय का कोई डेटा नहीं है — और स्वयं की जाँच के लिए नंबर प्लेट से इनका अनुमान लगाना उस उल्लंघन से भी बड़ा होता जिसकी जाँच हो रही है।"
          : data.not_measured}
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[28rem]" style={{ fontSize: "var(--d-support)" }}>
          <thead>
            <tr
              className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
              style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
            >
              <th className="pb-2 pr-3 font-medium">{hi ? "वर्ग" : "Class"}</th>
              <th className="pb-2 pr-3 text-right font-medium">{hi ? "चालान" : "Challans"}</th>
              <th className="pb-2 pr-3 text-right font-medium">{hi ? "चालान %" : "Challan %"}</th>
              <th className="pb-2 pr-3 text-right font-medium">{hi ? "सड़क %" : "Road %"}</th>
              <th className="pb-2 text-right font-medium">{hi ? "असमानता" : "Impact"}</th>
            </tr>
          </thead>
          <tbody>
            {data.classes.map((c) => {
              const impact = c.disparate_impact ?? 1;
              return (
                <tr key={c.class_code} className="border-t border-[var(--rule)]">
                  <td className="py-2 pr-3">{c.class_code}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                    {formatCount(c.challans, locale)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">
                    {c.challan_share_pct}%
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                    {c.road_share_pct}%
                  </td>
                  <td
                    className="py-2 text-right font-mono tabular-nums"
                    style={{
                      color:
                        impact >= 1.2
                          ? "var(--congestion-severe)"
                          : impact <= 0.8
                            ? "var(--congestion-free)"
                            : "var(--ink)",
                    }}
                  >
                    {impact.toFixed(2)}×
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p
        className="mt-3 leading-relaxed text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        {hi
          ? "हेलमेट का उल्लंघन केवल दोपहिया पर संभव है, इसलिए हर तुलना का हर उसी वर्ग का यातायात है, कुल यातायात नहीं।"
          : data.denominator_note}
      </p>

      {/* Concentration: enforcement bunched at one gantry is a policing
          pattern, not a driving pattern. */}
      <div className="mt-4">
        <div
          className="flex items-baseline justify-between"
          style={{ fontSize: "var(--d-support)" }}
        >
          <span className="uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            {hi ? "कैमरा वितरण" : "Camera spread"}
          </span>
          <span className="font-mono tabular-nums text-[var(--ink-muted)]">
            {data.camera_concentration}× {hi ? "व्यस्ततम : शांत" : "busiest : quietest"}
          </span>
        </div>
        <ul className="mt-2 grid gap-1.5">
          {data.cameras.map((cam) => (
            <li key={cam.camera_id} className="flex items-center gap-2.5">
              <span
                className="min-w-0 flex-1 truncate text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {hi ? cam.junction.hi : cam.junction.en}
              </span>
              <span className="w-20 shrink-0">
                <Bar fraction={cam.share_pct / 100} colour="var(--accent)" />
              </span>
              <span
                className="w-10 shrink-0 text-right font-mono tabular-nums text-[var(--ink-faint)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {cam.share_pct}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
