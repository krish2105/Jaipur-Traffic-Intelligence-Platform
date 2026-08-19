"use client";

import { useState } from "react";

import type { Area, AreaAccumulation, AreaScreening } from "@/lib/api";
import { congestionVar } from "@/lib/api";

/**
 * Which part of Jaipur is loaded, and by how much.
 *
 * The question a control room actually asks is not "how is link 204" but "how
 * bad is Vaishali Nagar". Everything else in the console answers the first.
 * This answers the second.
 *
 * Two things it refuses to do, both because getting them wrong is worse than
 * showing nothing:
 *
 *   - **Never paint an unmeasured area as clear.** An area with roads but no
 *     modelled link has `mean_congestion: null`. Rendering that as 0 would put
 *     it at the bottom of a ranked list in calm green, and an officer would
 *     deprioritise the part of the city nobody is watching. It renders as "not
 *     measured", in muted grey, and sorts into its own group.
 *   - **Never present a vehicle count it does not have.** Counts need
 *     instrumented links. Until cameras are connected the figure is absent
 *     rather than estimated, and the cordon column says what it would take.
 */

function Bar({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="h-1.5 w-full rounded-full bg-[var(--surface-2)]" aria-hidden>
        <div
          className="h-1.5 w-full rounded-full opacity-30"
          style={{
            background:
              "repeating-linear-gradient(90deg, var(--ink-faint) 0 3px, transparent 3px 6px)",
          }}
        />
      </div>
    );
  }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden>
      <div
        className="h-1.5 rounded-full"
        style={{ width: `${Math.max(2, value)}%`, background: congestionVar(value) }}
      />
    </div>
  );
}

