"use client";

import { useLocale } from "next-intl";

import type { Locale } from "@/i18n/routing";
import type { SeverityModel } from "@/lib/api";

/**
 * What the composition is worth in lives, and how far to trust the number.
 *
 * docs/06 §8 says no naked number. That is hardest to honour for a *modelled*
 * figure, because the confidence interval is the part a slide most wants to
 * drop. So the interval is not an annotation here — it is drawn, as a bar the
 * point estimate sits inside, and the panel refuses to render a scenario that
 * arrives without one.
 *
 * Two things are stated on the panel rather than buried in a methods note:
 *
 *   - This is **not a fitted regression.** Crash-level records are not public,
 *     so it is a structured model with published anchors, calibrated against
 *     the one real observable that exists. An official who reads it as a
 *     regression has been misled by us, not by themselves.
 *   - The **aggregate two-wheeler odds ratio is 0.929** — a two-wheeler crash is
 *     not more likely to be fatal than any other. The whole disproportion is in
 *     the unhelmeted subset. That is the finding that makes the enforcement
 *     argument specific rather than a prejudice about scooters.
 */

const ORDER = [
  "helmet_compliance_90pct",
  "jaipur_now",
  "freight_corridor",
  "night",
] as const;

const LABELS: Record<string, { en: string; hi: string }> = {
  jaipur_now: { en: "Jaipur as measured", hi: "जयपुर, जैसा मापा गया" },
  night: { en: "At night", hi: "रात में" },
  freight_corridor: { en: "Freight corridor", hi: "मालवाहक कॉरिडोर" },
  helmet_compliance_90pct: {
    en: "If helmet compliance reached 90%",
    hi: "यदि हेलमेट अनुपालन 90% हो जाए",
  },
};

