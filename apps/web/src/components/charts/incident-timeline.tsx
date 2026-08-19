"use client";

import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { IncidentHour } from "@/lib/api";
import { useMounted } from "@/lib/use-mounted";

/**
 * Crashes by hour of day, stacked by injury outcome, with the congestion curve
 * drawn over them.
 *
 * The overlay is the entire point of the chart. Congestion and crash volume
 * peak at the same two hours, which turns a traffic-management pitch into a
 * road-safety one: the evening jam is not merely slow, it is when people are
 * hurt. Two charts side by side would leave that inference to the viewer; one
 * chart makes it unavoidable.
 *
 * Bars are stacked bottom-up minor → grievous → fatal, so the darkest band sits
 * at the top of each column where the eye lands, and the fatal band's height is
 * directly comparable across hours rather than floating on a shifting base.
 */
export function IncidentTimelineChart({
  hours,
  height,
}: {
  hours: IncidentHour[];
  height?: number;
}) {
  const mounted = useMounted();

  return (
    <div style={{ height: height ?? "var(--d-chart-h)" }} className="w-full">
      {/* ResponsiveContainer measures its parent. On the server there is
          nothing to measure, so it renders an empty box that the client fills
          the instant it can — a hydration mismatch (ADR-063). The wrapper above
          keeps its height either way, so gating costs no layout shift. */}
      {mounted && (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={hours} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <XAxis
            dataKey="hour"
            tickLine={false}
            axisLine={false}
            interval={5}
            tick={{ fill: "var(--ink-muted)", fontSize: 9 }}
            tickFormatter={(h) => `${String(h).padStart(2, "0")}`}
          />
          <YAxis hide />
          <YAxis yAxisId="congestion" hide domain={[0, 100]} />
          <Bar dataKey="minor" stackId="s" fill="var(--congestion-moderate)" fillOpacity={0.45} />
          <Bar dataKey="grievous" stackId="s" fill="var(--congestion-severe)" fillOpacity={0.7} />
          <Bar dataKey="fatal" stackId="s" fill="var(--congestion-critical)" radius={[2, 2, 0, 0]} />
          <Line
            yAxisId="congestion"
            type="monotone"
            dataKey="congestion"
            stroke="var(--accent)"
            strokeWidth={1.4}
            dot={false}
            isAnimationActive={false}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-3)", fillOpacity: 0.5 }}
            contentStyle={{
              background: "var(--surface-2)",
              border: "none",
              borderRadius: 10,
              fontSize: 12,
              color: "var(--ink)",
              boxShadow: "var(--shadow-float)",
            }}
            labelFormatter={(h) => `${String(h).padStart(2, "0")}:00 IST`}
            formatter={(value, name) => [
              name === "congestion" ? `${Number(value).toFixed(0)} / 100` : Number(value).toLocaleString("en-IN"),
              String(name),
            ]}
          />
        </ComposedChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}