function Row({
  area,
  cameras,
  selected,
  onSelect,
  hi,
}: {
  area: Area;
  cameras: number | null;
  selected: boolean;
  onSelect: () => void;
  hi: boolean;
}) {
  const measured = area.mean_congestion !== null;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors
                    focus-visible:outline focus-visible:outline-2
                    focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]
                    ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--surface-2)]"
                        : "border-[var(--rule)] hover:bg-[var(--surface-2)]"
                    }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span
            className="min-w-0 flex-1 truncate text-[var(--ink)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {area.name}
          </span>
          <span
            className="shrink-0 font-mono tabular-nums"
            style={{
              fontSize: "var(--d-support)",
              color: measured ? "var(--ink)" : "var(--ink-faint)",
            }}
          >
            {measured
              ? area.mean_congestion?.toFixed(1)
              : hi
                ? "मापा नहीं"
                : "not measured"}
          </span>
        </div>
        <div className="mt-2">
          <Bar value={area.mean_congestion} />
        </div>
        <div
          className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-[var(--ink-faint)]"
          style={{ fontSize: "calc(var(--d-support) * 0.88)" }}
        >
          <span className="font-mono tabular-nums">
            {area.links} {hi ? "लिंक" : "links"}
          </span>
          {cameras !== null && (
            <span className="font-mono tabular-nums text-[var(--accent)]">
              {cameras} {hi ? "कैमरे" : "cameras"}
            </span>
          )}
          {area.worst_link?.name && (
            <span className="min-w-0 truncate">
              {hi ? "सबसे खराब" : "worst"}: {area.worst_link.name}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

/**
 * Vehicles inside the area, hour by hour, from cordon counts.
 *
 * The curve is the answer to the question the whole area layer exists for. It
 * is drawn from a baseline rather than from zero because an area is never
 * empty: the floor of the curve IS the resident population, and hiding that
 * would make the peak look like it appeared from nowhere.
 */
function InsideCurve({ hourly, peakHour }: { hourly: number[]; peakHour: number }) {
  const max = Math.max(...hourly, 1);
  const min = Math.min(...hourly);
  const span = max - min || 1;
  const points = hourly
    .map((v, h) => `${(h / 23) * 100},${28 - ((v - min) / span) * 26}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-16 w-full" role="img"
         aria-label="Vehicles inside the area by hour of day">
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={(peakHour / 23) * 100} x2={(peakHour / 23) * 100} y1="0" y2="30"
        stroke="var(--accent)" strokeWidth="0.6" strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke" opacity="0.6"
      />
    </svg>
  );
}

export function AreaScreeningPanel({
  data,
  accumulation,
  hi,
}: {
  data: AreaScreening | null;
  accumulation: AreaAccumulation | null;
  hi: boolean;
}) {
  const [level, setLevel] = useState<"zones" | "thanas">("thanas");
  const [selected, setSelected] = useState<string | null>(null);

  if (!data?.thanas?.length) return null;

  const cameras = new Map(data.cordon_plan.map((c) => [c.area, c.cameras_needed]));
  const areas = level === "zones" ? data.zones : data.thanas;
  // Measured first, then the unmeasured as their own group, so an area nobody
  // is watching never sits quietly at the bottom looking calm.
  const measured = areas.filter((a) => a.mean_congestion !== null);
  const unmeasured = areas.filter((a) => a.mean_congestion === null);
  const active = areas.find((a) => a.name === selected) ?? null;
  const acc = active
    ? (accumulation?.areas.find((a) => a.area === active.name) ?? null)
    : null;

  return (
    <section
      className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-4 sm:p-5"
      aria-labelledby="areas-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id="areas-heading"
          className="font-display tracking-tight text-[var(--ink)]"
          style={{ fontSize: "calc(var(--d-support) * 1.25)" }}
        >
          {hi ? "क्षेत्र स्क्रीनिंग" : "Area screening"}
        </h3>
        <div className="flex gap-1" role="group" aria-label={hi ? "स्तर" : "Level"}>
          {(["thanas", "zones"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                setLevel(l);
                setSelected(null);
              }}
              aria-pressed={level === l}
              className={`rounded-md px-2.5 py-1 transition-colors
                          focus-visible:outline focus-visible:outline-2
                          focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]
                          ${
                            level === l
                              ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                              : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)]"
                          }`}
              style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
            >
              {l === "thanas"
                ? hi ? "थाना" : "Thana"
                : hi ? "ज़ोन" : "Zone"}
            </button>
          ))}
        </div>
      </div>

      <p
        className="mt-1 text-[var(--ink-muted)]"
        style={{ fontSize: "calc(var(--d-support) * 0.92)" }}
      >
        {hi
          ? `${data.stations_total} थानों के आसपास, ${data.links_total} सड़कों पर। सीमा अनुमानित है, अधिसूचित नहीं।`
          : `${data.stations_total} stations across ${data.links_total.toLocaleString("en-IN")} roads. Boundaries are approximate, not gazetted.`}
      </p>

      <ul className="mt-4 space-y-1.5">
        {measured.map((a) => (
          <Row
            key={a.name}
            area={a}
            hi={hi}
            cameras={cameras.get(a.name) ?? null}
            selected={selected === a.name}
            onSelect={() => setSelected(selected === a.name ? null : a.name)}
          />
        ))}
      </ul>

      {unmeasured.length > 0 && (
        <>
          <p
            className="mt-4 border-t border-[var(--rule)] pt-3 text-[var(--ink-faint)]"
            style={{ fontSize: "calc(var(--d-support) * 0.88)" }}
          >
            {hi
              ? `${unmeasured.length} क्षेत्रों में सड़कें हैं पर कोई माप नहीं। ये खाली नहीं हैं — इन पर नज़र नहीं है।`
              : `${unmeasured.length} areas have roads but no measurement. These are not clear, they are unwatched.`}
          </p>
          <ul className="mt-2 space-y-1.5">
            {unmeasured.map((a) => (
              <Row
                key={a.name}
                area={a}
                hi={hi}
                cameras={cameras.get(a.name) ?? null}
                selected={selected === a.name}
                onSelect={() => setSelected(selected === a.name ? null : a.name)}
              />
            ))}
          </ul>
        </>
      )}

      {active && (
        <div className="mt-4 rounded-lg border border-[var(--accent)] bg-[var(--surface-2)] p-3">
          <p className="text-[var(--ink)]" style={{ fontSize: "var(--d-support)" }}>
            {active.name}
          </p>
          <dl
            className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3"
            style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
          >
            {[
              {
                k: hi ? "औसत भीड़" : "mean congestion",
                v:
                  active.mean_congestion === null
                    ? hi ? "मापा नहीं" : "not measured"
                    : active.mean_congestion.toFixed(1),
              },
              {
                k: hi ? "वाहन/घंटा" : "vehicles/hour",
                v: data.vehicle_counts_available
                  ? active.vehicles_per_hour.toLocaleString("en-IN")
                  : hi ? "कैमरा नहीं" : "needs cameras",
              },
              {
                k: hi ? "कॉर्डन कैमरे" : "cordon cameras",
                v: String(cameras.get(active.name) ?? "—"),
              },
              { k: hi ? "सड़कें" : "roads", v: String(active.links) },
              {
                k: hi ? "मॉडल किए" : "modelled",
                v: `${active.links_modelled} (${Math.round(active.coverage * 100)}%)`,
              },
              {
                k: hi ? "सबसे खराब" : "worst link",
                v: active.worst_link?.name ?? "—",
              },
            ].map((row) => (
              <div key={row.k} className="min-w-0">
                <dt className="truncate text-[var(--ink-faint)]">{row.k}</dt>
                <dd className="truncate font-mono tabular-nums text-[var(--ink)]">{row.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {active && acc && (
        <div className="mt-3 rounded-lg border border-[var(--rule)] bg-[var(--surface-2)] p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[var(--ink)]" style={{ fontSize: "var(--d-support)" }}>
              {hi ? "अंदर वाहन, घंटे दर घंटे" : "Vehicles inside, by hour"}
            </p>
            <p
              className="font-mono tabular-nums text-[var(--accent)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {acc.peak_inside.toLocaleString("en-IN")} @ {acc.peak_hour}:00
            </p>
          </div>
          <InsideCurve hourly={acc.hourly} peakHour={acc.peak_hour} />
          <p
            className="text-[var(--ink-faint)]"
            style={{ fontSize: "calc(var(--d-support) * 0.85)" }}
          >
            {hi
              ? `आधार ${acc.resident_baseline.toLocaleString("en-IN")} — क्षेत्र कभी खाली नहीं होता।`
              : `Floor is the resident baseline of ${acc.resident_baseline.toLocaleString("en-IN")}. An area is never empty.`}
          </p>

          {/* The specification nobody asks for: how accurate the detectors must
              be before the integrated count stops supporting a decision. */}
          <table className="mt-3 w-full" style={{ fontSize: "calc(var(--d-support) * 0.85)" }}>
            <caption className="pb-1 text-left text-[var(--ink-muted)]">
              {hi
                ? "गिनती में त्रुटि — कितनी देर बाद दोबारा मापना पड़ेगा"
                : "Detector error, and how often the count must be re-anchored"}
            </caption>
            <tbody>
              {Object.entries(acc.drift).map(([rate, d]) => (
                <tr key={rate} className="border-t border-[var(--rule)]">
                  <td className="py-1 font-mono tabular-nums text-[var(--ink-muted)]">
                    {rate.replace("pct", "%")}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums text-[var(--ink)]">
                    {d.reanchor_every_hours ? `${d.reanchor_every_hours} h` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p
        className="mt-4 border-t border-[var(--rule)] pt-3 leading-relaxed text-[var(--ink-faint)]"
        style={{ fontSize: "calc(var(--d-support) * 0.88)" }}
      >
        {hi
          ? "किसी क्षेत्र के अंदर कितने वाहन हैं, यह उसकी सीमा पर गिनकर निकलता है, हर सड़क पर नहीं। ऊपर 'कॉर्डन कैमरे' वही संख्या है।"
          : "How many vehicles are inside an area is counted at its boundary, not on every road within it. The cordon figure above is that number."}
      </p>
    </section>
  );
}
