/**
 * How a link's speed came to be, said the same way everywhere.
 *
 * There are three provenances and they are not interchangeable. A probe reading
 * is a live TomTom measurement of this road right now. A camera reading is what
 * a camera on the link saw. A modelled speed was measured by nothing at all and
 * derived from the congestion index.
 *
 * This lives in one place because it was previously inlined at four call sites
 * with four slightly different wordings, and the moment a third value appeared
 * three of them silently started describing it as "measured by a camera".
 * docs/06 section 8: no naked number, and no number wearing the wrong label.
 */

export type SpeedSource = "probe" | "measured" | "modelled";

/** The suffix printed after the number. Empty for a camera reading. */
export function speedSourceMark(source: SpeedSource | undefined): string {
  if (source === "modelled") return "~";
  if (source === "probe") return "•";
  return "";
}

/** Which CSS colour token the mark should use. */
export function speedSourceTint(source: SpeedSource | undefined): string {
  return source === "probe" ? "var(--accent)" : "var(--ink-faint)";
}

/** The hover text. Says what measured it, or admits nothing did. */
export function speedSourceTitle(source: SpeedSource | undefined, hi: boolean): string {
  if (source === "probe") {
    return hi
      ? "TomTom से अभी की सीधी रीडिंग — गति और देरी, गिनती नहीं"
      : "live TomTom reading — speed and delay only, never a vehicle count";
  }
  if (source === "modelled") {
    return hi
      ? "भीड़ सूचकांक से निकाला गया, किसी ने मापा नहीं"
      : "derived from the congestion index — measured by nothing";
  }
  return hi ? "कैमरे से मापा गया" : "measured by a camera";
}
