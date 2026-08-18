"use client";

import type { ReactNode } from "react";

/**
 * Panel primitives for the operations console.
 *
 * Shared deliberately: the console and the bento shell are two layouts over
 * these same components, so choosing between the shells costs a layout rather
 * than a rebuild.
 */

export function Panel({
  title,
  children,
  aside,
  dense = false,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  dense?: boolean;
}) {
  return (
    <section
      className="rounded-xl border border-[var(--rule)] bg-[var(--surface)]"
      style={{ boxShadow: "var(--rim), var(--shadow-panel)" }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--rule)] px-3.5 py-2.5">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          {title}
        </h2>
        {aside}
      </header>
      <div className={dense ? "p-3" : "p-3.5"}>{children}</div>
    </section>
  );
}

/**
 * docs/06 §8: every measurement displays its quality or confidence. No naked
 * number ever. This component makes that structural — a figure cannot be
 * rendered without somewhere to put its provenance.
 */
export function Metric({
  label,
  value,
  unit,
  delta,
  quality,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: { value: string; direction: "up" | "down" | "flat" };
  quality?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl leading-none tabular-nums text-[var(--ink)]">
          {value}
        </span>
        {unit && <span className="text-xs text-[var(--ink-muted)]">{unit}</span>}
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-[11px]">
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
            {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "–"} {delta.value}
          </span>
        )}
        {quality && <span className="text-[var(--ink-faint)]">{quality}</span>}
      </div>
    </div>
  );
}

/** docs/02 rule 6 — anything derived from a synthetic row says so. Always. */
export function SyntheticTag({ label }: { label: string }) {
  return (
    <span
      className="rounded border border-[var(--accent-dim)]/50 px-1.5 py-0.5
                 text-[9px] uppercase tracking-wider text-[var(--accent)]"
    >
      {label}
    </span>
  );
}

/** A source's live/replay state, used by the readiness panel and the top bar. */
export function ModeDot({ live, title }: { live: boolean; title: string }) {
  return (
    <span
      title={title}
      className="inline-block size-1.5 rounded-full"
      style={{
        background: live ? "var(--congestion-free)" : "var(--congestion-moderate)",
        boxShadow: live ? "0 0 6px var(--congestion-free)" : "none",
      }}
    />
  );
}

export function Bar({
  fraction,
  colour = "var(--ink-muted)",
}: {
  fraction: number;
  colour?: string;
}) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: colour }}
      />
    </div>
  );
}
