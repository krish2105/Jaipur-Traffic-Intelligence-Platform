"use client";

import { useSyncExternalStore } from "react";

/**
 * False on the server and on the first client render; true after hydration.
 *
 * What it is for
 * --------------
 * Some things cannot render the same on both sides. A `dynamic(..., { ssr: false })`
 * import resolves before hydration when its chunk is already available, so
 * React's first client render is the real component where the server HTML holds
 * a placeholder. Recharts' `ResponsiveContainer` measures its parent, finds no
 * dimensions on the server, and renders an empty box that the client fills the
 * moment it can measure.
 *
 * Both produce hydration error #418: React discards the server markup for that
 * subtree and re-renders it. Nothing looks wrong afterwards, which is exactly
 * why it went unnoticed on the console for weeks and was found in a log rather
 * than on screen (ADR-063).
 *
 * Gating on this makes both first renders agree by construction — neither has
 * mounted, so both produce the placeholder — and the real thing appears on the
 * update that follows hydration.
 *
 * Why `useSyncExternalStore` and not `useState` plus `useEffect`
 * -------------------------------------------------------------
 * The effect version works and sets state synchronously inside an effect to
 * produce something render could have derived, which the React Compiler flags
 * as a cascading render. This hook has a genuinely different server snapshot,
 * which is what `useSyncExternalStore` exists for, and it is the pattern
 * `lib/resizable.ts` and `city/city-scene.loader.tsx` already use.
 *
 * The subscribe callback never fires on purpose: the value changes once, and
 * React reads the client snapshot on the render after hydration without needing
 * to be told.
 */

const subscribeNever = () => () => {};

export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
