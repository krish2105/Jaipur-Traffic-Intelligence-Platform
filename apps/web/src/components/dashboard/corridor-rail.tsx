"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { Corridor } from "@/lib/api";
import type { Locale } from "@/i18n/routing";

export function CorridorRail({
  corridors,
  selectedId,
}: {
  corridors: Corridor[];
  selectedId: number;
}) {
  const t = useTranslations("dashboard");
  const locale = useLocale() as Locale;

  return (
    <nav
      aria-label={t("corridors")}
      className="border border-rule rounded-(--radius-token-lg) bg-surface p-(--density-pad)"
    >
      <h2 className="text-(length:--type-caption) uppercase tracking-[0.14em] text-ink-muted">
        {t("corridors")}
      </h2>
      <ul className="mt-3 space-y-1">
        {corridors.map((corridor) => {
          const selected = corridor.corridor_id === selectedId;
          return (
            <li key={corridor.corridor_id}>
              <Link
                href={`/dashboard?corridor=${corridor.corridor_id}`}
                aria-current={selected ? "page" : undefined}
                className="flex items-baseline justify-between gap-2 rounded-(--radius-token)
                           px-2 py-1.5 text-sm transition-colors hover:bg-surface-sunk
                           aria-[current=page]:bg-surface-sunk"
              >
                <span className="flex items-center gap-2">
                  {corridor.is_model_corridor && (
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-accent"
                      title={t("modelCorridor")}
                    />
                  )}
                  {locale === "hi" ? corridor.name.hi : corridor.name.en}
                </span>
                <span className="metric shrink-0 text-(length:--type-caption) text-ink-muted">
                  {corridor.length_km.toFixed(1)} km
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 border-t border-rule pt-3 text-(length:--type-caption) leading-relaxed text-ink-muted">
        {t("modelCorridorNote")}
      </p>
    </nav>
  );
}
