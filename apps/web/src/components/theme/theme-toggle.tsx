"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useThemeStore } from "./use-theme";

/**
 * The light/dark toggle. Always visible in the top bar.
 *
 * A real <button> with a real accessible name, so keyboard and screen-reader
 * users get the same affordance. The circular View-Transition wipe originates
 * from the button's own centre, which is why we measure it on click.
 */
export function ThemeToggle() {
  const t = useTranslations("nav");
  const { theme, hydrated, hydrate, setTheme } = useThemeStore();
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  const next = theme === "dark" ? "light" : "dark";

  function onClick() {
    const rect = ref.current?.getBoundingClientRect();
    const origin = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : undefined;
    setTheme(next, origin);
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={t(next === "dark" ? "switchToDark" : "switchToLight")}
      className="grid size-9 place-items-center rounded-(--radius-token) text-ink-muted
                 transition-colors hover:text-ink hover:bg-surface-sunk"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
           stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {/* Sun/moon morph: the mask slides across the disc rather than swapping icons. */}
        <mask id="pravaah-moon-mask">
          <rect width="24" height="24" fill="white" />
          <circle cx={theme === "dark" ? 16 : 30} cy={theme === "dark" ? 8 : -6} r="8" fill="black"
                  style={{ transition: "cx 400ms var(--ease-out-expo), cy 400ms var(--ease-out-expo)" }} />
        </mask>
        <circle cx="12" cy="12" r={theme === "dark" ? 8 : 5} fill="currentColor" stroke="none"
                mask="url(#pravaah-moon-mask)"
                style={{ transition: "r 400ms var(--ease-out-expo)" }} />
        <g style={{ opacity: theme === "dark" ? 0 : 1, transition: "opacity 300ms" }}>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line key={deg} x1="12" y1="2.5" x2="12" y2="4.5"
                  transform={`rotate(${deg} 12 12)`} />
          ))}
        </g>
      </svg>
    </button>
  );
}
