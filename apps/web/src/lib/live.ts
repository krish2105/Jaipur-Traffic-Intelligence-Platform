"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Polling for the panels that claim to be live.
 *
 * A panel titled "Counts · live" that never changes is a lie the interface
 * tells every few seconds. Either the figure updates or the word goes.
 *
 * Three properties that matter more than the polling itself:
 *
 * **It stops when nobody is looking.** `document.hidden` gates the timer, so a
 * console left open on a wall overnight is not issuing a request every fifteen
 * seconds until morning. It also refetches immediately on becoming visible, so
 * returning to the tab shows current data rather than whatever was on screen
 * when it was hidden.
 *
 * **A failed poll keeps the last good value.** Blanking a figure because one
 * request timed out is worse than showing a figure that is fifteen seconds
 * stale, as long as the staleness is visible — which is what `updatedAt` is
 * for.
 *
 * **It backs off on repeated failure.** A control room that loses its API
 * should not turn into a client hammering a struggling server.
 */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  { intervalMs = 15_000, enabled = true }: { intervalMs?: number; enabled?: boolean } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [failing, setFailing] = useState(false);
  // Written in an effect, not during render. The caller passes a fresh closure
  // each render; keeping it in a ref is what stops the poll restarting on every
  // parent re-render, but writing a ref during render is a mutation React is
  // allowed to discard under concurrent rendering.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const next = await fetcherRef.current();
        if (cancelled) return;
        failures = 0;
        setData(next);
        setUpdatedAt(Date.now());
        setFailing(false);
      } catch {
        if (cancelled) return;
        failures += 1;
        // Keep the last good value; only say so.
        setFailing(true);
      }
      if (cancelled) return;
      // Exponential backoff, capped at two minutes.
      const delay = Math.min(intervalMs * 2 ** Math.min(failures, 3), 120_000);
      timer = setTimeout(tick, delay);
    };

    const onVisible = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs]);

  return { data, updatedAt, failing };
}

/**
 * True for a moment after `value` changes — drives the flash on a figure that
 * has just updated.
 *
 * A pulse on a static number is a lie told in motion, so this keys strictly on
 * the value changing rather than on a poll completing. A poll that returns the
 * same count does not flash, which is the correct behaviour: nothing happened.
 */
export function useChanged(value: unknown, ms = 900): boolean {
  const [changed, setChanged] = useState(false);
  const previous = useRef(value);

  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    setChanged(true);
    const id = setTimeout(() => setChanged(false), ms);
    return () => clearTimeout(id);
  }, [value, ms]);

  return changed;
}
