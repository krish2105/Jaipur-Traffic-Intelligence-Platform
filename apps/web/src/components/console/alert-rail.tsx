"use client";

import { useEffect, useMemo } from "react";

import type { IncidentTimeline, SourceReadiness, WeatherNow } from "@/lib/api";
import type { SceneLink } from "@/components/city/city-view";
import type { Locale } from "@/i18n/routing";

/**
 * The alert drawer.
 *
 * Every alert here is **derived from data on screen**, never authored. A
 * control room that shows invented alerts trains its operators to dismiss all
 * of them, and the first real one dies with the habit. So each entry names the
 * measurement it came from and the threshold it crossed, and if nothing has
 * crossed a threshold the drawer says exactly that rather than padding itself.
 *
 * Severity is the published congestion ramp (docs/06 §1), reused rather than
 * reinvented, so an amber row here means the same thing an amber link means on
 * the map.
 */

type Severity = "critical" | "severe" | "moderate" | "info";

interface Alert {
  id: string;
  severity: Severity;
  en: string;
  hi: string;
  detail: { en: string; hi: string };
}

const SEVERITY_COLOUR: Record<Severity, string> = {
  critical: "var(--congestion-critical)",
  severe: "var(--congestion-severe)",
  moderate: "var(--congestion-moderate)",
  info: "var(--ink-faint)",
};

export function AlertRail({
  open,
  onClose,
  locale,
  links,
  incidents,
  weather,
  readiness,
}: {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  links: SceneLink[];
  incidents: IncidentTimeline;
  weather: WeatherNow;
  readiness: SourceReadiness;
}) {
  const hi = locale === "hi";

  const alerts = useMemo<Alert[]>(() => {
    const list: Alert[] = [];

    // Links above the "severe" band. Ranked worst-first, capped at five: an
    // alert list longer than a screen is a report, and nobody reads a report
    // during an incident.
    const congested = links
      .filter((l) => !l.suppressed && l.congestion_index > 85)
      .sort((a, b) => b.congestion_index - a.congestion_index)
      .slice(0, 5);
    for (const link of congested) {
      list.push({
        id: `link:${link.link_id}`,
        severity: link.congestion_index > 92 ? "critical" : "severe",
        en: `${link.name.en} — congestion ${link.congestion_index.toFixed(0)}`,
        hi: `${link.name.hi} — भीड़ ${link.congestion_index.toFixed(0)}`,
        detail: {
          en: `${link.speed_kmh.toFixed(0)} km/h against a free-flow reference. Above 85 is the severe band.`,
          hi: `मुक्त-प्रवाह संदर्भ के मुकाबले ${link.speed_kmh.toFixed(0)} किमी/घंटा। 85 से ऊपर गंभीर श्रेणी है।`,
        },
      });
    }

    // Suppressed links are a data-quality alert, not a traffic one. Saying so
    // is the difference between "the road is clear" and "we cannot see it".
    const suppressed = links.filter((l) => l.suppressed).length;
    if (suppressed > 0) {
      list.push({
        id: "quality:suppressed",
        severity: "moderate",
        en: `${suppressed} links suppressed for low confidence`,
        hi: `${suppressed} लिंक कम विश्वास के कारण दबाए गए`,
        detail: {
          en: "These are not clear roads — they are roads we decline to report on. docs/02 rule 4.",
          hi: "ये खाली सड़कें नहीं हैं — इन पर रिपोर्ट देने से इनकार किया गया है।",
        },
      });
    }

    if (weather.available && weather.degrades_counting) {
      list.push({
        id: "weather:degraded",
        severity: "moderate",
        en: "Weather is degrading camera counting",
        hi: "मौसम कैमरा गणना को प्रभावित कर रहा है",
        detail: {
          en: `${weather.summary}. Affected bins are suppressed rather than published at reduced accuracy.`,
          hi: `${weather.summary}. प्रभावित बिन कम सटीकता पर प्रकाशित करने के बजाय दबाए जाते हैं।`,
        },
      });
    }

    if (incidents.detector.detected_24h > 0) {
      list.push({
        id: "detector:queue",
        severity: incidents.detector.active > 0 ? "severe" : "info",
        en: `${incidents.detector.detected_24h} congestion anomalies detected in 24h`,
        hi: `24 घंटे में ${incidents.detector.detected_24h} भीड़ विसंगतियाँ पाई गईं`,
        detail: {
          en: `${incidents.detector.active} still open. Method: ${incidents.detector.method}.`,
          hi: `${incidents.detector.active} अब भी खुली हैं।`,
        },
      });
    }

    const pending = readiness.sources.filter((s) => s.mode !== "live").length;
    if (pending > 0) {
      list.push({
        id: "sources:pending",
        severity: "info",
        en: `${pending} of ${readiness.total} sources are on replay`,
        hi: `${readiness.total} में से ${pending} स्रोत रीप्ले पर हैं`,
        detail: {
          en: "Each is behind an adapter. Switching to live is configuration, not a rewrite.",
          hi: "प्रत्येक एक अडैप्टर के पीछे है। लाइव पर जाना विन्यास है, पुनर्लेखन नहीं।",
        },
      });
    }

    return list;
  }, [links, incidents, weather, readiness]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={hi ? "अलर्ट" : "Alerts"}>
      <button
        type="button"
        aria-label={hi ? "बंद करें" : "Close"}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--scrim)] backdrop-blur-sm
                   motion-safe:animate-[fade_140ms_ease-out]"
      />
      <aside
        className="absolute inset-y-0 right-0 flex w-full max-w-[26rem] flex-col
                   bg-[var(--surface)] motion-safe:animate-[rise_180ms_cubic-bezier(0.16,1,0.3,1)]"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--rule)] px-5 py-4">
          <div className="min-w-0">
            <h2
              className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-label)" }}
            >
              {hi ? "अलर्ट" : "Alerts"}
            </h2>
            <p className="mt-0.5 font-mono tabular-nums" style={{ fontSize: "var(--d-body)" }}>
              {alerts.length}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ink-muted)]
                       transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            aria-label={hi ? "बंद करें" : "Close"}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {alerts.length === 0 && (
            <p
              className="px-2 py-8 text-center text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {hi
                ? "कोई सीमा पार नहीं हुई। यह एक मापी गई शांति है, खाली सूची नहीं।"
                : "Nothing has crossed a threshold. That is a measured calm, not an empty list."}
            </p>
          )}
          {alerts.map((alert) => (
            <article
              key={alert.id}
              className="rounded-xl bg-[var(--surface-2)] p-3.5"
              style={{ boxShadow: "var(--rim)" }}
            >
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1.5 shrink-0 rounded-full"
                  style={{ background: SEVERITY_COLOUR[alert.severity] }}
                />
                <div className="min-w-0">
                  <p className="text-[var(--ink)]" style={{ fontSize: "var(--d-support)" }}>
                    {hi ? alert.hi : alert.en}
                  </p>
                  <p
                    className="mt-1 leading-relaxed text-[var(--ink-muted)]"
                    style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
                  >
                    {hi ? alert.detail.hi : alert.detail.en}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <footer
          className="border-t border-[var(--rule)] px-5 py-3 text-[var(--ink-faint)]"
          style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
        >
          {hi
            ? "हर अलर्ट स्क्रीन पर मौजूद माप से निकाला गया है। कोई भी लिखा हुआ नहीं है।"
            : "Every alert is derived from a measurement on screen. None is authored."}
        </footer>
      </aside>
    </div>
  );
}
