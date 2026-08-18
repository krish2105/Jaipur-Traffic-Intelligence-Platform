"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";

import type { DayProfile, WeatherNow } from "@/lib/api";
import { congestionVar } from "@/lib/api";
import type { SceneLink } from "@/components/city/city-view";
import type { Locale } from "@/i18n/routing";
import { usePoll } from "@/lib/live";
import { DayProfileChart } from "@/components/charts/day-profile";
import { ThemeToggle } from "@/components/console/theme-toggle";
import { Pulse } from "@/components/console/primitives";

/**
 * The citizen view.
 *
 * A different product from the console, not a smaller one. A citizen is
 * standing on a footpath with one hand on a phone and has exactly one
 * question — *is it worth leaving now?* — so this page answers that at the top,
 * in one line, before anything else loads.
 *
 * Deliberately absent: no login, no personalisation, no location permission, no
 * account. docs/07's data-minimisation position is that a public information
 * surface should collect nothing, and asking a citizen for their location to
 * tell them about a corridor they already named would be collecting a
 * trajectory to answer a question that does not need one.
 *
 * The advice is derived, and it says what it is derived from. "Leave now" with
 * no reasoning is an oracle; "leave now — the corridor is at 41 and rising into
 * the evening peak" is information a person can disagree with.
 */

function jaipurNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { hour, minute, minutes: hour * 60 + minute };
}

