"use client";

import { useMemo } from "react";

import type { ClassMixEntry } from "@/lib/api";

/**
 * Composition — donut plus proportional bar.
 *
 * This is the argument, so it gets the most designed treatment on the page.
 * docs/01 §4: probe data measures delay and is structurally incapable of
 * reporting composition, and every capacity calculation, signal plan, freight
 * window and permit decision depends on it. Rendering that as six grey progress
 * bars, as it was, understates the only fact no competing system can produce.
 *
 * Hand-built SVG rather than a chart library: a donut is two arcs and some
 * trigonometry, and this way the ring shares the exact class colours the
 * proportional bar uses without a theme adapter in between.
 */

const CLASS_COLOUR: Record<string, string> = {
  // Vehicle class is a CATEGORY. Congestion is a MEASUREMENT. They must never
  // be the same colour, and three of these used to be exactly that: AUTO was
  // #2DD4A7 (ramp free), ERIK was #8CD65B (ramp light) and TRK2 was #FF6B4A
  // (ramp severe) — pixel-identical, so a truck and a jammed link rendered the
  // same and meant different things. 2W was #FFC53D, the retired brass accent.
  //
  // Rebuilt against three constraints, verified numerically rather than by eye:
  //   1. >=18 CIELAB dE from every ramp colour, so no class can read as severity
  //      (worst here is 29.8, against the old palette's 0.0).
  //   2. >=3:1 against both grounds — WCAG 1.4.11, these are graphical objects.
  //   3. Separable from each other. The six classes that actually carry share in
  //      Jaipur hold dE >= 17; the long tail is closer, which is the honest
  //      trade, because twelve categories cannot all be far apart AND clear of a
  //      ramp that already spans red through green.
  //
  // Saturated warm belongs to the ramp. Warm entries here are muted earth tones
  // (ochre, clay) that cannot be mistaken for an alert.
  "2W": "#5B8FF9",
  CAR: "#3B7C6E",
  AUTO: "#9270CA",
  LCV: "#B08B3E",
  ERIK: "#3E8F88",
  BUS: "#8E5A9B",
  TRK2: "#96601F",
  NMV: "#7F8FA6",
  TAXI: "#2E86C1",
  MBUS: "#B45FB0",
  TRKM: "#8A63AE",
  TRAC: "#8A7A3B",
};

export const classColour = (code: string) => CLASS_COLOUR[code] ?? "#8E9BBF";

function arc(cx: number, cy: number, r: number, from: number, to: number, width: number) {
  // Tuple-typed: with noUncheckedIndexedAccess, destructuring a plain number[]
  // yields possibly-undefined, which is correct of the compiler and noise here.
  const p = (angle: number, radius: number): [number, number] => {
    const a = ((angle - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  };
  const inner = r - width;
  const [x1, y1] = p(from, r);
  const [x2, y2] = p(to, r);
  const [x3, y3] = p(to, inner);
  const [x4, y4] = p(from, inner);
  const large = to - from > 180 ? 1 : 0;
  return [
    `M${x1.toFixed(2)},${y1.toFixed(2)}`,
    `A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`,
    `L${x3.toFixed(2)},${y3.toFixed(2)}`,
    `A${inner},${inner} 0 ${large} 0 ${x4.toFixed(2)},${y4.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function CompositionChart({ mix }: { mix: ClassMixEntry[] }) {
  // A fold rather than a mutable cursor: React's compiler rejects reassigning a
  // variable that outlives the render, and the running offset is exactly that.
  // The 1-degree inset on each side leaves a visible gap so adjacent classes
  // never merge into one arc.
  const segments = useMemo(
    () =>
      mix.reduce<{ entry: ClassMixEntry; from: number; to: number }[]>((acc, entry) => {
        const start = acc.length === 0 ? 0 : (acc[acc.length - 1]?.to ?? 0) + 1;
        return [...acc, { entry, from: start + 1, to: start + entry.share * 360 - 1 }];
      }, []),
    [mix],
  );

  const lead = mix[0];

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0" role="img" aria-label="Vehicle composition">
        {segments.map(({ entry, from, to }) =>
          to > from ? (
            <path
              key={entry.class_code}
              d={arc(60, 60, 54, from, to, 15)}
              fill={classColour(entry.class_code)}
              opacity={0.92}
            />
          ) : null,
        )}
        {lead && (
          <>
            <text
              x="60" y="58" textAnchor="middle"
              className="fill-[var(--ink)]"
              style={{ fontSize: 26, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
            >
              {Math.round(lead.share * 100)}
            </text>
            <text
              x="60" y="74" textAnchor="middle"
              className="fill-[var(--ink-muted)]"
              style={{ fontSize: 9, letterSpacing: "0.12em" }}
            >
              % TWO-WHEELER
            </text>
          </>
        )}
      </svg>

      <div className="min-w-0 flex-1">
        {/* The same split again as one proportional bar — the donut reads the
            headline share, the bar reads the whole distribution at once. */}
        <div className="flex h-2.5 w-full overflow-hidden rounded-full">
          {mix.map((entry) => (
            <div
              key={entry.class_code}
              style={{ width: `${entry.share * 100}%`, background: classColour(entry.class_code) }}
              title={`${entry.class_code} ${(entry.share * 100).toFixed(1)}%`}
            />
          ))}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {mix.slice(0, 6).map((entry) => (
            <li key={entry.class_code} className="flex items-center gap-1.5 min-w-0">
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: classColour(entry.class_code) }}
              />
              <span
                className="min-w-0 flex-1 truncate text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {entry.class_code}
              </span>
              <span
                className="shrink-0 font-mono tabular-nums text-[var(--ink)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {(entry.share * 100).toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
