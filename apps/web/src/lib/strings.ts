import type { Locale } from "@/i18n/routing";

/**
 * Console strings, in both languages, in one place.
 *
 * docs/02 rule 7 and docs/03 §7 both make Hindi a first-class language rather
 * than a translation layer, and CLAUDE.md prohibits a hardcoded user-facing
 * string outright. The console panels were written in English while the shape
 * of each panel was still moving, which was the right order to build in and the
 * wrong place to stop.
 *
 * This is a plain table rather than next-intl messages on purpose. These are
 * the ~90 strings of one dense operator surface, they change together whenever
 * a panel changes, and keeping them beside the components that use them is what
 * makes an English-only string obvious in review. The marketing surfaces stay
 * on next-intl, where translator workflow matters more than proximity.
 *
 * Hindi here is the Devanagari a Jaipur traffic engineer actually uses:
 * "भीड़" for congestion rather than a Sanskritised coinage, "चालान" for a
 * challan, "लिंक" transliterated because that is what the department says.
 */

type Pair = readonly [en: string, hi: string];

export const S = {
  // panels
  countsLive: ["Counts · live", "गणना · लाइव"],
  composition: ["Composition", "संरचना"],
  forecast: ["Forecast", "पूर्वानुमान"],
  dataQuality: ["Data quality · today", "डेटा गुणवत्ता · आज"],
  blackSpots: ["Black spots · severity", "ब्लैक स्पॉट · गंभीरता"],
  signalAdvisory: ["Signal advisory", "सिग्नल सलाह"],
  incidentsSafety: ["Incidents · safety", "घटनाएँ · सुरक्षा"],
  readiness: ["Live data · readiness", "लाइव डेटा · तैयारी"],
  conditions: ["Conditions", "परिस्थितियाँ"],
  weeklyPattern: ["Weekly pattern", "साप्ताहिक पैटर्न"],

  // badges
  simulated: ["Simulated", "अनुरूपित"],
  advisory: ["Advisory", "सलाहकार"],
  band80: ["80% band", "80% परास"],
  measured28: ["last 28 days, measured", "पिछले 28 दिन, मापा गया"],
  live: ["live", "लाइव"],
  replay: ["replay", "रीप्ले"],

  // metrics
  vehicles: ["Vehicles", "वाहन"],
  pcu: ["PCU", "PCU"],
  cameras: ["Cameras", "कैमरे"],
  meanQuality: ["Mean quality", "औसत गुणवत्ता"],
  suppressed: ["Suppressed", "दबाए गए"],
  temp: ["Temp", "तापमान"],
  rain: ["Rain", "वर्षा"],
  visibility: ["Visibility", "दृश्यता"],

  // qualifiers
  quality: ["quality", "गुणवत्ता"],
  binsSuppressed: ["bins suppressed", "बिन दबाए गए"],
  noBinsSuppressed: ["no bins suppressed", "कोई बिन नहीं दबाया"],
  inclNightBins: ["incl. night bins", "रात्रि बिन सहित"],
  peakHour: ["Peak hour", "व्यस्ततम घंटा"],
  free: ["free", "मुक्त"],
  twoWheeler: ["two-wheeler", "दोपहिया"],

  // sentences
  noSegments: [
    "No segment has enough crashes to rank.",
    "किसी खंड में रैंक करने लायक पर्याप्त दुर्घटनाएँ नहीं।",
  ],
  compositionArgument: [
    "Probe data reports delay, never composition. Every capacity calculation, signal plan and freight window depends on this split — and no probe product in the world can produce it.",
    "प्रोब डेटा केवल देरी बताता है, संरचना कभी नहीं। हर क्षमता गणना, सिग्नल योजना और माल-ढुलाई खिड़की इसी विभाजन पर टिकी है — और दुनिया का कोई प्रोब उत्पाद इसे नहीं बना सकता।",
  ],
  weatherOk: [
    "— no weather degradation of counting.",
    "— मौसम से गणना पर कोई प्रभाव नहीं।",
  ],
  weatherDegraded: [
    "— counting accuracy reduced; affected bins are suppressed and shown as such.",
    "— गणना सटीकता घटी; प्रभावित बिन दबाए जाते हैं और वैसा ही दिखाया जाता है।",
  ],
  weeklyNote: [
    "Twin peaks every weekday; Friday heaviest; Sunday materially quieter. Measured, not predicted.",
    "हर कार्यदिवस दो शिखर; शुक्रवार सबसे भारी; रविवार काफ़ी शांत। मापा गया, अनुमानित नहीं।",
  ],
  validatedPer: ["published per camera", "प्रति कैमरा प्रकाशित"],
  daylight: ["daylight", "दिन"],
  night: ["night", "रात"],
  incidentsCaption: ["crashes", "दुर्घटनाएँ"],
  deaths: ["deaths", "मौतें"],
  detectorQueue: ["Detector queue", "डिटेक्टर कतार"],
  open: ["open", "खुली"],
  in24h: ["in 24h", "24 घंटे में"],
  crashPeakNote: [
    "— the same hour as congestion. The evening jam is when people are hurt.",
    "— वही घंटा जब भीड़ चरम पर है। शाम का जाम ही वह समय है जब लोग घायल होते हैं।",
  ],
  updated: ["updated", "अद्यतन"],
} as const satisfies Record<string, Pair>;

export type StringKey = keyof typeof S;

/** `t("vehicles")` bound to a locale. One call, no namespace juggling. */
export function translator(locale: Locale) {
  const index = locale === "hi" ? 1 : 0;
  return (key: StringKey): string => S[key][index];
}
