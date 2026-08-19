"use client";

import type { PcuCorridor, PcuJunction } from "@/lib/api";

/**
 * Count-based signal timing against PCU-based, measured in SUMO.
 *
 * This panel exists to show a corrected claim, which is an odd thing to build
 * and the reason it is worth building. The plan asserted that PCU timing beats
 * count timing. Two experiments said otherwise, and both corrections are on
 * screen rather than in a footnote:
 *
 *   1. PCU timing never wins on mean vehicle delay, at any demand, including
 *      oversaturation. It cannot: the two-wheeler arm carries the same vehicle
 *      count at half the PCU, so giving it less green makes more vehicles wait.
 *   2. The effect does not compound along a corridor. It accumulates, which is
 *      a weaker and more accurate word.
 *
 * What survives is stronger than what was claimed. A count-based controller
 * receives identical input from two arms with very different demand and cannot
 * see that a choice exists. PCU timing surfaces the trade and puts it in front
 * of the person entitled to decide it.
 */

function Delta({ value, unit = "s" }: { value: number; unit?: string }) {
  const good = value > 0;
  return (
    <span
      className="font-mono tabular-nums"
      style={{ color: good ? "var(--accent)" : "var(--congestion-severe)" }}
    >
      {good ? "+" : ""}
      {value.toFixed(1)}
      {unit}
    </span>
  );
}

