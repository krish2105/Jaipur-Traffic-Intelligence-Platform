"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ProfilePoint } from "@/lib/api";

/**
 * The corridor's 24-hour congestion profile.
 *
 * The single most useful chart for a traffic engineer: the twin-peak structure
 * is the whole shape of Jaipur's day, and the evening peak being visibly larger
 * than the morning one (94.9% against 73.9%) is the finding docs/01 §2 leads
 * with. A brass marker sits at the current moment — the gnomon idea carried into
 * the chart the engineer actually reads, rather than kept as a separate
 * ornament.
 */
export function DayProfileChart({
  points,
  nowMinutes,
  height,
}: {
  points: ProfilePoint[];
  nowMinutes: number;
  height?: number;
}) {
  const data = useMemo(
    () =>
      points.map((p) => ({
        t: p.hour + p.minute / 60,
        index: p.index,
        label: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
      })),
    [points],
  );
  const peak = useMemo(
    () => data.reduce((a, b) => (b.index > a.index ? b : a), data[0] ?? { t: 0, index: 0, label: "" }),
    [data],
  );

  return (
    <div style={{ height: height ?? "var(--d-chart-h)" }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <defs>
            {/* The published ramp, as a vertical gradient: the fill colour at a
                given height IS the band that height means. */}
            <linearGradient id="pravaah-day" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="var(--congestion-free)" stopOpacity={0.10} />
              <stop offset="50%" stopColor="var(--congestion-moderate)" stopOpacity={0.28} />
              <stop offset="85%" stopColor="var(--congestion-severe)" stopOpacity={0.42} />
              <stop offset="100%" stopColor="var(--congestion-critical)" stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" hide domain={[0, 24]} type="number" />
          <YAxis hide domain={[0, 100]} />
          <Area
            type="monotone"
            dataKey="index"
            stroke="var(--ink)"
            strokeWidth={1.4}
            fill="url(#pravaah-day)"
            isAnimationActive={false}
          />
          <ReferenceLine
            x={nowMinutes / 60}
            stroke="var(--accent)"
            strokeWidth={1.5}
            ifOverflow="extendDomain"
          />
          <ReferenceLine
            x={peak.t}
            stroke="var(--congestion-critical)"
            strokeDasharray="2 3"
            strokeWidth={1}
          />
          <Tooltip
            cursor={{ stroke: "var(--rule-strong)" }}
            contentStyle={{
              background: "var(--surface-2)",
              border: "none",
              borderRadius: 10,
              fontSize: 12,
              color: "var(--ink)",
              boxShadow: "var(--shadow-float)",
            }}
            labelFormatter={(t) => {
              const h = Math.floor(Number(t));
              const m = Math.round((Number(t) - h) * 60);
              return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} IST`;
            }}
            formatter={(value) => [`${Number(value).toFixed(0)} / 100`, "congestion"]}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
