"use client";

import { useState, type ReactNode } from "react";

/**
 * Panel primitives — surface elevation (ADR-021), sized by container query.
 *
 * No borders, no drop shadows. In a dark interface depth comes from surface
 * COLOUR: a lighter surface reads as closer.
 *
 * Every panel is a **container**, and every figure inside it is sized in `cqi`
 * — a percentage of the panel's own inline size. This is the fix for a fault
 * that came back three times: a figure sized off the viewport overflows its
 * column whenever the column is narrower than the viewport implies, and it
 * then either truncates to "6…" or collides with its neighbour into
 * "0.012.0". Both look like a broken product to someone being pitched to.
 *
 * With `cqi` the relationship is structural rather than tuned. A figure at
 * 15cqi occupies 15% of whatever width it has been given, so it cannot
 * overflow — at any viewport, at any density, and at any width the user drags
 * the panel to. The clamp still bounds it: never illegibly small, never
 * cartoonish on a projector.
 */

export function Panel({
  title,
  children,
  aside,
  emphasis = false,
  collapsible = false,
  id,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  /** Raises the panel one further surface step. Used for the argument. */
  emphasis?: boolean;
  collapsible?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section
      id={id}
      // `@container` is what makes every cqi unit below resolve against this
      // panel rather than the page.
      className={`@container rounded-[var(--d-radius)] transition-colors ${
        emphasis ? "bg-[var(--surface-3)]" : "bg-[var(--surface-2)]"
      }`}
      style={{ padding: "var(--d-pad)", boxShadow: "var(--rim)" }}
    >
      <header className="flex items-center justify-between gap-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex min-w-0 items-center gap-1.5 text-left uppercase tracking-[0.14em]
                       text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
            style={{ fontSize: "var(--d-label)" }}
          >
            <span
              aria-hidden="true"
              className="inline-block transition-transform duration-200"
              style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ›
            </span>
            <span className="truncate">{title}</span>
          </button>
        ) : (
          <h2
            className="min-w-0 truncate uppercase tracking-[0.14em] text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-label)" }}
          >
            {title}
          </h2>
        )}
        {aside}
      </header>
      {open && <div style={{ marginTop: "calc(var(--d-gap) * 0.9)" }}>{children}</div>}
    </section>
  );
}

/**
 * A row of figures that reflows on the PANEL's width, not the window's.
 *
 * Three metrics in a 300px rail is the collision that produced "0.012.0"; the
 * same three in a 500px rail are perfectly comfortable. Only a container query
 * can tell those apart, because the viewport is identical in both cases.
 */
export function MetricRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-3 @[15rem]:grid-cols-2 @[26rem]:grid-cols-3">
      {children}
    </div>
  );
}

/** Two across at any usable width, one when the panel is genuinely narrow. */
export function MetricPair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-3 gap-y-3 @[13rem]:grid-cols-2">{children}</div>;
}

/** docs/06 §8 — no naked number. A figure always has room for its provenance. */
export function Metric({
  label,
  value,
  unit,
  delta,
  quality,
  /** Fraction of the panel's inline size one figure may occupy. */
  span = 0.5,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: { value: string; direction: "up" | "down" | "flat" };
  quality?: string;
  span?: number;
}) {
  // A monospace glyph is ~0.6em wide, so N characters need 0.6·N·fontSize. Turn
  // that around: the largest font that fits `span` of the container is
  // (span·100 / (0.6·N)) cqi. Derived from the value actually being rendered,
  // so a figure that grows a digit shrinks itself instead of overflowing.
  const chars = Math.max(value.length, 3);
  const cqi = (span * 100) / (0.62 * chars);

  return (
    <div className="min-w-0">
      <p
        className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-label)" }}
      >
        {label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className="font-mono tabular-nums text-[var(--ink)]"
          style={{
            fontSize: `clamp(0.95rem, ${cqi.toFixed(2)}cqi, var(--d-figure))`,
            lineHeight: 1.05,
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            className="shrink-0 text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
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

/**
 * A live pulse. Used where a figure is genuinely updating, and nowhere else —
 * an animation on a static number is a lie told in motion.
 */
export function Pulse({ label }: { label: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-[var(--ink-faint)]"
      style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
    >
      <span className="relative inline-flex size-1.5">
        <span
          className="absolute inline-flex size-full rounded-full opacity-70 motion-safe:animate-ping"
          style={{ background: "var(--congestion-free)" }}
        />
        <span
          className="relative inline-flex size-1.5 rounded-full"
          style={{ background: "var(--congestion-free)" }}
        />
      </span>
      {label}
    </span>
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
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: colour }}
      />
    </div>
  );
}
