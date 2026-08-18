"use client";

import { useSyncExternalStore } from "react";

import { currentScene, serverScene, setTheme, subscribeScene } from "@/lib/theme";

/**
 * Day / night for the whole interface.
 *
 * docs/06 §6: dark is the control-room native mode and the default. But an
 * officer reading this on a phone in daylight, or a projector in a lit room,
 * needs the other one — so the toggle is always visible in the top bar rather
 * than buried in settings.
 *
 * All state lives in `lib/theme`, which reads and writes the document
 * directly. This component holds nothing of its own, which is the only reason
 * it cannot disagree with the 3D view about what time of day it is.
 */
export function ThemeToggle() {
  const scene = useSyncExternalStore(subscribeScene, currentScene, serverScene);
  const next = scene === "night" ? "day" : "night";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={next === "day" ? "Switch to day" : "Switch to night"}
      title={next === "day" ? "Switch to day" : "Switch to night"}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ink-muted)]
                 transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
    >
      <span aria-hidden="true">{scene === "night" ? "☾" : "☀"}</span>
    </button>
  );
}
