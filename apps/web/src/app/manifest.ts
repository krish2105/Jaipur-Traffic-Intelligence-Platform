import type { MetadataRoute } from "next";

/**
 * PWA manifest.
 *
 * The citizen view is the one that needs installing: it is checked on a
 * footpath, on a phone, often on a poor connection, and an icon on the home
 * screen is the difference between a page someone visits twice and one they
 * keep. `start_url` therefore points at the citizen view rather than the
 * console — an installed app should open on the thing the installer wanted.
 *
 * `display: "standalone"` rather than `"fullscreen"`: a citizen checking
 * whether to leave needs their clock and battery visible, and taking the status
 * bar away to look more like an app is a trade against them.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PRAVAAH — Jaipur traffic",
    short_name: "PRAVAAH",
    description:
      "Measured traffic conditions for Jaipur corridors, with the quality of every figure shown beside it.",
    start_url: "/en/citizen",
    display: "standalone",
    background_color: "#0B1220",
    theme_color: "#0B1220",
    orientation: "portrait",
    lang: "en",
    categories: ["travel", "navigation", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
