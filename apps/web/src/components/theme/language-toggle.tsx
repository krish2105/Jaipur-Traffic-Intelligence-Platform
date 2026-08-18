"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * docs/06 §5: the language toggle sits in the top bar at all times, never
 * buried in settings. Half the intended users will prefer Hindi and should
 * never have to hunt for it.
 */
export function LanguageToggle() {
  const locale = useLocale() as Locale;
  const t = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname();

  const next: Locale = locale === "hi" ? "en" : "hi";

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: next })}
      aria-label={t("switchLanguage")}
      className="h-9 rounded-(--radius-token) px-2.5 text-sm text-ink-muted
                 transition-colors hover:text-ink hover:bg-surface-sunk"
    >
      <span aria-hidden="true" className={locale === "hi" ? "text-ink" : undefined}>हिं</span>
      <span aria-hidden="true" className="mx-1 opacity-40">|</span>
      <span aria-hidden="true" className={locale === "en" ? "text-ink" : undefined}>EN</span>
    </button>
  );
}
