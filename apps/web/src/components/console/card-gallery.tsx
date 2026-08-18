"use client";

import { useState } from "react";

import type { CountsSummary, DayProfile } from "@/lib/api";
import { CARD_STYLES, CountsCard, type CardStyle } from "./card-styles";

type Density = "auto" | "compact" | "projector";

const DENSITIES: { id: Density; label: string; note: string }[] = [
  { id: "auto", label: "Auto", note: "follows the viewport" },
  { id: "compact", label: "Control room", note: "dense, close viewing" },
  { id: "projector", label: "Projector", note: "read from 6 m" },
];

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

export function CardStyleGallery({
  summary,
  profile,
}: {
  summary: CountsSummary;
  profile: DayProfile;
}) {
  const [density, setDensity] = useState<Density>("auto");
  const now = jaipurNowMinutes();

  return (
    <main
      className="min-h-dvh bg-[var(--ground)] text-[var(--ink)]"
      data-density={density === "auto" ? undefined : density}
    >
      <header className="mx-auto max-w-6xl px-5 pt-8">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          PRAVAAH · <span lang="hi">प्रवाह</span> · card language
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight">
          One panel, three treatments
        </h1>
        <p className="mt-2 max-w-prose text-[var(--ink-muted)]">
          Same live data, same chart, same numbers. Pick the one that reads best
          and it goes on all nine panels.
        </p>

        <div className="mt-5 flex flex-wrap gap-1.5">
          {DENSITIES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDensity(d.id)}
              aria-pressed={density === d.id}
              className="rounded-full border border-[var(--rule-strong)] px-3.5 py-1.5 text-[12px]
                         text-[var(--ink-muted)] transition-colors
                         aria-pressed:bg-[var(--accent)] aria-pressed:text-[var(--accent-ink)]
                         aria-pressed:border-transparent hover:text-[var(--ink)]"
            >
              {d.label}
              <span className="ml-1.5 text-[10px] opacity-70">{d.note}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-3">
        {CARD_STYLES.map((style) => (
          <section key={style.id}>
            <h2 className="text-[13px] font-medium">{style.label}</h2>
            <p className="mb-3 mt-1 text-[12px] leading-relaxed text-[var(--ink-muted)]">
              {style.blurb}
            </p>
            <CountsCard
              style={style.id as CardStyle}
              summary={summary}
              profile={profile}
              nowMinutes={now}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
