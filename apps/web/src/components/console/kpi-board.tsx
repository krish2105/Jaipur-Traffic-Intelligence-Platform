"use client";

import { useState } from "react";

import type { KpiBoard, KpiEntry } from "@/lib/api";

/**
 * The numbers this platform asks to be judged on.
 *
 * Three tiers, kept apart because they answer to different people and fail in
 * different ways. Outcome is what the government is buying and every baseline
 * is a real published figure with a source. System is what we guarantee about
 * the software. Adoption is whether anyone uses it, which is the tier most
 * products skip and the one that decides renewal.
 *
 * Two display rules that matter more than the layout:
 *
 *   - **A target that is a judgement says so.** Some targets are derived (the
 *     death count follows from the fatality-rate target); others are a choice
 *     about what a department can realistically commit to in a year. Presenting
 *     the second kind as if it were the first is how a KPI board becomes
 *     fiction.
 *   - **System values are targets, not readings.** The live numbers belong to
 *     the running system. A dashboard that reports its own SLA compliance from
 *     a constant always passes, so this shows the bar and not a score.
 */

const TIERS = [
  { id: "outcome", en: "Outcome", hi: "परिणाम" },
  { id: "system", en: "System", hi: "प्रणाली" },
  { id: "adoption", en: "Adoption", hi: "अपनाव" },
] as const;

function Row({ kpi, hi, showLive }: { kpi: KpiEntry; hi: boolean; showLive: boolean }) {
  const improving = kpi.direction === "down" ? kpi.target < kpi.baseline : kpi.target > kpi.baseline;
  return (
    <li className="border-t border-[var(--rule)] py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1 text-[var(--ink)]" style={{ fontSize: "var(--d-support)" }}>
          {hi ? kpi.label.hi : kpi.label.en}
          {kpi.target_is_judgement && (
            <span
              className="ml-2 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--ink-faint)]"
              style={{ fontSize: "calc(var(--d-support) * 0.8)" }}
            >
              {hi ? "निर्णय" : "judgement"}
            </span>
          )}
        </p>
        <p className="shrink-0 font-mono tabular-nums" style={{ fontSize: "var(--d-support)" }}>
          {showLive && (
            <>
              <span className="text-[var(--ink-muted)]">{kpi.baseline.toLocaleString("en-IN")}</span>
              <span className="mx-1.5 text-[var(--ink-faint)]">&rarr;</span>
            </>
          )}
          <span style={{ color: improving ? "var(--accent)" : "var(--ink)" }}>
            {kpi.target.toLocaleString("en-IN")}
          </span>
          <span className="ml-1 text-[var(--ink-faint)]">{kpi.unit}</span>
        </p>
      </div>
      <p
        className="mt-1 leading-relaxed text-[var(--ink-faint)]"
        style={{ fontSize: "calc(var(--d-support) * 0.85)" }}
      >
        {kpi.basis}
      </p>
    </li>
  );
}

export function KpiBoardPanel({ data, hi }: { data: KpiBoard | null; hi: boolean }) {
  const [tier, setTier] = useState<(typeof TIERS)[number]["id"]>("outcome");
  if (!data?.outcome?.length) return null;

  const rows = data[tier];
  // Only the outcome tier has a real baseline to move from. System and adoption
  // show the bar alone, because a live reading pulled from a constant is a
  // dashboard marking its own homework.
  const showLive = tier === "outcome";

  return (
    <section
      className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-4 sm:p-5"
      aria-labelledby="kpi-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id="kpi-heading"
          className="font-display tracking-tight text-[var(--ink)]"
          style={{ fontSize: "calc(var(--d-support) * 1.25)" }}
        >
          {hi ? "मापदंड" : "Key performance indicators"}
        </h3>
        <div className="flex gap-1" role="group" aria-label={hi ? "स्तर" : "Tier"}>
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTier(t.id)}
              aria-pressed={tier === t.id}
              className={`rounded-md px-2.5 py-1 transition-colors
                          focus-visible:outline focus-visible:outline-2
                          focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]
                          ${
                            tier === t.id
                              ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                              : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)]"
                          }`}
              style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
            >
              {hi ? t.hi : t.en}
            </button>
          ))}
        </div>
      </div>

      <p
        className="mt-1 text-[var(--ink-muted)]"
        style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
      >
        {tier === "outcome"
          ? hi
            ? "जो सरकार खरीद रही है। हर आधार-रेखा प्रकाशित सरकारी आँकड़ा है।"
            : "What the government is buying. Every baseline is a published government figure."
          : tier === "system"
            ? hi
              ? "जो हम सॉफ़्टवेयर के बारे में गारंटी देते हैं। ये लक्ष्य हैं, रीडिंग नहीं।"
              : "What we guarantee about the software. These are targets, not readings."
            : hi
              ? "क्या कोई वास्तव में इसका उपयोग करता है। यही तय करता है कि अनुबंध चलेगा या नहीं।"
              : "Whether anyone actually uses it. This is the tier that decides renewal."}
      </p>

      <ul className="mt-3">
        {rows.map((k) => (
          <Row key={k.key} kpi={k} hi={hi} showLive={showLive} />
        ))}
      </ul>

      <p
        className="mt-4 border-t border-[var(--rule)] pt-3 leading-relaxed text-[var(--ink-faint)]"
        style={{ fontSize: "calc(var(--d-support) * 0.85)" }}
      >
        {data.note}
      </p>
    </section>
  );
}