export function PcuPanel({
  junction,
  corridor,
  hi,
}: {
  junction: PcuJunction | null;
  corridor: PcuCorridor | null;
  hi: boolean;
}) {
  if (!junction?.sweep?.length) return null;
  // Read from the sweep rather than a `demand` object: the payload carries the
  // per-arm figures on each row and the ratio at top level.
  const first = junction.sweep[0];
  if (!first) return null;

  return (
    <div className="space-y-4">
      <section
        className="rounded-xl border-l-2 border-[var(--accent)] bg-[var(--surface)] p-4 sm:p-5"
        style={{ boxShadow: "var(--shadow-panel)" }}
      >
        <p
          className="uppercase tracking-[0.14em] text-[var(--accent)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          {hi ? "मुख्य निष्कर्ष" : "the finding"}
        </p>
        <p
          className="mt-2 font-display leading-tight text-[var(--ink)]"
          style={{ fontSize: "calc(var(--d-support) * 1.4)" }}
        >
          {hi
            ? "गिनती-आधारित सिग्नल को दोनों भुजाओं से एक ही संख्या मिलती है। उसे यह दिखता ही नहीं कि कोई विकल्प है।"
            : "A count-based signal receives the same number from both arms. It cannot see that a choice exists."}
        </p>
        <p
          className="mt-2 leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {hi
            ? `दोनों भुजाओं पर ${first.veh_per_hour_each_arm} वाहन/घंटा, पर PCU में ${junction.pcu_ratio}× अंतर। PCU समय औसत देरी घटाता नहीं — वह हर बस और ट्रक से लगभग 7 सेकंड हटाता है और औसत वाहन पर 1 सेकंड जोड़ता है। यह अदला-बदली है, मुफ़्त लाभ नहीं।`
            : `${first.veh_per_hour_each_arm} vehicles per hour on both arms, differing by ${junction.pcu_ratio}× in PCU. PCU timing does not reduce average delay. It takes about 7 seconds off every bus and truck and adds about 1 to the average vehicle. It is a trade, not a free gain.`}
        </p>
      </section>

      <section className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-4 sm:p-5">
        <h3
          className="font-display tracking-tight text-[var(--ink)]"
          style={{ fontSize: "calc(var(--d-support) * 1.2)" }}
        >
          {hi ? "एक चौराहा, माँग बढ़ाते हुए" : "One junction, demand swept"}
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[380px]" style={{ fontSize: "calc(var(--d-support) * 0.9)" }}>
            <thead>
              <tr className="text-[var(--ink-faint)]">
                <th className="py-1.5 text-left font-normal">{hi ? "वाहन/घं" : "veh/h"}</th>
                <th className="py-1.5 text-right font-normal">v/c</th>
                <th className="py-1.5 text-right font-normal">{hi ? "औसत" : "mean"}</th>
                <th className="py-1.5 text-right font-normal">PCU</th>
                <th className="py-1.5 text-right font-normal">{hi ? "माल" : "freight"}</th>
              </tr>
            </thead>
            <tbody>
              {junction.sweep.map((r) => (
                <tr key={r.veh_per_hour_each_arm} className="border-t border-[var(--rule)]">
                  <td className="py-1.5 font-mono tabular-nums text-[var(--ink)]">
                    {r.veh_per_hour_each_arm}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                    {r.ew_vc_under_count_plan.toFixed(2)}
                  </td>
                  <td className="py-1.5 text-right"><Delta value={r.mean_delay_saved_s} /></td>
                  <td className="py-1.5 text-right"><Delta value={r.pcu_weighted_saved_s} /></td>
                  <td className="py-1.5 text-right"><Delta value={r.freight_arm_saved_s} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p
          className="mt-3 leading-relaxed text-[var(--ink-faint)]"
          style={{ fontSize: "calc(var(--d-support) * 0.88)" }}
        >
          {hi
            ? "औसत वाहन देरी पर PCU कभी नहीं जीतता, अति-संतृप्ति पर भी नहीं। यह अंकगणित है, ट्यूनिंग की चूक नहीं।"
            : "PCU never wins on mean vehicle delay, at any demand tested including oversaturation. That is arithmetic, not a tuning failure."}
        </p>
      </section>

      {corridor?.sweep?.length ? (
        <section className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3
              className="font-display tracking-tight text-[var(--ink)]"
              style={{ fontSize: "calc(var(--d-support) * 1.2)" }}
            >
              {hi ? "कॉरिडोर, 1 से 5 चौराहे" : "Corridor, 1 to 5 junctions"}
            </h3>
            <p
              className="text-[var(--ink-faint)]"
              style={{ fontSize: "calc(var(--d-support) * 0.88)" }}
            >
              {corridor.sweep[0]?.seeds ?? 5} {hi ? "सीड प्रति बिंदु" : "seeds per point"}
            </p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[360px]" style={{ fontSize: "calc(var(--d-support) * 0.9)" }}>
              <thead>
                <tr className="text-[var(--ink-faint)]">
                  <th className="py-1.5 text-left font-normal">{hi ? "चौराहे" : "junctions"}</th>
                  <th className="py-1.5 text-right font-normal">{hi ? "धमनी बचत" : "arterial saved"}</th>
                  <th className="py-1.5 text-right font-normal">{hi ? "प्रति चौराहा" : "per junction"}</th>
                  <th className="py-1.5 text-right font-normal">{hi ? "क्रॉस लागत" : "cross cost"}</th>
                </tr>
              </thead>
              <tbody>
                {corridor.sweep.map((r, i) => (
                  <tr key={r.junctions} className="border-t border-[var(--rule)]">
                    <td className="py-1.5 font-mono tabular-nums text-[var(--ink)]">{r.junctions}</td>
                    <td className="py-1.5 text-right"><Delta value={r.arterial_delay_saved_s} /></td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                      {corridor.finding.per_junction_saving_s[i]?.toFixed(2) ?? "—"}
                    </td>
                    <td className="py-1.5 text-right"><Delta value={-r.cross_delay_cost_s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p
            className="mt-3 leading-relaxed text-[var(--ink-faint)]"
            style={{ fontSize: "calc(var(--d-support) * 0.88)" }}
          >
            {hi
              ? "कुल लाभ लंबाई के साथ बढ़ता है, पर प्रति-चौराहा नहीं। यह जुड़ता है, गुणा नहीं होता — और वाहन-सेकंड में शुद्ध प्रभाव शून्य के आसपास झूलता है। PCU समय देरी हटाता नहीं, बाँटता है।"
              : "Total benefit grows with corridor length; per-junction benefit does not. It accumulates rather than compounds, and in whole vehicle-seconds the net oscillates around zero. PCU timing redistributes delay rather than removing it."}
          </p>
        </section>
      ) : null}

      <p
        className="rounded-lg bg-[var(--surface-2)] p-3 leading-relaxed text-[var(--ink-muted)]"
        style={{ fontSize: "calc(var(--d-support) * 0.88)" }}
      >
        {junction.caveat}
        {junction.advisory_only
          ? hi
            ? " सिग्नल आउटपुट सलाहकार है; अधिकारी अनुमोदन करता है।"
            : " Signal output is advisory; an officer approves."
          : ""}
      </p>
    </div>
  );
}
