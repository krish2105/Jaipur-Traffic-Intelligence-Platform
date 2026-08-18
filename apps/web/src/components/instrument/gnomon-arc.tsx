"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";

import { congestionVar, type ProfilePoint } from "@/lib/api";
import type { Locale } from "@/i18n/routing";

/**
 * The gnomon arc — docs/06 §1.
 *
 * Jai Singh II built the Samrat Yantra here in 1734 to *measure* what everyone
 * else only observed: a calibrated stone arc, brass gradations, and a shadow
 * that reads time to two seconds. This is the same instrument for the same
 * city, three centuries on.
 *
 * Hours run along the arc like the yantra's scale. Congestion is radial
 * distance. Brass marks every hour. The current moment is a brass indicator.
 * It reads instantly — "the evening bulge is bigger than the morning one" —
 * and it is unmistakably this product rather than a bar chart with a hat on.
 *
 * Hand-built on purpose. docs/06 §7 forbids generating the elements that carry
 * the design thesis, because generated components arrive with generic tokens
 * and quietly average the design back toward the template we are escaping.
 */

// A sundial's arc: midnight at the lower left, noon at the top, midnight again
// at the lower right. The eye reads the day left to right, and the evening
// bulge sits where you expect to find the evening.
const SWEEP_START = -122; // degrees; 00:00
const SWEEP_END = 122; //   degrees; 24:00
const R_INNER = 74;
const R_OUTER = 150;
const CX = 200;
const CY = 168;

/**
 * Node and the browser stringify floats to different precision, so an unrounded
 * SVG coordinate hydrates as a mismatch and React bails out of the whole
 * subtree. Rounding here makes server and client output byte-identical.
 */
const round = (n: number) => Math.round(n * 100) / 100;

const polar = (angleDeg: number, radius: number) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: round(CX + radius * Math.cos(rad)), y: round(CY + radius * Math.sin(rad)) };
};

const angleForTime = (hour: number, minute = 0) =>
  SWEEP_START + ((hour + minute / 60) / 24) * (SWEEP_END - SWEEP_START);


const radiusForIndex = (index: number) =>
  R_INNER + (Math.max(0, Math.min(100, index)) / 100) * (R_OUTER - R_INNER);

export interface GnomonArcProps {
  points: ProfilePoint[];
  peak: ProfilePoint | null;
  /** Minutes since local midnight; the brass indicator sits here. */
  nowMinutes: number;
  className?: string;
}

