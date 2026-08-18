import type { Locale } from "@/i18n/routing";

/**
 * Indian digit grouping. docs/06 §5 makes this mandatory:
 *   correct   12,84,700
 *   wrong      1,284,700
 *
 * `en-IN` and `hi-IN` both produce lakh/crore grouping. `hi-IN` additionally
 * renders Devanagari-appropriate formatting where the locale calls for it.
 */
const localeTag = (locale: Locale): string => (locale === "hi" ? "hi-IN" : "en-IN");

export function formatCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 0 }).format(value);
}

export function formatPcu(value: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(fraction: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(fraction);
}

/** Signed delta against a baseline, e.g. "▲12.4%" / "▼3.1%". */
export function formatDelta(fraction: number, locale: Locale): string {
  const arrow = fraction > 0 ? "▲" : fraction < 0 ? "▼" : "–";
  return `${arrow}${formatPercent(Math.abs(fraction), locale)}`;
}

/**
 * The congestion ramp from docs/06 §1. Fixed, published, identical everywhere.
 * Returns a CSS variable name, never a hex — components must not hardcode.
 */
export function congestionToken(index: number): string {
  if (index <= 25) return "var(--congestion-free)";
  if (index <= 50) return "var(--congestion-light)";
  if (index <= 70) return "var(--congestion-moderate)";
  if (index <= 85) return "var(--congestion-severe)";
  return "var(--congestion-critical)";
}

/** i18n key for the congestion band, so the label is never hardcoded English. */
export function congestionBandKey(index: number): string {
  if (index <= 25) return "congestion.free";
  if (index <= 50) return "congestion.light";
  if (index <= 70) return "congestion.moderate";
  if (index <= 85) return "congestion.severe";
  return "congestion.critical";
}
