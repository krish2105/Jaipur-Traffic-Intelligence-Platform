/**
 * One writer for day/night.
 *
 * This exists because there were two. The header toggle wrote `data-scene` to
 * `<html>`, and the 3D view owned a separate `useState` whose effect wrote the
 * same attribute on every render — so switching the interface to light left a
 * night city glowing inside it, and no amount of staring at the toggle
 * explained why. Any second source of truth for a DOM attribute ends this way.
 *
 * The store IS the document. There is no cached copy to drift: `current()`
 * reads the attribute, and every write goes through `setTheme`. `useSyncExter-
 * nalStore` then gives React a value it cannot render stale.
 */

export type Scene = "night" | "day";

const KEY = "pravaah-theme";
const listeners = new Set<() => void>();

export function currentScene(): Scene {
  if (typeof document === "undefined") return "night";
  return document.documentElement.getAttribute("data-scene") === "day" ? "day" : "night";
}

/** Server snapshot. docs/06 §6 makes dark the control-room default. */
export function serverScene(): Scene {
  return "night";
}

export function subscribeScene(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setTheme(next: Scene): void {
  const root = document.documentElement;
  root.setAttribute("data-scene", next);
  root.setAttribute("data-theme", next === "day" ? "light" : "dark");
  try {
    localStorage.setItem(KEY, next === "day" ? "light" : "dark");
  } catch {
    // Private browsing blocks storage. The toggle still works for the session.
  }
  listeners.forEach((cb) => cb());
}