export function GnomonArc({ points, peak, nowMinutes, className }: GnomonArcProps) {
  const t = useTranslations("arc");
  const locale = useLocale() as Locale;
  const reduce = useReducedMotion();

  const { areaPath, curvePath } = useMemo(() => {
    if (points.length === 0) return { areaPath: "", curvePath: "" };
    const outer = points.map((p) => polar(angleForTime(p.hour, p.minute), radiusForIndex(p.index)));
    const inner = [...points]
      .reverse()
      .map((p) => polar(angleForTime(p.hour, p.minute), R_INNER));
    const line = (pts: { x: number; y: number }[]) =>
      pts.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x},${pt.y}`).join("");
    return {
      areaPath: `${line(outer)}${line(inner).replace("M", "L")}Z`,
      curvePath: line(outer),
    };
  }, [points]);

  const nowAngle = angleForTime(Math.floor(nowMinutes / 60), nowMinutes % 60);
  const nowIndex =
    points.find(
      (p) => Math.abs(p.hour * 60 + p.minute - nowMinutes) <= 8,
    )?.index ?? 0;

  // A chart is not accessible because it is pretty. docs/06 §8 requires a text
  // summary alternative on every one.
  const summary = t("summary", {
    peakIndex: peak ? Math.round(peak.index) : 0,
    peakTime: peak
      ? `${String(peak.hour).padStart(2, "0")}:${String(peak.minute).padStart(2, "0")}`
      : "—",
    nowIndex: Math.round(nowIndex),
  });

  return (
    <figure className={className}>
      <svg
        viewBox="0 0 400 250"
        role="img"
        aria-labelledby="gnomon-title gnomon-desc"
        className="w-full"
      >
        <title id="gnomon-title">{t("title")}</title>
        <desc id="gnomon-desc">{summary}</desc>

        {/* engraved gradation ring */}
        <g stroke="var(--rule)" strokeWidth="1" fill="none">
          <path
            d={describeArc(R_OUTER + 12)}
            className="opacity-70"
          />
          <path d={describeArc(R_INNER - 10)} className="opacity-50" />
        </g>

        {/* hour gradations — brass, like the yantra's scale */}
        <g>
          {Array.from({ length: 25 }, (_, hour) => {
            const major = hour % 3 === 0;
            const a = angleForTime(hour);
            const from = polar(a, R_OUTER + 12);
            const to = polar(a, R_OUTER + (major ? 22 : 17));
            return (
              <g key={hour}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="var(--accent)"
                  strokeWidth={major ? 1.6 : 0.8}
                  opacity={major ? 0.95 : 0.45}
                />
                {major && hour < 24 && (
                  <text
                    {...polar(a, R_OUTER + 32)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-ink-muted"
                    style={{ fontSize: 10, fontFamily: "var(--font-data)" }}
                  >
                    {new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", {
                      minimumIntegerDigits: 2,
                    }).format(hour)}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* the day's congestion, as radial distance */}
        <defs>
          {/* Radial, because congestion IS the radius here. The published ramp
              from docs/06 §1 maps onto distance from the centre, so the colour
              a reader sees at a given radius is the band that radius means. */}
          <radialGradient
            id="gnomon-fill"
            gradientUnits="userSpaceOnUse"
            cx={CX}
            cy={CY}
            r={R_OUTER}
          >
            <stop offset={R_INNER / R_OUTER} stopColor="var(--congestion-free)" stopOpacity="0.20" />
            <stop offset={(R_INNER + (R_OUTER - R_INNER) * 0.5) / R_OUTER}
                  stopColor="var(--congestion-moderate)" stopOpacity="0.28" />
            <stop offset={(R_INNER + (R_OUTER - R_INNER) * 0.85) / R_OUTER}
                  stopColor="var(--congestion-severe)" stopOpacity="0.36" />
            <stop offset="1" stopColor="var(--congestion-critical)" stopOpacity="0.45" />
          </radialGradient>
        </defs>
        <motion.path
          d={areaPath}
          fill="url(#gnomon-fill)"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.path
          d={curvePath}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="1.4"
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 1.1, ease: [0.16, 1, 0.3, 1] }}
        />

        {/* the gnomon's shadow: a brass indicator on the arc, at now */}
        <g>
          <line
            x1={polar(nowAngle, R_INNER - 10).x}
            y1={polar(nowAngle, R_INNER - 10).y}
            x2={polar(nowAngle, R_OUTER + 22).x}
            y2={polar(nowAngle, R_OUTER + 22).y}
            stroke="var(--accent)"
            strokeWidth="1.5"
          />
          <circle
            cx={polar(nowAngle, radiusForIndex(nowIndex)).x}
            cy={polar(nowAngle, radiusForIndex(nowIndex)).y}
            r="4.5"
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth="1.5"
          />
        </g>

        {/* the peak, called out — this is the number people quote */}
        {peak && (
          <g>
            <circle
              cx={polar(angleForTime(peak.hour, peak.minute), radiusForIndex(peak.index)).x}
              cy={polar(angleForTime(peak.hour, peak.minute), radiusForIndex(peak.index)).y}
              r="3"
              fill={congestionVar(peak.index)}
            />
          </g>
        )}

        {/* centre readout */}
        <text
          x={CX}
          y={CY + 26}
          textAnchor="middle"
          className="fill-ink"
          style={{ fontSize: 34, fontFamily: "var(--font-data)", fontVariantNumeric: "tabular-nums" }}
        >
          {Math.round(nowIndex)}
        </text>
        <text
          x={CX}
          y={CY + 44}
          textAnchor="middle"
          className="fill-ink-muted"
          style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase" }}
        >
          {t("nowLabel")}
        </text>
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

/** The calibrated arc itself, at a given radius. */
function describeArc(radius: number): string {
  const start = polar(SWEEP_START, radius);
  const end = polar(SWEEP_END, radius);
  const largeArc = SWEEP_END - SWEEP_START > 180 ? 1 : 0;
  return `M${start.x},${start.y} A${radius},${radius} 0 ${largeArc} 1 ${end.x},${end.y}`;
}
