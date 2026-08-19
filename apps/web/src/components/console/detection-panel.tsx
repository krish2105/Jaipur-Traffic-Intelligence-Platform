"use client";

import type { DetectionEvidence } from "@/lib/api";

/**
 * What the detector actually saw on real Jaipur streets.
 *
 * The rest of the console reports measurements. This reports a *test*, and it
 * leads with the result that is against us, because a panel that leads with its
 * own worst finding is a panel the rest of which gets believed.
 *
 * That worst finding used to be "zero two-wheelers detected". It was wrong, and
 * the correction is worth recording here because the panel was built around it.
 * The evidence script keyed its class map on the COCO label name "motorcycle";
 * RT-DETR publishes the older VOC-style vocabulary, in which the class is
 * "motorbike". Every two-wheeler was detected and then dropped by the lookup.
 * Re-run against the id-based map the counting package always used, two-
 * wheelers come back at ~53% of detections against a fleet that is ~61%
 * two-wheelers — the dominant class recovered at roughly the right share with
 * no fine-tuning at all.
 *
 * The real gap is narrower and harder: COCO has no auto-rickshaw class, autos
 * are 6.2% of measured traffic on this corridor, and the model reports them as
 * car or two-wheeler depending on the angle. That is what the section below
 * now says, because it is what the evidence supports.
 *
 * The discarded person count is shown for a different reason: CLAUDE.md
 * prohibits person detection, the model emits it anyway, and a prohibition that
 * is enforced silently is indistinguishable from one that is not enforced.
 */
export function DetectionPanel({
  data,
  hi,
}: {
  data: DetectionEvidence | null;
  hi: boolean;
}) {
  if (!data?.images?.length) return null;

  const classes = Object.entries(data.class_mix_pct).sort((a, b) => b[1] - a[1]);
  const twoWheelerShare = (data.class_mix_pct["2W"] ?? 0).toFixed(0);

  return (
    <div className="space-y-4">
      {/* The failure first. */}
      <section
        className="rounded-xl border-l-2 border-[var(--congestion-severe)] bg-[var(--surface)]
                   p-4 sm:p-5"
        style={{ boxShadow: "var(--shadow-panel)" }}
      >
        <p
          className="uppercase tracking-[0.14em] text-[var(--congestion-severe)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          {hi ? "प्रतिकूल परिणाम" : "the result against us"}
        </p>
        <p
          className="mt-2 font-display leading-tight text-[var(--ink)]"
          style={{ fontSize: "calc(var(--d-support) * 1.5)" }}
        >
          {hi
            ? "ऑटो-रिक्शा के लिए कोई श्रेणी ही नहीं है।"
            : "There is no auto-rickshaw class for it to use."}
        </p>
        <p
          className="mt-2 leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {hi
            ? `इस कॉरिडोर पर मापे गए ट्रैफ़िक का 6.2% ऑटो है, पर COCO में यह श्रेणी नहीं है — कोण के अनुसार मॉडल इसे कार या दोपहिया बताता है। दोपहिया ठीक मिलते हैं: ${twoWheelerShare}% पहचान, जबकि बेड़े में लगभग 61% हैं। भारतीय डेटा (IDD) पर प्रशिक्षण का असली कारण ऑटो है, दोपहिया नहीं।`
            : `Autos are 6.2% of measured traffic on this corridor and COCO has no class for them, so the model calls them car or two-wheeler depending on the angle. Two-wheelers it handles: ${twoWheelerShare}% of detections against a fleet that is about 61% two-wheelers, with no fine-tuning. Training on Indian data is the first technical task, and autos — not two-wheelers — are why.`}
        </p>
      </section>

      <section
        className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3
            className="font-display tracking-tight text-[var(--ink)]"
            style={{ fontSize: "calc(var(--d-support) * 1.25)" }}
          >
            {hi ? "जो मिला" : "What it did find"}
          </h3>
          <p
            className="font-mono tabular-nums text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {data.vehicles_detected} {hi ? "वाहन" : "vehicles"}
          </p>
        </div>

        <ul className="mt-4 space-y-2.5">
          {classes.map(([code, pct]) => (
            <li key={code}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[var(--ink)]" style={{ fontSize: "var(--d-support)" }}>
                  {code}
                </span>
                <span
                  className="font-mono tabular-nums text-[var(--ink-muted)]"
                  style={{ fontSize: "var(--d-support)" }}
                >
                  {data.totals[code]} · {pct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div
                  className="h-1.5 rounded-full bg-[var(--accent)]"
                  style={{ width: `${Math.max(2, pct)}%` }}
                  aria-hidden
                />
              </div>
            </li>
          ))}
        </ul>

        <dl
          className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--rule)] pt-4
                     sm:grid-cols-3"
          style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
        >
          {[
            { k: hi ? "मॉडल" : "model", v: data.model.id.split("/").pop() ?? "" },
            { k: hi ? "लाइसेंस" : "licence", v: data.model.licence },
            { k: hi ? "स्रोत" : "source", v: data.source.name },
          ].map((r) => (
            <div key={r.k} className="min-w-0">
              <dt className="truncate text-[var(--ink-faint)]">{r.k}</dt>
              <dd className="truncate font-mono text-[var(--ink)]">{r.v}</dd>
            </div>
          ))}
        </dl>

        {/* A prohibition enforced silently cannot be told from one not enforced. */}
        <p
          className="mt-4 rounded-lg bg-[var(--surface-2)] p-3 leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
        >
          {hi
            ? `${data.discarded_person_detections} व्यक्ति-पहचान गिनने से पहले हटा दी गईं। व्यक्ति की पहचान वर्जित है, और यह संख्या इसीलिए दिखाई जाती है ताकि यह पता चले कि नियम लागू हुआ।`
            : `${data.discarded_person_detections} person detections discarded before anything was counted. Person detection is prohibited, and the count is shown so the prohibition is visibly enforced rather than assumed.`}
        </p>

        <p
          className="mt-3 leading-relaxed text-[var(--ink-faint)]"
          style={{ fontSize: "calc(var(--d-support) * 0.88)" }}
        >
          {data.does_not_prove}
        </p>
      </section>

      <section className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-4 sm:p-5">
        <h3
          className="font-display tracking-tight text-[var(--ink)]"
          style={{ fontSize: "calc(var(--d-support) * 1.15)" }}
        >
          {hi ? "प्रयुक्त तस्वीरें" : "Images used"}
        </h3>
        <ul className="mt-3 space-y-1.5">
          {data.images.map((img) => (
            <li key={img.title}>
              <a
                href={img.page}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5
                           transition-colors hover:bg-[var(--surface-2)]
                           focus-visible:outline focus-visible:outline-2
                           focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                <span
                  className="min-w-0 flex-1 truncate text-[var(--ink-muted)]"
                  style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
                >
                  {img.title.replace(/^File:/, "")}
                </span>
                <span
                  className="shrink-0 font-mono tabular-nums text-[var(--ink)]"
                  style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
                >
                  {img.total_vehicles}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
