"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { speedSourceMark, speedSourceTint, speedSourceTitle } from "@/lib/speed-source";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

import type {
  BlackSpots,
  Camera,
  CountsSummary,
  Corridor,
  Forecast,
  SignalAdvisory,
  DayProfile,
  ProbeCoverage,
  SourceReadiness,
  WeatherNow,
  WeeklyMatrix,
  IncidentTimeline,
} from "@/lib/api";
import type { SceneLink } from "@/components/city/city-view";
import type { BuildingBox } from "@/components/city/buildings";
import { City } from "@/components/city/city-scene.loader";
import { boundsOf, centroidOf, projectLine } from "@/lib/geo";
import { RAMP_NIGHT } from "@/components/city/ramp";
import { currentScene, serverScene, setTheme, subscribeScene } from "@/lib/theme";
import { useSplit } from "@/lib/resizable";
import { can, useSession, type Capability } from "@/lib/rbac";
import type { Locale } from "@/i18n/routing";
import { ModeDot } from "./primitives";
import { ThemeToggle } from "./theme-toggle";
import { SplitHandle } from "./split-handle";
import { CommandHint, CommandPalette, type Command } from "./command-palette";
import { AlertRail } from "./alert-rail";
import { SectionView } from "./sections";
import { CorridorMap } from "@/components/map/corridor-map.loader";
import { RoleBadge } from "./role-badge";
import {
  BlackSpotPanel,
  CompositionPanel,
  CountsPanel,
  ForecastPanel,
  IncidentPanel,
  HeatmapPanel,
  QualityPanel,
  ProbePanel,
  ReadinessPanel,
  SignalPanel,
  WeatherPanel,
  AirPanel,
} from "./panels";

/** Minutes since local midnight in Jaipur — where the brass marker sits. */
function jaipurNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return (
    Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value ?? 0)
  );
}

/**
 * Sections, each gated by the capability that makes it meaningful.
 *
 * A viewer sees three entries rather than nine greyed-out ones. Disabled items
 * an operator can never enable are noise that trains people to ignore the nav,
 * and on a shared control-room screen they also advertise exactly which
 * functions exist to someone who should not know.
 */
export const NAV = [
  { id: "dashboard", en: "Dashboard", hi: "डैशबोर्ड", cap: "read:traffic" },
  { id: "map", en: "Live map", hi: "लाइव मानचित्र", cap: "read:traffic" },
  { id: "areas", en: "Areas", hi: "क्षेत्र", cap: "read:traffic" },
  { id: "counts", en: "Counts", hi: "गणना", cap: "read:traffic" },
  { id: "junctions", en: "Junctions", hi: "चौराहे", cap: "read:traffic" },
  { id: "edge", en: "Edge · CV", hi: "एज · CV", cap: "read:traffic" },
  { id: "incidents", en: "Incidents", hi: "घटनाएँ", cap: "read:traffic" },
  { id: "signals", en: "Signals", hi: "सिग्नल", cap: "read:signals" },
  { id: "enforcement", en: "Enforcement", hi: "प्रवर्तन", cap: "read:enforcement" },
  { id: "neeti", en: "NEETI", hi: "नीति", cap: "use:neeti" },
  { id: "detection", en: "Detection", hi: "पहचान", cap: "read:traffic" },
  { id: "signals-pcu", en: "Signal timing", hi: "सिग्नल समय", cap: "read:traffic" },
  { id: "kpis", en: "KPIs", hi: "मापदंड", cap: "read:analytics" },
  { id: "reports", en: "Reports", hi: "रिपोर्ट", cap: "read:analytics" },
  { id: "provenance", en: "Provenance", hi: "स्रोत", cap: "read:traffic" },
] as const satisfies readonly { id: string; en: string; hi: string; cap: Capability }[];

const RAIL = { key: "pravaah-rail", initial: 340, min: 260, max: 640 };

/**
 * Operations console.
 *
 * The layout a traffic department already recognises — left nav, map centre,
 * KPI rail, alert ticker — so nobody has to learn it in the room. What differs
 * from every ICCC dashboard in the country is what the panels contain: not
 * "total vehicles", but what those vehicles ARE.
 */
