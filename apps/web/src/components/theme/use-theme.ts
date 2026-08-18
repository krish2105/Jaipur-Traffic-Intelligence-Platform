"use client";

import { create } from "zustand";

export type Theme = "light" | "dark";
export type Direction = "instrument" | "control" | "editorial";

export const DIRECTIONS: readonly Direction[] = ["instrument", "control", "editorial"];

interface ThemeState {
  theme: Theme;
  direction: Direction;
  hydrated: boolean;
  hydrate: () => void;
  setTheme: (t: Theme, origin?: { x: number; y: number }) => void;
  setDirection: (d: Direction) => void;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The theme swap. Two axes, both persisted, both applied to <html>.
 *
 * The swap itself uses the View Transitions API to wipe a circle outward from
 * the toggle's own coordinates. Where the API is unsupported — or the user has
 * asked for reduced motion — it degrades to an instant attribute swap with no
 * error and no half-animation.
 */
function applyTheme(theme: Theme, origin?: { x: number; y: number }) {
  const root = document.documentElement;
  const commit = () => root.setAttribute("data-theme", theme);

  const canAnimate =
    "startViewTransition" in document &&
    typeof document.startViewTransition === "function" &&
    !prefersReducedMotion() &&
    origin !== undefined;

  if (!canAnimate) {
    commit();
    return;
  }

  const { x, y } = origin;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

  root.setAttribute("data-theme-swapping", "true");
  const transition = document.startViewTransition(commit);

  void transition.ready.then(() => {
    root.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
      },
      {
        duration: 480,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        pseudoElement: "::view-transition-new(root)",
      },
    );
  });

  void transition.finished.finally(() => root.removeAttribute("data-theme-swapping"));
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "light",
  direction: "instrument",
  hydrated: false,

  hydrate: () =>
    set(() => {
      const root = document.documentElement;
      return {
        theme: (root.getAttribute("data-theme") as Theme) ?? "light",
        direction: (root.getAttribute("data-direction") as Direction) ?? "instrument",
        hydrated: true,
      };
    }),

  setTheme: (theme, origin) => {
    applyTheme(theme, origin);
    localStorage.setItem("pravaah-theme", theme);
    set({ theme });
  },

  setDirection: (direction) => {
    document.documentElement.setAttribute("data-direction", direction);
    localStorage.setItem("pravaah-direction", direction);
    set({ direction });
  },
}));
