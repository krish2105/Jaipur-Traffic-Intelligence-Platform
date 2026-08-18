"use client";

import type { ReactNode } from "react";

/**
 * Panel primitives — surface elevation (ADR-021).
 *
 * No borders, no drop shadows. In a dark interface depth comes from surface
 * COLOUR: a lighter surface reads as closer. Borders and shadows are a
 * light-mode idiom, and using them is why nine panels previously read as nine
 * identical flat rectangles.
 *
 * Every size is a density token, so phone, laptop, desktop, wall and projector
 * are a media query rather than nine components to edit.
 */

export function Panel({
  title,
  children,
  aside,
  emphasis = false,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  /** Raises the panel one further surface step. Used for the argument. */
  emphasis?: boolean;
}) {
  return (
    <section
      className={`rounded-[var(--d-radius)] ${
        emphasis ? "bg-[var(--surface-3)]" : "bg-[var(--surface-2)]"
      }`}
      style={{ padding: "var(--d-pad)", boxShadow: "var(--rim)" }}
    >
      <header className="flex items-center justify-between gap-2">
        <h2
          className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          {title}
        </h2>
        {aside}
      </header>
      <div style={{ marginTop: "calc(var(--d-gap) * 0.9)" }}>{children}</div>
    </section>
  );
}

/** docs/06 §8 — no naked number. A figure always has room for its provenance. */
export function Metric({
  label,
  value,
  unit,
  delta,
  quality,
  scale = 1,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: { value: string; direction: "up" | "down" | "flat" };
  quality?: string;
  scale?: number;
}) {
  return (
    <div className="min-w-0">
      <p
        className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-label)" }}
      >
        {label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        {/* clamp, not truncate. A figure cut to "6…" is worse than a small
            one — it is unreadable AND looks broken. The lower bound keeps it
            legible; the upper bound stops it overflowing a narrow column. */}
        <span
          className="font-mono tabular-nums text-[var(--ink)]"
          style={{
            fontSize: `clamp(0.95rem, calc(var(--d-figure) * ${scale}), 3.5rem)`,
            lineHeight: 1.05,
          }}
        >
          {value}
        </span>
        {unit && (
          <span className="text-[var(--ink-muted)]" style={{ fontSize: "var(--d-support)" }}>
            {unit}
          </span>
        )}
      </p>
      {(delta || quality) && (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-x-2"
          style={{ fontSize: "var(--d-support)" }}
        >
          {delta && (
            <span
              className="font-mono tabular-nums"
              style={{
                color:
                  delta.direction === "up"
                    ? "var(--congestion-severe)"
                    : delta.direction === "down"
                      ? "var(--congestion-free)"
                      : "var(--ink-muted)",
              }}
            >
              {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "–"}{" "}
              {delta.value}
            </span>
          )}
          {quality && <span className="text-[var(--ink-faint)]">{quality}</span>}
        </div>
      )}
    </div>
  );
}

/** docs/02 rule 6 — anything derived from a synthetic row says so. Always. */
export function SyntheticTag({ label }: { label: string }) {
  return (
    <span
      className="shrink-0 rounded-full bg-[var(--surface-3)] px-2 py-0.5 uppercase tracking-wider text-[var(--accent)]"
      style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
    >
      {label}
    </span>
  );
}

export function ModeDot({ live, title }: { live: boolean; title: string }) {
  return (
    <span
      title={title}
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{
        background: live ? "var(--congestion-free)" : "var(--congestion-moderate)",
        boxShadow: live ? "0 0 8px var(--congestion-free)" : "none",
      }}
    />
  );
}

export function Bar({ fraction, colour = "var(--ink-muted)" }: { fraction: number; colour?: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: colour }}
      />
    </div>
  );
}
