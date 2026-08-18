"use client";

import { useLocale } from "next-intl";

import type { EnforcementAllocation, SeverityFinding } from "@/lib/api";
import type { Locale } from "@/i18n/routing";

/**
 * The argument, on one screen.
 *
 * Everything else on this page is measured from a seeded warehouse and badged
 * "Simulated". This section is not: every figure is published by MoRTH, the
 * Rajasthan Transport Department or the Jaipur Commissionerate, and each one
 * renders its source next to it. That difference is the point of the section,
 * so it is stated on the section rather than left for a reader to work out.
 *
 * The shape of the argument:
 *
 *   1. Crashes fell. Deaths rose. Severity is the problem, not frequency.
 *   2. 87.9% of enforcement acts on frequency. 6.7% acts on severity.
 *   3. Here is the reallocation, what it is worth, and where it stops holding.
 *
 * Step 3 carries its own limits deliberately. A recommendation shown to a
 * department without the range it depends on is a sales claim; shown with it, it
 * is an analysis they can argue with, and the argument is one we want to have.
 */

const BAR = "h-2.5 rounded-full";

function Row({
  label,
  now,
  next,
}: {
  label: string;
  now: number;
  next: number;
}) {
  const shift = next - now;
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1.5">
      <p className="text-[var(--ink)]" style={{ fontSize: "var(--d-support)" }}>
        {label}
      </p>
      <p
        className="font-mono tabular-nums"
        style={{
          fontSize: "var(--d-support)",
          color: shift > 0 ? "var(--accent)" : "var(--ink-muted)",
        }}
      >
        {now.toFixed(1)}% → {next.toFixed(1)}%
        <span className="ml-2 text-[var(--ink-faint)]">
          {shift > 0 ? "+" : ""}
          {shift.toFixed(1)}
        </span>
      </p>
      <div className="col-span-2 flex gap-1.5">
        {/* Two bars, not an animated transition between one: the reader is
            comparing two states, and a morph hides the comparison. */}
        <div className="relative w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className={BAR}
            style={{ width: `${now}%`, background: "var(--ink-faint)" }}
            aria-hidden
          />
        </div>
        <div className="relative w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className={BAR}
            style={{ width: `${next}%`, background: "var(--accent)" }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}

export function SeveritySection({
  severity,
  allocation,
}: {
  severity: SeverityFinding;
  allocation: EnforcementAllocation;
}) {
  const locale = useLocale() as Locale;
  const hi = locale === "hi";
  if (!severity.crashes || !allocation.recommended_pct) return null;

  const names: Record<string, { en: string; hi: string }> = {
    over_speeding: { en: "Over-speeding", hi: "अति-गति" },
    no_helmet: { en: "No helmet", hi: "बिना हेलमेट" },
    parking_obstruction: { en: "Parking / obstruction", hi: "पार्किंग / अवरोध" },
  };

  return (
    <section className="border-t border-[var(--rule)] py-14 sm:py-20">
      <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        <p
          className="uppercase tracking-[0.18em] text-[var(--accent)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          {hi ? "04 · गंभीरता का अंतर" : "04 · the severity gap"}
          <span className="ml-3 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--ink-muted)]">
            {hi ? "वास्तविक प्रकाशित आँकड़े" : "real published data"}
          </span>
        </p>

        <h2 className="mt-3 max-w-3xl font-display text-[clamp(1.5rem,3.4vw,2.5rem)] leading-[1.12] tracking-tight">
          {hi
            ? "दुर्घटनाएँ घटीं। मौतें बढ़ीं। जयपुर टकराने में सुरक्षित हो रहा है, बचने में नहीं।"
            : "Crashes fell. Deaths rose. Jaipur is getting safer at colliding and worse at surviving."}
        </h2>

        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            {
              v: `${severity.crashes.change_pct > 0 ? "+" : ""}${severity.crashes.change_pct}%`,
              l: hi ? "दुर्घटनाएँ, 2025" : "crashes, 2025",
              n: `${severity.crashes.count.toLocaleString(hi ? "hi-IN" : "en-IN")} ${hi ? "से" : "from"} ${severity.crashes.prev.toLocaleString(hi ? "hi-IN" : "en-IN")}`,
              good: true,
            },
            {
              v: `+${severity.deaths.change_pct}%`,
              l: hi ? "मृत्यु, 2025" : "deaths, 2025",
              n: `${severity.deaths.count.toLocaleString(hi ? "hi-IN" : "en-IN")} ${hi ? "जानें" : "lives"}`,
              good: false,
            },
            {
              v: String(severity.fatality_rate_per_100),
              l: hi ? "प्रति 100 दुर्घटनाओं पर मृत्यु" : "deaths per 100 crashes",
              n: hi ? "पाँच वर्ष का उच्चतम" : "five-year high",
              good: false,
            },
          ].map((s) => (
            <div key={s.l} className="min-w-0">
              <p
                className="font-mono text-[clamp(1.75rem,4.5vw,2.75rem)] leading-none tabular-nums"
                style={{ color: s.good ? "var(--ink)" : "var(--congestion-critical)" }}
              >
                {s.v}
              </p>
              <p className="mt-2 text-[var(--ink-muted)]" style={{ fontSize: "var(--d-support)" }}>
                {s.l}
              </p>
              <p className="mt-1 text-[var(--ink-faint)]" style={{ fontSize: "var(--d-support)" }}>
                {s.n}
              </p>
            </div>
          ))}
        </div>

        <p
          className="mt-10 max-w-2xl leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "clamp(1rem, 1.6vw, 1.15rem)" }}
        >
          {hi ? severity.argument.hi : severity.argument.en}
        </p>

        {/* ── the reallocation ──────────────────────────────────────────── */}
        <div
          className="mt-10 rounded-2xl border border-[var(--rule)] bg-[var(--surface)] p-5 sm:p-7"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-display text-[1.35rem] tracking-tight">
              {hi ? "अगले हज़ार चालान कहाँ जाएँ" : "Where the next thousand challans should go"}
            </h3>
            <p
              className="font-mono tabular-nums text-[var(--accent)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              +{allocation.lives_per_year.gain} {hi ? "जानें/वर्ष" : "lives/year"}
            </p>
          </div>

          <div className="mt-6 space-y-5">
            {Object.keys(allocation.recommended_pct).map((k) => (
              <Row
                key={k}
                label={hi ? (names[k]?.hi ?? k) : (names[k]?.en ?? k)}
                now={allocation.current_pct[k] ?? 0}
                next={allocation.recommended_pct[k] ?? 0}
              />
            ))}
          </div>

          <p
            className="mt-6 border-t border-[var(--rule)] pt-4 leading-relaxed text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {hi
              ? "यह मौजूदा प्रयास का पुनर्वितरण है, अतिरिक्त संसाधन की माँग नहीं।"
              : "This is a reallocation of existing effort, not a request for more resources."}
          </p>

          {/* The limits of the claim, shown with the claim. A recommendation
              without its range is a sales pitch. */}
          {allocation.robustness?.holds_above_k != null && (
            <p
              className="mt-2 leading-relaxed text-[var(--ink-faint)]"
              style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
            >
              {hi
                ? `यह संस्तुति संतृप्ति स्थिरांक K ≥ ${allocation.robustness.holds_above_k} पर ही टिकती है। इससे नीचे प्रतिफल वक्र इतना समतल नहीं होता कि पुनर्वितरण लाभदायक हो।`
                : `This recommendation holds for saturation K ≥ ${allocation.robustness.holds_above_k}. Below that the returns curve is too gentle for the reallocation to pay, and the model prefers the current shape.`}
            </p>
          )}
        </div>

        {/* Sources travel with the figures, not in a footnote nobody opens. */}
        <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-1.5">
          {Object.entries(severity.sources ?? {}).map(([key, src]) => (
            <li key={key}>
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--ink-faint)] underline decoration-[var(--rule-strong)]
                           underline-offset-2 transition-colors hover:text-[var(--accent)]"
                style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
              >
                {src.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
