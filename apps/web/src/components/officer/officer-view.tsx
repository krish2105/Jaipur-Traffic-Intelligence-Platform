"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";

import { api, congestionVar, type Advisory, type SignalAdvisory } from "@/lib/api";
import type { SceneLink } from "@/components/city/city-view";
import type { Locale } from "@/i18n/routing";
import { usePoll } from "@/lib/live";
import { useSession, can } from "@/lib/rbac";
import { ThemeToggle } from "@/components/console/theme-toggle";
import { Pulse } from "@/components/console/primitives";

/**
 * The officer PWA.
 *
 * Built for one hand, outdoors, on a phone that is probably not new. That
 * shapes it more than any visual decision:
 *
 * - **Targets are large and low.** The decision buttons sit at the bottom of
 *   each card, within thumb reach, at 48px minimum. A control-room layout
 *   shrunk to 375px is not a field tool.
 * - **One junction is one card.** An officer at a junction cares about that
 *   junction. Scrolling a table on a footpath is not reading.
 * - **Every action states its own limits.** Accepting a plan here records a
 *   decision; it does not change a signal, and the interface says so on the
 *   button's own card rather than in a help page nobody opens.
 *
 * docs/07 §6 is the rule this screen exists to satisfy: no model actuates
 * anything, and a human decision is the thing that gets recorded.
 */

type Verdict = "accepted" | "rejected" | "deferred";

const VERDICT: Record<Verdict, { en: string; hi: string; colour: string }> = {
  accepted: { en: "Accept", hi: "स्वीकार", colour: "var(--congestion-free)" },
  deferred: { en: "Defer", hi: "स्थगित", colour: "var(--congestion-moderate)" },
  rejected: { en: "Reject", hi: "अस्वीकार", colour: "var(--congestion-severe)" },
};

function AdvisoryCard({
  advisory,
  hi,
  allowed,
}: {
  advisory: Advisory;
  hi: boolean;
  allowed: boolean;
}) {
  const [pending, setPending] = useState<Verdict | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saturated = advisory.degree_of_saturation >= 0.9;

  async function submit(decision: Verdict) {
    // A rejection without a reason is refused by the API too — this check is
    // here so the officer finds out before the round trip, not instead of it.
    if (decision === "rejected" && !note.trim()) {
      setPending("rejected");
      setError(hi ? "कारण आवश्यक है" : "A reason is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.decideSignal({
        junction_id: advisory.junction_id,
        decision,
        note: note.trim(),
        cycle_s: advisory.recommended_cycle_s,
      });
      setResult(
        hi
          ? `दर्ज किया गया · #${res.audit_id} · लागू नहीं किया गया`
          : `Recorded · #${res.audit_id} · not applied`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <article
      className="rounded-2xl bg-[var(--surface-2)] p-4"
      style={{ boxShadow: "var(--rim)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg leading-tight tracking-tight">
            {hi ? advisory.name.hi : advisory.name.en}
          </h2>
          <p
            className="mt-0.5 uppercase tracking-[0.14em] text-[var(--ink-faint)]"
            style={{ fontSize: "calc(var(--d-label) * 0.9)" }}
          >
            {advisory.signal_type}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 font-mono tabular-nums"
          style={{
            fontSize: "var(--d-support)",
            background: `color-mix(in oklab, ${
              saturated ? "var(--congestion-critical)" : "var(--congestion-moderate)"
            } 20%, transparent)`,
            color: saturated ? "var(--congestion-critical)" : "var(--congestion-moderate)",
          }}
        >
          {advisory.degree_of_saturation.toFixed(2)}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <dt
            className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-label)" }}
          >
            {hi ? "सुझाया चक्र" : "Suggested cycle"}
          </dt>
          <dd className="mt-1 font-mono text-3xl tabular-nums">
            {advisory.has_measurement ? `${advisory.recommended_cycle_s}s` : "—"}
          </dd>
        </div>
        <div>
          <dt
            className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-label)" }}
          >
            {hi ? "मापी गई PCU/घं" : "Measured PCU/h"}
          </dt>
          <dd className="mt-1 font-mono text-3xl tabular-nums">
            {advisory.has_measurement
              ? Math.round(advisory.measured_pcu_per_hour).toLocaleString("en-IN")
              : "—"}
          </dd>
        </div>
      </dl>

      {saturated && (
        <p
          className="mt-3 rounded-lg px-3 py-2 leading-relaxed"
          style={{
            fontSize: "var(--d-support)",
            background: "color-mix(in oklab, var(--congestion-critical) 12%, transparent)",
            color: "var(--congestion-critical)",
          }}
        >
          {hi
            ? "यह चौराहा क्षमता पर है। कोई भी चक्र लंबाई इसे नहीं सुधारेगी — यह ज्यामिति की समस्या है, और यही कहना अधिक उपयोगी है।"
            : "This junction is at capacity. No cycle length rescues it — that is a geometry problem, and saying so is more useful than a longer green."}
        </p>
      )}

      {!advisory.has_measurement && (
        <p
          className="mt-3 leading-relaxed text-[var(--ink-faint)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {hi
            ? "इस चौराहे पर कोई मापा गया प्रवाह नहीं। बिना माप के कोई सुझाव नहीं दिया जाता।"
            : "No measured flow at this junction. Without a measurement there is no recommendation to make."}
        </p>
      )}

      {result ? (
        <p
          className="mt-4 rounded-xl px-3 py-3 text-center"
          style={{
            fontSize: "var(--d-support)",
            background: "color-mix(in oklab, var(--congestion-free) 14%, transparent)",
            color: "var(--congestion-free)",
          }}
        >
          {result}
        </p>
      ) : allowed && advisory.has_measurement ? (
        <>
          {(pending === "rejected" || note) && (
            <label className="mt-4 block">
              <span
                className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-label)" }}
              >
                {hi ? "कारण" : "Reason"}
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mt-1.5 w-full rounded-xl bg-[var(--surface-1)] px-3 py-2
                           text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
                style={{ fontSize: "var(--d-body)" }}
                placeholder={
                  hi ? "अगला अधिकारी यह पढ़ेगा" : "The next officer will read this"
                }
              />
            </label>
          )}

          {error && (
            <p
              className="mt-2 text-[var(--congestion-severe)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {error}
            </p>
          )}

          {/* Thumb-reachable, 48px, at the bottom of the card. */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(Object.keys(VERDICT) as Verdict[]).map((v) => (
              <button
                key={v}
                type="button"
                disabled={busy}
                onClick={() => void submit(v)}
                className="min-h-12 rounded-xl font-medium transition-transform
                           disabled:opacity-50 motion-safe:active:scale-[0.98]"
                style={{
                  fontSize: "var(--d-support)",
                  background: `color-mix(in oklab, ${VERDICT[v].colour} 16%, var(--surface-3))`,
                  color: VERDICT[v].colour,
                }}
              >
                {hi ? VERDICT[v].hi : VERDICT[v].en}
              </button>
            ))}
          </div>

          <p
            className="mt-2.5 text-center leading-relaxed text-[var(--ink-faint)]"
            style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
          >
            {hi
              ? "यह निर्णय दर्ज होता है, सिग्नल नहीं बदलता।"
              : "This records a decision. It does not change a signal."}
          </p>
        </>
      ) : (
        <p
          className="mt-4 leading-relaxed text-[var(--ink-faint)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {hi
            ? "इस भूमिका को सिग्नल योजना स्वीकृत करने की अनुमति नहीं है।"
            : "This role may not approve signal plans."}
        </p>
      )}
    </article>
  );
}