export function SeverityModelPanel({
  model,
  crashesPerYear,
}: {
  model: SeverityModel | null;
  crashesPerYear: number;
}) {
  const locale = useLocale() as Locale;
  const hi = locale === "hi";
  if (!model?.scenarios || !model.anchor) return null;

  // No CI, no render. The interval is the honesty, not a decoration on it —
  // and the type guard is what stops a missing scenario reaching the chart maths.
  const rows = ORDER.map((key) => ({ key, s: model.scenarios[key] })).flatMap((r) =>
    r.s?.deaths_per_100_crashes != null && r.s.ci_low != null && r.s.ci_high != null
      ? [{ key: r.key, ...r.s }]
      : [],
  );
  if (rows.length === 0) return null;

  const lo = Math.min(...rows.map((r) => r.ci_low)) - 2;
  const hiBound = Math.max(...rows.map((r) => r.ci_high)) + 2;
  const span = hiBound - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;

  const base = model.scenarios.jaipur_now?.deaths_per_100_crashes ?? 0;
  const helmet = model.scenarios.helmet_compliance_90pct?.deaths_per_100_crashes ?? 0;
  const lives = Math.round((crashesPerYear * (base - helmet)) / 100);

  return (
    <section className="border-t border-[var(--rule)] py-14 sm:py-20">
      <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        <p
          className="uppercase tracking-[0.18em] text-[var(--accent)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          {hi ? "06 · गंभीरता मॉडल" : "06 · the severity model"}
        </p>
        <h2 className="mt-3 max-w-3xl font-display text-[clamp(1.5rem,3.4vw,2.5rem)] leading-[1.12] tracking-tight">
          {hi
            ? "दोपहिया होना घातक नहीं है। बिना हेलमेट होना है।"
            : "Being a two-wheeler is not what kills. Being unhelmeted is."}
        </h2>

        <p
          className="mt-5 max-w-2xl leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "clamp(1rem, 1.6vw, 1.15rem)" }}
        >
          {hi
            ? `समग्र रूप से दोपहिया दुर्घटना की घातकता दर ${model.two_wheeler_odds_ratio.aggregate} है — यानी किसी अन्य दुर्घटना से अधिक नहीं। पूरा अंतर बिना हेलमेट वाले हिस्से में है, और वही वह चीज़ है जिसे प्रवर्तन बदल सकता है।`
            : `The aggregate two-wheeler odds ratio is ${model.two_wheeler_odds_ratio.aggregate} — a two-wheeler crash is no more likely to be fatal than any other. The entire disproportion sits in the unhelmeted subset, which is the part enforcement can actually change.`}
        </p>

        <div
          className="mt-9 rounded-2xl border border-[var(--rule)] bg-[var(--surface)] p-5 sm:p-7"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-display text-[1.35rem] tracking-tight">
              {hi ? "प्रति 100 दुर्घटनाओं पर मृत्यु" : "Deaths per 100 crashes"}
            </h3>
            <p
              className="text-[var(--ink-faint)]"
              style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
            >
              {hi ? "पट्टी = 95% विश्वास अंतराल" : "bar = 95% confidence interval"}
            </p>
          </div>

          <ul className="mt-6 space-y-5">
            {rows.map((r) => {
              const isBase = r.key === "jaipur_now";
              const isGood = r.deaths_per_100_crashes < base;
              return (
                <li key={r.key}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p
                      className={isBase ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"}
                      style={{ fontSize: "var(--d-support)" }}
                    >
                      {hi ? LABELS[r.key]?.hi : LABELS[r.key]?.en}
                    </p>
                    <p
                      className="font-mono tabular-nums"
                      style={{
                        fontSize: "var(--d-support)",
                        color: isBase
                          ? "var(--ink)"
                          : isGood
                            ? "var(--accent)"
                            : "var(--congestion-severe)",
                      }}
                    >
                      {r.deaths_per_100_crashes.toFixed(1)}
                      <span className="ml-2 text-[var(--ink-faint)]">
                        [{r.ci_low.toFixed(1)}–{r.ci_high.toFixed(1)}]
                      </span>
                    </p>
                  </div>
                  {/* The interval drawn to scale, with the point estimate on it. */}
                  <div className="relative mt-2 h-2.5 w-full rounded-full bg-[var(--surface-2)]">
                    <div
                      className="absolute h-2.5 rounded-full"
                      style={{
                        left: `${pos(r.ci_low)}%`,
                        width: `${Math.max(1, pos(r.ci_high) - pos(r.ci_low))}%`,
                        background: isBase
                          ? "var(--ink-faint)"
                          : isGood
                            ? "var(--accent)"
                            : "var(--congestion-severe)",
                        opacity: 0.45,
                      }}
                      aria-hidden
                    />
                    <div
                      className="absolute top-[-2px] h-[14px] w-[2px] rounded"
                      style={{
                        left: `${pos(r.deaths_per_100_crashes)}%`,
                        background: isBase ? "var(--ink)" : "var(--ink)",
                      }}
                      aria-hidden
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <p
            className="mt-6 border-t border-[var(--rule)] pt-4 leading-relaxed text-[var(--ink)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {hi
              ? `3,664 वार्षिक दुर्घटनाओं पर, यह लगभग ${lives} जानें प्रति वर्ष है — परन्तु इसके लिए अनुपालन हासिल करना होगा, केवल प्रवर्तन का पुनर्वितरण पर्याप्त नहीं।`
              : `At ${crashesPerYear.toLocaleString("en-IN")} crashes a year that is about ${lives} lives — but it requires achieving compliance, which is more than reallocating enforcement.`}
          </p>
        </div>

        {/* What the model is, said on the model. */}
        <dl
          className="mt-6 grid gap-x-8 gap-y-2 sm:grid-cols-2"
          style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
        >
          <div className="flex gap-2">
            <dt className="text-[var(--ink-faint)]">{hi ? "अंशांकन अवशेष" : "calibration residual"}</dt>
            <dd className="font-mono tabular-nums text-[var(--ink-muted)]">
              {model.anchor.calibration_residual.toFixed(1)}
            </dd>
          </div>
          {model.hour_effect?.loo_mae_relative != null && (
            <div className="flex gap-2">
              <dt className="text-[var(--ink-faint)]">
                {hi ? "घंटा-प्रभाव, होल्ड-आउट त्रुटि" : "hour effect, held-out error"}
              </dt>
              <dd className="font-mono tabular-nums text-[var(--ink-muted)]">
                {(model.hour_effect.loo_mae_relative * 100).toFixed(1)}%
              </dd>
            </div>
          )}
        </dl>

        <p
          className="mt-4 max-w-3xl leading-relaxed text-[var(--ink-faint)]"
          style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
        >
          {hi
            ? "यह एक फिट किया गया प्रतिगमन नहीं है। दुर्घटना-स्तर के अभिलेख सार्वजनिक नहीं हैं, इसलिए यह प्रकाशित आधारों पर बना संरचित जोखिम मॉडल है, जिसे 2025 की वास्तविक दर पर अंशांकित किया गया है। "
            : "This is not a fitted regression. Crash-level records are not public, so it is a structured risk model with published anchors, calibrated to the observed 2025 rate. "}
          {hi ? model.upgrade_path : model.upgrade_path}
        </p>
      </div>
    </section>
  );
}
