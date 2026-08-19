"use client";

import type { DetectionEvidence } from "@/lib/api";

/**
 * What the detector actually saw on real Jaipur streets.
 *
 * The rest of the console reports measurements. This reports a *test*, and its
 * headline result is a failure: the stock Apache-2.0 detector found zero
 * two-wheelers in a city whose fleet is about 61% two-wheelers.
 *
 * That belongs on screen, prominently, for two reasons. It is the honest state
 * of the technology, and every competitor demoing on off-the-shelf weights has
 * the same problem and will not raise it. A panel that leads with its own worst
 * result is a panel the rest of which gets believed.
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
            ? `${data.images_analysed} असली जयपुर तस्वीरों में ${data.two_wheeler_detected} दोपहिया मिले।`
            : `${data.two_wheeler_detected} two-wheelers found across ${data.images_analysed} real Jaipur photographs.`}
        </p>
        <p
          className="mt-2 leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {hi
            ? "जयपुर के 61% वाहन दोपहिया हैं। मानक मॉडल यूरोप और अमेरिका की सड़कों पर प्रशिक्षित हैं, जहाँ मोटरसाइकिल कम और साफ़ दिखती है। भारतीय ट्रैफ़िक पर प्रशिक्षण पहला तकनीकी काम है।"
            : "61% of Jaipur's fleet is two-wheelers. Stock models are trained on European and American roads, where a motorcycle is rare and clearly visible. Training on Indian traffic is the first technical task, and it is costed."}
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
