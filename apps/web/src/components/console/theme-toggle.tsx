"use client";

import { useSyncExternalStore } from "react";

/**
 * Day / night for the whole interface.
 *
 * docs/06 §6: dark is the control-room native mode and the default. But an
 * officer reading this on a phone in daylight, or a projector in a lit room,
 * needs the other one — so the toggle is always visible in the top bar rather
 * than buried in settings.
 *
 * The choice is written to the document and to localStorage synchronously in
 * the click handler, so the DOM and React state can never disagree — a bug that
 * shipped once already on the palette switcher.
 */
const KEY = "pravaah-theme";
const listeners = new Set<() => void>();

function current(): "night" | "day" {
  if (typeof document === "undefined") return "night";
  return document.documentElement.getAttribute("data-scene") === "day" ? "day" : "night";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function ThemeToggle() {
  const scene = useSyncExternalStore(subscribe, current, () => "night" as const);
  const next = scene === "night" ? "day" : "night";

  return (
    <button
      type="button"
      onClick={() => {
        const root = document.documentElement;
        root.setAttribute("data-scene", next);
        root.setAttribute("data-theme", next === "day" ? "light" : "dark");
        try {
          localStorage.setItem(KEY, next === "day" ? "light" : "dark");
        } catch {
          // Private browsing blocks storage; the toggle still works for the session.
        }
        listeners.forEach((cb) => cb());
      }}
      aria-label={next === "day" ? "Switch to day" : "Switch to night"}
      title={next === "day" ? "Switch to day" : "Switch to night"}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ink-muted)]
                 transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
    >
      <span aria-hidden="true">{scene === "night" ? "☾" : "☀"}</span>
    </button>
  );
}