export function OfficerView({
  signals,
  links,
}: {
  signals: SignalAdvisory;
  links: SceneLink[];
}) {
  const locale = useLocale() as Locale;
  const hi = locale === "hi";
  const session = useSession();
  const allowed = session ? can(session.role, "approve:signals") : false;

  const { data: live, updatedAt } = usePoll(
    () =>
      fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001"}/api/v1/scene?corridor_id=1`,
        { cache: "no-store" },
      ).then((r) => r.json() as Promise<{ links: SceneLink[] }>),
    { intervalMs: 45_000 },
  );

  const current = live?.links?.length ? live.links : links;
  const measured = current.filter((l) => !l.suppressed);
  const index =
    measured.reduce((a, l) => a + l.congestion_index, 0) / (measured.length || 1);

  // Worst first. An officer opening this at a junction wants the junction that
  // needs them, not junction_id 1.
  const ordered = [...signals.advisories].sort(
    (a, b) => b.degree_of_saturation - a.degree_of_saturation,
  );

  return (
    <main className="min-h-dvh bg-[var(--ground)] text-[var(--ink)]">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--rule)] bg-[var(--surface)]/95 px-4 py-3 backdrop-blur">
        <Link href={`/${locale}`} className="flex items-baseline gap-2">
          <span className="font-display text-base leading-none tracking-tight">PRAVAAH</span>
          <span className="text-sm text-[var(--ink-muted)]" lang="hi">
            प्रवाह
          </span>
        </Link>
        <span
          className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 uppercase tracking-widest text-[var(--ink-muted)]"
          style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
        >
          {hi ? "अधिकारी" : "Officer"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/${hi ? "en" : "hi"}/officer`}
            className="rounded-lg px-2 py-1 text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {hi ? "EN" : "हि"}
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl px-4 py-5">
        {/* Corridor state, so the advisories below have a context. */}
        <section
          className="rounded-2xl p-4"
          style={{
            background: `color-mix(in oklab, ${congestionVar(index)} 12%, var(--surface-2))`,
            boxShadow: "var(--rim)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <p
              className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-label)" }}
            >
              {hi ? "टोंक रोड · अभी" : "Tonk Road · now"}
            </p>
            {updatedAt && <Pulse label={hi ? "लाइव" : "live"} />}
          </div>
          <div className="mt-2 flex items-baseline gap-4">
            <p
              className="font-mono text-5xl leading-none tabular-nums"
              style={{ color: congestionVar(index) }}
            >
              {index.toFixed(0)}
            </p>
            <p className="text-[var(--ink-muted)]" style={{ fontSize: "var(--d-support)" }}>
              {measured.length}/{current.length} {hi ? "लिंक मापे गए" : "links measured"}
            </p>
          </div>
        </section>

        {!session && (
          <p
            className="mt-4 rounded-2xl bg-[var(--surface-2)] p-4 leading-relaxed text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)", boxShadow: "var(--rim)" }}
          >
            {hi ? "निर्णय दर्ज करने के लिए " : "Sign in to record a decision — "}
            <Link href={`/${locale}/login`} className="text-[var(--accent)] underline">
              {hi ? "साइन इन करें" : "choose a role"}
            </Link>
            {hi ? "।" : "."}
          </p>
        )}

        <h1
          className="mt-6 uppercase tracking-[0.16em] text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          {hi ? "सिग्नल सलाह · सबसे भारी पहले" : "Signal advisories · heaviest first"}
        </h1>

        <div className="mt-3 grid gap-3">
          {ordered.map((a) => (
            <AdvisoryCard key={a.junction_id} advisory={a} hi={hi} allowed={allowed} />
          ))}
        </div>

        <p
          className="mt-6 leading-relaxed text-[var(--ink-faint)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {signals.governance}
        </p>
      </div>
    </main>
  );
}
