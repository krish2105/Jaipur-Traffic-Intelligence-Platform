import { defineRouting } from "next-intl/routing";

/**
 * docs/03 §7: Hindi and English, full parity. Hindi is a first-class language
 * here, not a translation layer (docs/02 rule 7).
 *
 * `localePrefix: "always"` keeps /hi and /en explicit in the URL so a Hindi
 * page is linkable and forwardable — doc 09 §8 notes the official will forward
 * the Hindi artefacts, so those URLs must be stable and unambiguous.
 */
export const routing = defineRouting({
  locales: ["en", "hi"] as const,
  defaultLocale: "en",
  localePrefix: "always",
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
