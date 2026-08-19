"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, but only after the browser has taken over.
 *
 * The bug this exists to end
 * --------------------------
 * The console header rendered `new Date()` straight into text. `shell.tsx` is a
 * client component, but Next.js still renders client components on the server
 * for the initial HTML, so the server wrote "4:03 pm" and the browser hydrated
 * a moment later wanting to write "4:04 pm". React sees the text differ, throws
 * hydration error #418, discards the server markup for that subtree and
 * re-renders it on the client.
 *
 * It fires only when the minute happens to roll over between the server render
 * and hydration, so it is intermittent, invisible in a screenshot, and more
 * likely the slower the connection — which means most likely on exactly the
 * machines a department would use.
 *
 * The same value positioned the "now" marker on the day-profile chart, so that
 * could be drawn at one place in the server HTML and another after hydration.
 *
 * Why an external store rather than an effect
 * -------------------------------------------
 * The obvious shape is `useState(null)` plus `useEffect(() => setNow(...))`, and
 * it works, but it sets state synchronously inside an effect to produce a value
 * that render could have derived — which the React Compiler rightly flags as a
 * cascading render. A clock is an external source that changes on its own, which
 * is precisely what `useSyncExternalStore` is for, and it is the pattern
 * `lib/resizable.ts` already uses for the same reason.
 *
 * `getServerSnapshot` returns null, so the server render and the first client
 * render agree by construction: neither has a time, so there is nothing that
 * can mismatch.
 *
 * It also ticks
 * -------------
 * The old clock was formatted once and never again, so a console left open on a
 * control room wall showed the time the page happened to load, indefinitely,
 * while looking exactly like a live clock. A stopped clock that looks like a
 * running one is worse than no clock.
 */

const TICK_MS = 30_000;

let current: number | null = null;
let timer: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    // First subscriber starts the clock. Setting `current` here rather than at
    // module scope keeps the server bundle from ever holding a time.
    current = Date.now();
    timer = window.setInterval(() => {
      current = Date.now();
      emit();
    }, TICK_MS);
    // The value only just became non-null, so tell React about it.
    queueMicrotask(emit);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

/** Milliseconds since the epoch, or null until the browser has mounted. */
function getSnapshot(): number | null {
  return current;
}

function getServerSnapshot(): number | null {
  return null;
}

export function useClientNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Minutes since midnight in Jaipur, or null before mount.
 *
 * Jaipur rather than the viewer's zone on purpose: the brass marker on the day
 * profile points at the local traffic peak, and an officer reading the console
 * from anywhere else still wants to know what time it is on Tonk Road.
 */
export function jaipurMinutes(now: number | null): number | null {
  if (now === null) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));
  return (
    Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value ?? 0)
  );
}
