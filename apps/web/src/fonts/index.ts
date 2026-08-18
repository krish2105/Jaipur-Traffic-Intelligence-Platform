import localFont from "next/font/local";
import { Anek_Devanagari, Anek_Latin, JetBrains_Mono } from "next/font/google";

/**
 * Display face. Clash Display, Indian Type Foundry, ITF Free Font Licence.
 *
 * Self-hosted rather than loaded from Fontshare's CDN: a deployed artefact's
 * CSP blocks external font hosts, and docs/03 §5 requires the demo to run with
 * the network cable pulled.
 */
export const clashDisplay = localFont({
  src: [
    { path: "./ClashDisplay-400.woff2", weight: "400", style: "normal" },
    { path: "./ClashDisplay-500.woff2", weight: "500", style: "normal" },
    { path: "./ClashDisplay-600.woff2", weight: "600", style: "normal" },
    { path: "./ClashDisplay-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

/**
 * UI and Hindi. Anek is also an Indian Type Foundry family, built specifically
 * for Devanagari–Latin pairing — which is why it was kept rather than replaced
 * when the rest of the type system changed. Latin first, Devanagari second, so
 * each script renders from the family that actually covers it.
 */
export const anekLatin = Anek_Latin({
  subsets: ["latin"],
  variable: "--font-anek-latin",
  display: "swap",
});

export const anekDevanagari = Anek_Devanagari({
  subsets: ["devanagari", "latin"],
  variable: "--font-anek-devanagari",
  display: "swap",
});

/** Every measurement. Tabular figures so values don't jitter as they update. */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const fontVariables = [
  clashDisplay.variable,
  anekLatin.variable,
  anekDevanagari.variable,
  jetbrainsMono.variable,
].join(" ");
