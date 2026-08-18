import type { Ramp } from "@/lib/ribbon";

/**
 * The Jaipur Night congestion ramp (ADR-016), as concrete values for the WebGL
 * layer. Mirrors palettes.css, which scripts/check_contrast.py measures.
 */
export const RAMP_NIGHT: Ramp = {
  free: "#2DD4A7",
  light: "#8CD65B",
  moderate: "#FFB020",
  severe: "#FF6B4A",
  critical: "#FF2D55",
  suppressed: "#6B7280",
};