export function ConsoleShell({
  corridors,
  summary,
  cameras,
  forecast,
  links,
  buildings,
  blackspots,
  signals,
  readiness,
  probeCoverage,
  weather,
  profile,
  weekly,
  incidents,
}: {
  corridors: Corridor[];
  summary: CountsSummary;
  cameras: Camera[];
  forecast: Forecast;
  links: SceneLink[];
  buildings: BuildingBox[];
  blackspots: BlackSpots;
  signals: SignalAdvisory;
  readiness: SourceReadiness;
  probeCoverage: ProbeCoverage | null;
  weather: WeatherNow;
  profile: DayProfile;
  weekly: WeeklyMatrix;
  incidents: IncidentTimeline;
}) {
  const locale = useLocale() as Locale;
  const hi = locale === "hi";
  const router = useRouter();
  // The 3D pane follows the interface theme. Hardcoding night here left a
  // glowing night city sitting inside a white UI whenever an officer
  // switched to daylight — the single worst thing in light mode.
  const sceneMode = useSyncExternalStore(subscribeScene, currentScene, serverScene);
  const session = useSession();
  const [active, setActive] = useState<string>("dashboard");
  const [threeD, setThreeD] = useState(true);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const corridor = corridors[0];

  // Destructured at the call site. The React compiler treats property access
  // on an object that carries a ref as a ref read during render, which it
  // rightly refuses; pulling the values out once makes each one plainly a
  // value or plainly the ref.
  const {
    hostRef: railRef,
    width: railWidth,
    dragging: railDragging,
    onPointerDown: railDown,
    onKeyDown: railKeys,
    reset: railReset,
  } = useSplit(RAIL);

  // A signed-out visitor still sees the console at viewer capability. Locking
  // the demo behind a login would make the one screen an official actually
  // wants to see the one screen a forwarded link cannot reach.
  const nav = useMemo(
    () =>
      session
        ? NAV.filter((item) => can(session.role, item.cap))
        : NAV.filter((item) => item.cap === "read:traffic"),
    [session],
  );

  const go = useCallback((id: string) => {
    setActive(id);
    document.getElementById("console-main")?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = nav.map((item) => ({
      id: `nav:${item.id}`,
      en: item.en,
      hi: item.hi,
      keywords: item.id,
      group: "navigate",
      run: () => go(item.id),
    }));
    list.push(
      {
        id: "view:theme",
        en: sceneMode === "night" ? "Switch to day" : "Switch to night",
        hi: sceneMode === "night" ? "दिन मोड" : "रात्रि मोड",
        keywords: "theme dark light रंग",
        group: "view",
        run: () => setTheme(sceneMode === "night" ? "day" : "night"),
      },
      {
        id: "view:dimension",
        en: threeD ? "Show 2D table" : "Show 3D city",
        hi: threeD ? "2D तालिका" : "3D शहर",
        keywords: "map 2d 3d मानचित्र",
        group: "view",
        run: () => setThreeD((v) => !v),
      },
      {
        id: "view:language",
        en: "Switch to Hindi",
        hi: "Switch to English",
        keywords: "language hindi english भाषा हिन्दी",
        group: "view",
        run: () => router.push(`/${hi ? "en" : "hi"}/console`),
      },
      {
        id: "view:alerts",
        en: "Open alerts",
        hi: "अलर्ट खोलें",
        keywords: "alerts notifications चेतावनी",
        group: "view",
        run: () => setAlertsOpen(true),
      },
      {
        id: "view:rail",
        en: "Reset panel width",
        hi: "पैनल चौड़ाई रीसेट",
        keywords: "resize layout width चौड़ाई",
        group: "action",
        run: railReset,
      },
      {
        id: "action:signin",
        en: session ? "Switch role" : "Sign in",
        hi: session ? "भूमिका बदलें" : "साइन इन",
        keywords: "role rbac login भूमिका",
        group: "action",
        run: () => router.push(`/${locale}/login`),
      },
    );
    return list;
  }, [nav, go, sceneMode, threeD, router, hi, locale, session, railReset]);

  // useMemo, not an IIFE. Rebuilt every render, `data` is a new object each
  // time, so the road geometry rebuilds every frame; that trips the
  // frame-budget guard, which calls setQuality, which re-renders — a loop that
  // never settles and leaves the pane blank.
  const scene = useMemo(() => {
    const centre = centroidOf(links.map((l) => l.coordinates));
    const projected = links.map((l) => ({ link: l, points: projectLine(l.coordinates, centre) }));
    const bounds = boundsOf(projected.flatMap((p) => p.points));
    return {
      origin: centre,
      radius: bounds.radius,
      data: {
        ramp: RAMP_NIGHT,
        roads: projected.map(({ link, points }) => ({
          points,
          congestionIndex: link.congestion_index,
          width: Math.max(0.7, link.lanes * 0.35),
          suppressed: link.suppressed,
        })),
        traffic: projected.map(({ link, points }) => ({
          points,
          flow: link.flow,
          speedKmh: link.speed_kmh,
          suppressed: link.suppressed,
          classMix: link.class_mix ?? {},
        })),
        buildings,
      },
    };
  }, [links, buildings]);

  const measured = links.filter((l) => l.flow > 0).length;
  const showMap = active === "dashboard" || active === "map";

  return (
    // `overflow-hidden` on the page grid is load-bearing. Without it the middle
    // row grows past `h-dvh` and its content paints straight through the alert
    // ticker — which is exactly what it did.
    <div
      ref={railRef}
      className="grid h-dvh grid-rows-[auto_1fr_auto] overflow-hidden bg-[var(--ground)] text-[var(--ink)]"
      style={{ "--split": `${railWidth}px` } as React.CSSProperties}
    >
      {/* ── top bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 border-b border-[var(--rule)] bg-[var(--surface)] px-3 py-2.5 sm:gap-4 sm:px-4">
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="font-display text-lg leading-none tracking-tight">PRAVAAH</span>
          <span className="text-sm text-[var(--ink-muted)]" lang="hi">
            प्रवाह
          </span>
        </div>
        <span
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[var(--rule-strong)]
                     px-2.5 py-1 uppercase tracking-widest text-[var(--ink-muted)] sm:flex"
          style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
        >
          <ModeDot live title={hi ? "प्रणाली चालू" : "System operational"} />
          {hi ? "चालू" : "Operational"}
        </span>
        <span
          className="ml-1 hidden min-w-0 truncate text-[var(--ink-muted)] lg:inline"
          style={{ fontSize: "var(--d-support)" }}
        >
          {corridor ? (hi ? corridor.name.hi : corridor.name.en) : "—"} · {measured}{" "}
          {hi ? `में से ${links.length} लिंक` : `of ${links.length} links`}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <CommandHint locale={locale} />
          <button
            type="button"
            onClick={() => setAlertsOpen(true)}
            aria-label={hi ? "अलर्ट" : "Alerts"}
            className="relative grid size-8 place-items-center rounded-lg text-[var(--ink-muted)]
                       transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <span aria-hidden="true">◉</span>
          </button>
          <a
            href={`/${hi ? "en" : "hi"}/console`}
            className="grid h-8 shrink-0 place-items-center rounded-lg px-2 text-[var(--ink-muted)]
                       transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {hi ? "EN" : "हि"}
          </a>
          <ThemeToggle />
          <RoleBadge locale={locale} />
          <span
            className="hidden font-mono tabular-nums text-[var(--ink-muted)] xl:inline"
            style={{ fontSize: "var(--d-support)" }}
          >
            {new Intl.DateTimeFormat(hi ? "hi-IN" : "en-IN", {
              timeZone: "Asia/Kolkata",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date())}{" "}
            IST
          </span>
        </div>
      </header>

      {/* ── nav | main | rail ───────────────────────────────────────────
          Three columns need roughly 900px before the map is worth looking at,
          so below 1024px the whole thing stacks and the page itself scrolls.
          Above it, each column scrolls inside a row that does not grow. */}
      <div className="flex min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <nav
          aria-label={hi ? "अनुभाग" : "Sections"}
          className="shrink-0 overflow-x-auto border-b border-[var(--rule)] bg-[var(--surface)]
                     lg:w-[var(--d-nav)] lg:overflow-y-auto lg:overflow-x-hidden
                     lg:border-b-0 lg:border-r lg:py-2"
        >
          <ul className="flex lg:block">
            {nav.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => go(item.id)}
                  aria-current={active === item.id ? "page" : undefined}
                  className="flex w-full items-center gap-2 whitespace-nowrap border-b-2
                             border-transparent px-3.5 py-2.5 text-left
                             text-[var(--ink-muted)] transition-colors
                             hover:bg-[var(--surface-2)] hover:text-[var(--ink)]
                             aria-[current=page]:border-b-[var(--accent)]
                             aria-[current=page]:bg-[var(--surface-2)]
                             aria-[current=page]:text-[var(--ink)]
                             lg:border-b-0 lg:border-l-2 lg:py-2
                             lg:aria-[current=page]:border-b-0
                             lg:aria-[current=page]:border-l-[var(--accent)]"
                  style={{ fontSize: "var(--d-support)" }}
                >
                  {hi ? item.hi : item.en}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main
          id="console-main"
          // The fixed 45vh belongs to the MAP, which has no natural height and
          // must be told one. A section view has real content: giving it 45vh
          // clips it, and the overflow then paints over the rail stacked below
          // — which is what it did on a phone.
          //
          // `flex-none` is load-bearing and was the bug. Below lg this column is
          // a FLEX COLUMN, so the main axis is vertical and `flex-1`'s
          // `flex-basis: 0%` outranks `height` for sizing. Paired with
          // `shrink-0`, the pane sat at exactly 0 whenever the panel rail below
          // it overflowed — an invisible map on every screen under 1024px,
          // which is most of the ones this was demoed on. `flex-none` drops
          // back to `0 0 auto` so the height is finally the thing that decides.
          className={`relative min-w-0 flex-1 lg:overflow-y-auto ${
            showMap ? "max-lg:h-[45vh] max-lg:flex-none" : ""
          }`}
        >
          {showMap ? (
            <>
              {threeD ? (
                <City
                  data={scene.data}
                  radius={scene.radius}
                  origin={scene.origin}
                  scene={sceneMode}
                  fallback={<CorridorMap
                  links={links}
                  locale={locale}
                  cameras={cameras}
                  blackspots={blackspots.segments}
                />}
                />
              ) : (
                <CorridorMap
                  links={links}
                  locale={locale}
                  cameras={cameras}
                  blackspots={blackspots.segments}
                />
              )}
              {/* docs/06 §3 specifies this toggle on the map. */}
              <div className="absolute left-3 top-3 flex gap-1 rounded-lg border border-[var(--rule-strong)] bg-[var(--surface)]/85 p-1 backdrop-blur">
                {(["2D", "3D"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setThreeD(mode === "3D")}
                    aria-pressed={threeD === (mode === "3D")}
                    className="rounded px-2.5 py-1 text-[11px] text-[var(--ink-muted)]
                               transition-colors aria-pressed:bg-[var(--accent)]
                               aria-pressed:text-[var(--accent-ink)]"
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <SectionView
              section={active}
              locale={locale}
              links={links}
              summary={summary}
              signals={signals}
              incidents={incidents}
              blackspots={blackspots}
              weekly={weekly}
              cameras={cameras}
            />
          )}
        </main>

        <SplitHandle
          value={railWidth}
          min={RAIL.min}
          max={RAIL.max}
          dragging={railDragging}
          label={hi ? "पैनल चौड़ाई" : "Panel width"}
          onPointerDown={railDown}
          onKeyDown={railKeys}
          onDoubleClick={railReset}
        />

        <aside
          aria-label={hi ? "संकेतक" : "Indicators"}
          className="min-h-0 shrink-0 space-y-2.5 bg-[var(--ground)] p-2.5
                     lg:w-[var(--split)] lg:overflow-y-auto"
        >
          <CountsPanel summary={summary} profile={profile} nowMinutes={jaipurNowMinutes()} />
          <CompositionPanel summary={summary} />
          <ForecastPanel forecast={forecast} />
          <QualityPanel summary={summary} cameras={cameras} />
          <IncidentPanel data={incidents} />
          <BlackSpotPanel data={blackspots} />
          <HeatmapPanel data={weekly} />
          <SignalPanel data={signals} />
          <WeatherPanel data={weather} />
          <AirPanel />
          <ReadinessPanel data={readiness} />
          {probeCoverage && <ProbePanel data={probeCoverage} />}
        </aside>
      </div>

      {/* ── alert ticker ────────────────────────────────────────────────── */}
      <footer className="flex items-center gap-4 overflow-x-auto border-t border-[var(--rule)] bg-[var(--surface)] px-4 py-2">
        <button
          type="button"
          onClick={() => setAlertsOpen(true)}
          className="shrink-0 uppercase tracking-widest text-[var(--ink-muted)]
                     transition-colors hover:text-[var(--ink)]"
          style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
        >
          {hi ? "अलर्ट" : "Alerts"}
        </button>
        <span
          className="min-w-0 shrink-0 text-[var(--ink-muted)]"
          style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
        >
          {hi
            ? "बीजित कॉरिडोर — घटना परत अभी जुड़ी नहीं"
            : "Seeded corridor — incident layer not yet wired"}
        </span>
        <span
          className="ml-auto shrink-0 text-[var(--accent)]"
          style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
        >
          {hi ? "अनुरूपित डेटा" : "Simulated data"}
        </span>
      </footer>

      <CommandPalette commands={commands} locale={locale} />
      <AlertRail
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        locale={locale}
        links={links}
        incidents={incidents}
        weather={weather}
        readiness={readiness}
      />
    </div>
  );
}

/** The 2D surface. Designed, not a stub — ADR-015. */
export function MapFallback({ links, locale }: { links: SceneLink[]; locale: Locale }) {
  const hi = locale === "hi";
  return (
    <div className="h-full overflow-auto p-4">
      <table className="w-full" style={{ fontSize: "var(--d-support)" }}>
        <thead className="sticky top-0 bg-[var(--ground)]">
          <tr
            className="text-left uppercase tracking-widest text-[var(--ink-muted)]"
            style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
          >
            <th className="pb-2 font-medium">{hi ? "लिंक" : "Link"}</th>
            <th className="pb-2 text-right font-medium">{hi ? "सूचकांक" : "Index"}</th>
            <th className="pb-2 text-right font-medium">{hi ? "प्रवाह" : "Flow"}</th>
            <th className="pb-2 text-right font-medium">{hi ? "गति" : "Speed"}</th>
          </tr>
        </thead>
        <tbody>
          {links.map((l) => (
            <tr
              key={l.link_id}
              className="border-t border-[var(--rule)] transition-colors hover:bg-[var(--surface-2)]"
            >
              <td className="py-1.5">
                <span
                  className="mr-2 inline-block size-1.5 rounded-full align-middle"
                  style={{
                    background: l.suppressed
                      ? "var(--quality-suppressed)"
                      : `var(--congestion-${
                          l.congestion_index <= 25
                            ? "free"
                            : l.congestion_index <= 50
                              ? "light"
                              : l.congestion_index <= 70
                                ? "moderate"
                                : l.congestion_index <= 85
                                  ? "severe"
                                  : "critical"
                        })`,
                  }}
                />
                {hi ? l.name.hi : l.name.en}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {l.congestion_index.toFixed(0)}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                {l.flow > 0 ? Math.round(l.flow).toLocaleString("en-IN") : "—"}
              </td>
              <td
                className="py-1.5 text-right font-mono tabular-nums text-[var(--ink-muted)]"
                title={speedSourceTitle(l.speed_source, hi)}
              >
                {l.speed_kmh.toFixed(0)}
                {speedSourceMark(l.speed_source) && (
                  <span style={{ color: speedSourceTint(l.speed_source) }}>
                    {speedSourceMark(l.speed_source)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
