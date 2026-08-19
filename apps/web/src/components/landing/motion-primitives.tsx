"use client";

import { useEffect, useRef } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";

import { formatCount } from "@/lib/format";
import type { Locale } from "@/i18n/routing";

/**
 * The landing page's motion layer.
 *
 * These exist only above the fold and at section boundaries. docs/06 §4 allows
 * transform and opacity and nothing else, and the reason is not performance
 * alone: an official reading a casualty figure should not have it move under
 * them. So body copy never animates here, only headings and the numbers that
 * are already the point of the section they sit in.
 *
 * Every one of these degrades to its static self under `prefers-reduced-motion`
 * — not a shortened animation, the actual final state on first paint.
 */

/**
 * A headline that rises word by word from behind its own baseline.
 *
 * Split by word rather than by character. Devanagari is a joining script: its
 * matras and conjuncts belong to the syllable, and slicing per character
 * detaches them, so the Hindi headline would animate into nonsense. Word-level
 * keeps every cluster intact in both scripts.
 *
 * The full string stays on `aria-label` and the animated pieces are hidden, so
 * a screen reader hears one sentence rather than a stack of fragments.
 */
export function SplitText({
  text,
  className,
  delay = 0,
}: {
  text: string;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={className}>{text}</span>;

  return (
    <span className={className} aria-label={text}>
      {text.split(" ").map((word, i) => (
        // `pb-[0.12em]` keeps descenders and Devanagari matras from being
        // sheared off by the overflow clip that makes the rise read.
        <span key={`${word}-${i}`} className="inline-block overflow-hidden pb-[0.12em] align-bottom">
          <motion.span
            aria-hidden
            className="inline-block"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1], delay: delay + i * 0.055 }}
          >
            {word}&nbsp;
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/**
 * A number that counts up once, when it is first seen.
 *
 * Locale-formatted on every frame rather than at the end, so the Hindi lakh
 * grouping is correct the whole way up instead of snapping into place on the
 * final frame.
 */
export function Counter({
  to,
  locale,
  className,
}: {
  to: number;
  locale: Locale;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const reduce = useReducedMotion();
  // Starts at the answer, not at zero.
  //
  // It started at zero and counted up when the observer fired, which meant that
  // whenever the observer did not fire the figure stayed at zero forever. That
  // shipped: the landing page's headline read "0 vehicles counted today" beside
  // an endpoint returning 416,514, and "0" on a page arguing that this platform
  // measures traffic is about the worst number it could have chosen.
  //
  // Now the true value renders immediately and the animation drops to zero only
  // once it is actually about to run. If it never runs, the number is simply
  // correct, which is the only acceptable failure mode for a figure.
  const count = useMotionValue(to);
  const text = useTransform(count, (v) => formatCount(Math.round(v), locale));

  useEffect(() => {
    if (!inView || reduce) return;
    count.set(0);
    const controls = animate(count, to, { duration: 1.5, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [inView, to, count, reduce]);

  return (
    <span ref={ref} className={className}>
      <motion.span>{text}</motion.span>
    </span>
  );
}

/**
 * A control that leans toward the cursor.
 *
 * Pointer-only by construction: the transform is driven from `mousemove`, so a
 * touch device never triggers it and a keyboard user gets an ordinary focusable
 * link. Kept to the primary call to action — a page where everything dodges the
 * cursor is a page nobody can click.
 */
export function Magnetic({
  children,
  className,
  strength = 0.3,
}: {
  children: React.ReactNode;
  className?: string;
  strength?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.4 });

  if (reduce) return <span className={className}>{children}</span>;

  return (
    <motion.span
      ref={ref}
      className={className}
      style={{ x: sx, y: sy, display: "inline-block" }}
      onMouseMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}
