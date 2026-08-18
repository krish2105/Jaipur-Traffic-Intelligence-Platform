"use client";

/**
 * The separator between two resizable panes.
 *
 * Rendered as a 10px hit area with a 1px visible rule inside it. Fitts's law
 * is the whole design: a 1px target is a target you miss, and missing a drag
 * handle repeatedly is what makes an interface feel cheap. The visible line
 * stays hairline so the layout does not gain a heavy border.
 *
 * `role="separator"` with `aria-valuenow` is not decoration — it is what makes
 * the arrow-key resizing in `useSplit` discoverable to a screen reader, and
 * what stops this being a mouse-only control.
 */
export function SplitHandle({
  value,
  min,
  max,
  dragging,
  label,
  onPointerDown,
  onKeyDown,
  onDoubleClick,
}: {
  value: number;
  min: number;
  max: number;
  dragging: boolean;
  label: string;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      title={`${label} — drag, or arrow keys. Double-click to reset.`}
      className="group relative z-10 hidden w-2.5 shrink-0 cursor-col-resize touch-none
                 select-none lg:block focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors
                   group-hover:bg-[var(--accent)] group-focus-visible:bg-[var(--accent)]"
        style={{ background: dragging ? "var(--accent)" : "var(--rule)" }}
      />
      {/* The grip only appears on hover or focus. A permanent grip on a
          control-room wall is six pieces of furniture nobody asked for. */}
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2
                   rounded-full opacity-0 transition-opacity group-hover:opacity-100
                   group-focus-visible:opacity-100"
        style={{ background: "var(--accent)" }}
      />
    </div>
  );
}
