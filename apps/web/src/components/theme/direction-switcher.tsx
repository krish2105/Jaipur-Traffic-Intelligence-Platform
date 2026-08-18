"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { DIRECTIONS, useThemeStore, type Direction } from "./use-theme";

/**
 * Phase 1 decision aid. Swaps the visual direction live so the same dashboard,
 * on the same data, can be compared three ways before one is chosen.
 *
 * This is a build-time-gated evaluation control, not a product feature — it is
 * removed once a direction is picked.
 */
export function DirectionSwitcher() {
  const t = useTranslations("design");
  const { direction, hydrated, hydrate, setDirection } = useThemeStore();

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  return (
    <fieldset className="flex items-center gap-1 rounded-(--radius-token-lg) border border-rule p-1">
      <legend className="sr-only">{t("chooseDirection")}</legend>
      {DIRECTIONS.map((d: Direction) => (
        <button
          key={d}
          type="button"
          onClick={() => setDirection(d)}
          aria-pressed={direction === d}
          className="rounded-(--radius-token) px-3 py-1.5 text-sm transition-colors
                     aria-pressed:bg-accent aria-pressed:text-accent-ink
                     text-ink-muted hover:text-ink"
        >
          {t(`direction.${d}`)}
        </button>
      ))}
    </fieldset>
  );
}
