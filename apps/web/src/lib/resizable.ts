"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

/**
 * A draggable split, persisted per key.
 *
 * A control room is not one layout. The officer watching the corridor wants
 * the map wide; the analyst reading the panels wants the rail wide; the person
 * projecting it in a review wants it wider still so the back row can read a
 * figure. A fixed width forces two of those three to lose, so the split is
 * theirs to set and it is remembered.
 *
 * Two deliberate choices, both about not fighting React:
 *
 * **Storage is the store.** The persisted width is read through
 * `useSyncExternalStore` rather than restored by an effect. Restoring in an
 * effect means rendering the default, then setting state, then rendering
 * again — a cascade the React compiler correctly refuses, and a visible jump
 * of the rail on every load.
 *
 * **The drag writes CSS, not state.** A `setState` per `pointermove`
 * re-renders the whole console — including the WebGL canvas's parent — sixty
 * times a second, dropping frames exactly while the user is judging whether
 * the drag feels smooth. The live value goes straight to a custom property;
 * React learns it once, on release.
 */

const listeners = new Set<() => void>();
const cache = new Map<string, number>();

function notify() {
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readStored(key: string, initial: number, min: number, max: number): number {
  if (typeof window === "undefined") return initial;
  const memo = cache.get(key);
  if (memo !== undefined) return memo;
  let value = initial;
  try {
    const raw = Number(localStorage.getItem(key));
    if (Number.isFinite(raw) && raw >= min && raw <= max) value = raw;
  } catch {
    // Private browsing blocks storage; the default is a fine answer.
  }
  cache.set(key, value);
  return value;
}

function write(key: string, value: number) {
  cache.set(key, value);
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // as above — the drag still works for this session
  }
  notify();
}

export function useSplit({
  key,
  initial,
  min,
  max,
  /** The pane grows as the pointer moves left (a right-hand rail). */
  invert = true,
}: {
  key: string;
  initial: number;
  min: number;
  max: number;
  invert?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const width = useSyncExternalStore(
    subscribe,
    () => readStored(key, initial, min, max),
    () => initial,
  );

  const apply = useCallback((value: number) => {
    hostRef.current?.style.setProperty("--split", `${value}px`);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      setDragging(true);
      document.documentElement.setAttribute("data-resizing", "");

      const startX = event.clientX;
      const startWidth = readStored(key, initial, min, max);
      let live = startWidth;

      const move = (e: PointerEvent) => {
        const delta = invert ? startX - e.clientX : e.clientX - startX;
        live = Math.round(Math.min(max, Math.max(min, startWidth + delta)));
        apply(live);
      };
      const up = () => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        document.documentElement.removeAttribute("data-resizing");
        setDragging(false);
        write(key, live);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      // A cancelled pointer — a system gesture, a lost capture — must still
      // release, or the whole document keeps the col-resize cursor forever.
      handle.addEventListener("pointercancel", up);
    },
    [apply, initial, invert, key, max, min],
  );

  /** Keyboard resizing. A separator that only answers to a mouse is not a
   *  control (WCAG 2.1 §2.1.1), and a wall display driven from a lectern
   *  keyboard has no mouse to offer it. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? 48 : 16;
      const current = readStored(key, initial, min, max);
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = current + (invert ? step : -step);
      if (event.key === "ArrowRight") next = current - (invert ? step : -step);
      if (event.key === "Home") next = max;
      if (event.key === "End") next = min;
      if (next === null) return;
      event.preventDefault();
      const clamped = Math.min(max, Math.max(min, next));
      apply(clamped);
      write(key, clamped);
    },
    [apply, initial, invert, key, max, min],
  );

  const reset = useCallback(() => {
    apply(initial);
    cache.set(key, initial);
    try {
      localStorage.removeItem(key);
    } catch {
      // as above
    }
    notify();
  }, [apply, initial, key]);

  return { hostRef, width, dragging, onPointerDown, onKeyDown, reset };
}