export function CitizenView({
  links,
  profile,
  weather,
}: {
  links: SceneLink[];
  profile: DayProfile;
  weather: WeatherNow;
}) {
  const locale = useLocale() as Locale;
  const hi = locale === "hi";
  const now = jaipurNow();

  // Refreshed on the same cadence as the console, and for the same reason: a
  // page that answers "should I leave now" must not answer it with a figure
  // from twenty minutes ago.
  const { data: live, updatedAt } = usePoll(
    () =>
      fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001"}/api/v1/scene?corridor_id=1`,
        { cache: "no-store" },
      ).then((r) => r.json() as Promise<{ links: SceneLink[] }>),
    { intervalMs: 60_000 },
  );

  const current = live?.links?.length ? live.links : links;

  const { index, worst, ahead } = useMemo(() => {
    const measured = current.filter((l) => !l.suppressed);
    const mean =
      measured.reduce((a, l) => a + l.congestion_index, 0) / (measured.length || 1);
    const worstLink = [...measured].sort(
      (a, b) => b.congestion_index - a.congestion_index,
    )[0];
    // What the calibrated profile says about the next hour, so the advice is
    // about the journey rather than about this instant.
    const soon = profile.points.filter(
      (p) => p.hour * 60 + p.minute > now.minutes && p.hour * 60 + p.minute <= now.minutes + 60,
    );
    const peakAhead = soon.reduce((a, p) => Math.max(a, p.index), 0);
    return { index: mean, worst: worstLink, ahead: peakAhead };
  }, [current, profile.points, now.minutes]);

  const rising = ahead > index + 4;
  const band =
    index <= 25 ? "free" : index <= 50 ? "light" : index <= 70 ? "moderate" : index <= 85 ? "severe" : "critical";

  const headline = hi
    ? rising
      ? "अभी निकलें — आगे और भीड़ है"
      : index > 70
        ? "अभी भारी भीड़ है"
        : "रास्ता ठीक चल रहा है"
    : rising
      ? "Leave now — it gets worse from here"
      : index > 70
        ? "Heavy right now"
        : "The corridor is moving";

  return (
    <main className="min-h-dvh bg-[var(--ground)] text-[var(--ink)]">
      <header className="flex items-center gap-3 border-b border-[var(--rule)] bg-[var(--surface)] px-4 py-3">
        <Link href={`/${locale}`} className="flex items-baseline gap-2">
          <span className="font-display text-base leading-none tracking-tight">PRAVAAH</span>
          <span className="text-sm text-[var(--ink-muted)]" lang="hi">
            प्रवाह
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/${hi ? "en" : "hi"}/citizen`}
            className="rounded-lg px-2.5 py-1 text-[var(--ink-muted)] transition-colors
                       hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {hi ? "English" : "हिन्दी"}
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl px-4 py-6">
        {/* ── the answer, first ─────────────────────────────────────────── */}
        <section
          className="rounded-2xl p-5"
          style={{
            background: `color-mix(in oklab, var(--congestion-${band}) 14%, var(--surface-2))`,
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

          <h1 className="mt-3 font-display text-[clamp(1.6rem,7vw,2.25rem)] leading-tight tracking-tight">
            {headline}
          </h1>

          <div className="mt-4 flex items-end gap-5">
            <div>
              <p
                className="font-mono text-[clamp(2.5rem,12vw,3.5rem)] leading-none tabular-nums"
                style={{ color: congestionVar(index) }}
              >
                {index.toFixed(0)}
              </p>
              <p
                className="mt-1 text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {hi ? "भीड़ सूचकांक · 100 में से" : "congestion index · out of 100"}
              </p>
            </div>
            {rising && (
              <p
                className="pb-2 text-[var(--congestion-severe)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                ▲ {ahead.toFixed(0)} {hi ? "अगले घंटे में" : "within the hour"}
              </p>
            )}
          </div>

          {/* Why. An oracle that says "leave now" and explains nothing is a
              thing people stop believing the first time it is wrong. */}
          <p
            className="mt-4 leading-relaxed text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {hi
              ? `${current.length} लिंक में से ${current.filter((l) => !l.suppressed).length} मापे गए। ${
                  worst ? `सबसे धीमा: ${worst.name.hi} (${worst.congestion_index.toFixed(0)})।` : ""
                } ${rising ? "अंशांकित दैनिक प्रोफ़ाइल के अनुसार अगले घंटे में और बढ़ेगा।" : "अगले घंटे में बड़ा बदलाव अपेक्षित नहीं।"}`
              : `${current.filter((l) => !l.suppressed).length} of ${current.length} links measured. ${
                  worst ? `Slowest: ${worst.name.en} at ${worst.congestion_index.toFixed(0)}.` : ""
                } ${rising ? "The calibrated day profile says it climbs further within the hour." : "No large change expected within the hour."}`}
          </p>
        </section>

        {/* ── the day ahead ─────────────────────────────────────────────── */}
        <section
          className="mt-4 rounded-2xl bg-[var(--surface-2)] p-5"
          style={{ boxShadow: "var(--rim)" }}
        >
          <p
            className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-label)" }}
          >
            {hi ? "आज का दिन" : "Today"}
          </p>
          <div className="mt-3">
            <DayProfileChart points={profile.points} nowMinutes={now.minutes} height={140} />
          </div>
          <p
            className="mt-3 leading-relaxed text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {hi
              ? "पीतल की रेखा अभी का समय है। दो शिखर हर कार्यदिवस दिखते हैं; शाम वाला बड़ा है।"
              : "The brass line is now. Two peaks show every weekday, and the evening one is the bigger."}
          </p>
        </section>

        {/* ── worst links, so the advice is checkable ───────────────────── */}
        <section
          className="mt-4 rounded-2xl bg-[var(--surface-2)] p-5"
          style={{ boxShadow: "var(--rim)" }}
        >
          <p
            className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-label)" }}
          >
            {hi ? "सबसे धीमे खंड" : "Slowest stretches"}
          </p>
          <ul className="mt-3 grid gap-2.5">
            {[...current]
              .filter((l) => !l.suppressed)
              .sort((a, b) => b.congestion_index - a.congestion_index)
              .slice(0, 5)
              .map((l) => (
                <li key={l.link_id} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: congestionVar(l.congestion_index) }}
                  />
                  <span className="min-w-0 flex-1 truncate" style={{ fontSize: "var(--d-support)" }}>
                    {hi ? l.name.hi : l.name.en}
                  </span>
                  <span
                    className="shrink-0 font-mono tabular-nums text-[var(--ink-muted)]"
                    style={{ fontSize: "var(--d-support)" }}
                    title={
                      l.speed_source === "modelled"
                        ? hi
                          ? "भीड़ सूचकांक से निकाला गया, कैमरे से मापा नहीं"
                          : "derived from the congestion index, not seen by a camera"
                        : hi
                          ? "कैमरे से मापा गया"
                          : "measured by a camera"
                    }
                  >
                    {l.speed_kmh.toFixed(0)} km/h
                    {l.speed_source === "modelled" && (
                      <span className="ml-1 text-[var(--ink-faint)]">~</span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </section>

        {weather.available && (
          <p
            className="mt-4 px-1 leading-relaxed text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {weather.summary}
            {weather.degrades_counting
              ? hi
                ? " — मौसम के कारण कुछ खंडों की गणना दबाई गई है।"
                : " — counting on some stretches is suppressed because of the weather."
              : ""}
          </p>
        )}

        <p
          className="mt-6 px-1 leading-relaxed text-[var(--ink-faint)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {hi
            ? "यह पृष्ठ आपका स्थान नहीं माँगता, कोई खाता नहीं बनाता और आपके बारे में कुछ संग्रहीत नहीं करता। सभी आँकड़े अनुरूपित हैं और वैसा ही चिह्नित हैं।"
            : "This page asks for no location, creates no account, and stores nothing about you. All figures are simulated and badged as such."}
        </p>
      </div>
    </main>
  );
}
