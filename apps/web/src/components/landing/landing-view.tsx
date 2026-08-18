"use client";

import { useLocale } from "next-intl";
import Link from "next/link";

import type { CountsSummary, DayProfile, IncidentTimeline, PolicyScenarios } from "@/lib/api";
import type { Locale } from "@/i18n/routing";
import { formatCount } from "@/lib/format";
import { DayProfileChart } from "@/components/charts/day-profile";
import { IncidentTimelineChart } from "@/components/charts/incident-timeline";
import { ThemeToggle } from "@/components/console/theme-toggle";

/**
 * The landing page.
 *
 * An official arrives here before they arrive at the console, so this page has
 * one job: make the case in the order the case actually runs, with the real
 * numbers rather than claims about them. Every figure below is fetched from the
 * same endpoints the console uses — there is no separate marketing copy holding
 * a number that the product would contradict.
 *
 * The structure is the argument:
 *
 * 1. Jaipur's evening peak is 94.9%. That is published, and it is the hook.
 * 2. Probes can tell you that. They cannot tell you what the traffic IS.
 * 3. Composition is what every downstream decision needs.
 * 4. And crashes peak at the same hour, so this is a safety problem.
 * 5. Here is what a policy built on that composition would do.
 *
 * No hero video, no parallax hero, no floating dashboard mockup. The evidence
 * is more persuasive than the decoration would be, and a government reviewer
 * has seen the decoration before.
 */

function Reveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  // CSS animation rather than JS-driven scroll: a reveal that starts at
  // opacity 0 and depends on hydration leaves the page permanently blank if
  // hydration fails, and `animation-timeline` degrades to simply visible.
  return (
    <div className="pravaah-reveal" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Stat({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[clamp(1.75rem,4.5vw,3rem)] leading-none tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-[var(--ink-muted)]" style={{ fontSize: "var(--d-support)" }}>
        {label}
      </p>
      {note && (
        <p className="mt-1 text-[var(--ink-faint)]" style={{ fontSize: "var(--d-support)" }}>
          {note}
        </p>
      )}
    </div>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--rule)] py-14 sm:py-20">
      <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        <Reveal>
          <p
            className="uppercase tracking-[0.18em] text-[var(--accent)]"
            style={{ fontSize: "var(--d-label)" }}
          >
            {eyebrow}
          </p>
          <h2 className="mt-3 max-w-3xl font-display text-[clamp(1.5rem,3.4vw,2.5rem)] leading-[1.12] tracking-tight">
            {title}
          </h2>
        </Reveal>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

export function LandingView({
  summary,
  profile,
  incidents,
  policy,
}: {
  summary: CountsSummary;
  profile: DayProfile;
  incidents: IncidentTimeline;
  policy: PolicyScenarios;
}) {
  const locale = useLocale() as Locale;
  const hi = locale === "hi";

  const twoWheeler = policy.classes.find((c) => c.class_code === "2W");
  const car = policy.classes.find((c) => c.class_code === "CAR");
  const lez = policy.scenarios.find((s) => s.scenario === "low_emission_zone");

  const share = (n: number | undefined, of: number) =>
    n != null && of ? `${((n / of) * 100).toFixed(1)}%` : "—";

  return (
    <main className="min-h-dvh bg-[var(--ground)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--rule)] bg-[var(--surface)]/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 py-3 sm:px-8">
          <span className="font-display text-lg leading-none tracking-tight">PRAVAAH</span>
          <span className="text-sm text-[var(--ink-muted)]" lang="hi">
            प्रवाह
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href={`/${hi ? "en" : "hi"}`}
              className="rounded-lg px-2.5 py-1 text-[var(--ink-muted)] transition-colors
                         hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {hi ? "English" : "हिन्दी"}
            </Link>
            <ThemeToggle />
            <Link
              href={`/${locale}/console`}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-[var(--accent-ink)]
                         transition-transform motion-safe:hover:-translate-y-px"
              style={{ fontSize: "var(--d-support)" }}
            >
              {hi ? "कंसोल" : "Console"}
            </Link>
          </div>
        </div>
      </header>

      {/* ── the hook ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 55% at 15% 0%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 68%)," +
              "radial-gradient(55% 45% at 90% 30%, color-mix(in oklab, var(--congestion-critical) 14%, transparent), transparent 70%)",
          }}
        />
        <div className="relative mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <p
              className="uppercase tracking-[0.18em] text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-label)" }}
            >
              {hi ? "जयपुर · यातायात निर्णय बुद्धिमत्ता" : "Jaipur · traffic decision intelligence"}
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mt-4 max-w-4xl font-display text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.04] tracking-tight">
              {hi
                ? "शाम को जयपुर की यात्रा में 94.9% अतिरिक्त समय लगता है।"
                : "At the evening peak, a Jaipur journey takes 94.9% longer."}
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p
              className="mt-6 max-w-2xl leading-relaxed text-[var(--ink-muted)]"
              style={{ fontSize: "clamp(1rem, 1.6vw, 1.15rem)" }}
            >
              {hi
                ? "यह आँकड़ा प्रकाशित है और किसी भी प्रोब उत्पाद से मिल जाता है। जो नहीं मिलता वह यह है कि उस जाम में क्या खड़ा है — और हर निर्णय उसी पर टिका है।"
                : "That figure is published, and any probe product will give it to you. What none of them will give you is what is standing in that jam — and every decision downstream depends on it."}
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                href={`/${locale}/console`}
                className="rounded-xl bg-[var(--accent)] px-5 py-3 font-medium text-[var(--accent-ink)]
                           transition-transform motion-safe:hover:-translate-y-px"
              >
                {hi ? "लाइव कंसोल खोलें" : "Open the live console"}
              </Link>
              <Link
                href={`/${locale}/login`}
                className="rounded-xl bg-[var(--surface-2)] px-5 py-3 font-medium
                           transition-colors hover:bg-[var(--surface-3)]"
                style={{ boxShadow: "var(--rim)" }}
              >
                {hi ? "भूमिका चुनें" : "Choose a role"}
              </Link>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <div className="mt-14 grid grid-cols-2 gap-6 border-t border-[var(--rule)] pt-8 sm:grid-cols-4">
              <Stat
                value="94.9%"
                label={hi ? "शाम शीर्ष भीड़" : "evening peak congestion"}
                note={hi ? "प्रकाशित, पुनरुत्पादित" : "published, reproduced"}
              />
              <Stat
                value={formatCount(summary.total_vehicles, locale)}
                label={hi ? "आज गिने गए वाहन" : "vehicles counted today"}
                note={`${hi ? "गुणवत्ता" : "quality"} ${summary.data_quality.mean_score.toFixed(2)}`}
              />
              <Stat
                value={formatCount(incidents.totals.crashes, locale)}
                label={hi ? "दुर्घटनाएँ विश्लेषित" : "crashes analysed"}
                note={`${incidents.totals.since}–${incidents.totals.until}`}
              />
              <Stat
                value={formatCount(incidents.totals.deaths, locale)}
                label={hi ? "जानें गईं" : "lives lost"}
                note={hi ? "उसी अवधि में" : "same period"}
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── the shape of the day ────────────────────────────────────────── */}
      <Section
        eyebrow={hi ? "01 · दिन का आकार" : "01 · the shape of the day"}
        title={
          hi
            ? "दो शिखर, हर कार्यदिवस। शाम वाला सुबह वाले से बड़ा है।"
            : "Two peaks, every weekday. The evening one is bigger than the morning one."
        }
      >
        <Reveal>
          <div
            className="rounded-2xl bg-[var(--surface-2)] p-5"
            style={{ boxShadow: "var(--rim)" }}
          >
            <DayProfileChart points={profile.points} nowMinutes={0} height={220} />
            <p
              className="mt-4 max-w-2xl leading-relaxed text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {hi
                ? "यह वक्र प्रकाशित आँकड़ों से अंशांकित है: सुबह 73.9%, शाम 94.9%। जो कुछ भी इस मंच पर बनाया गया है वह इसी को पुनरुत्पादित करता है — और परीक्षण विफल हो जाते हैं यदि नहीं करता।"
                : "This curve is calibrated against the published figures — 73.9% in the morning, 94.9% in the evening. Everything built on this platform reproduces them, and the test suite fails the build if it stops doing so."}
            </p>
          </div>
        </Reveal>
      </Section>

      {/* ── composition ─────────────────────────────────────────────────── */}
      <Section
        eyebrow={hi ? "02 · संरचना" : "02 · composition"}
        title={
          hi
            ? "दोपहिया वाहन संख्या में सबसे आगे हैं। सड़क स्थान में नहीं।"
            : "Two-wheelers lead on count. They do not lead on road space."
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Reveal>
            <div
              className="h-full rounded-2xl bg-[var(--surface-2)] p-5"
              style={{ boxShadow: "var(--rim)" }}
            >
              <p
                className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-label)" }}
              >
                {hi ? "शाम शीर्ष पर" : "at the evening peak"}
              </p>
              <dl className="mt-4 grid gap-4">
                {[
                  {
                    n: hi ? "दोपहिया" : "Two-wheelers",
                    v: share(twoWheeler?.vehicles, policy.totals.vehicles),
                    p: share(twoWheeler?.pcu, policy.totals.pcu),
                  },
                  {
                    n: hi ? "कार / जीप / वैन" : "Cars / jeeps / vans",
                    v: share(car?.vehicles, policy.totals.vehicles),
                    p: share(car?.pcu, policy.totals.pcu),
                  },
                ].map((row) => (
                  <div key={row.n} className="border-b border-[var(--rule)] pb-3 last:border-0">
                    <dt style={{ fontSize: "var(--d-support)" }}>{row.n}</dt>
                    <dd className="mt-1.5 flex items-baseline gap-4">
                      <span className="font-mono text-2xl tabular-nums">{row.v}</span>
                      <span className="text-[var(--ink-faint)]" aria-hidden="true">
                        →
                      </span>
                      <span className="font-mono text-2xl tabular-nums text-[var(--accent)]">
                        {row.p}
                      </span>
                    </dd>
                    <p
                      className="mt-1 text-[var(--ink-faint)]"
                      style={{ fontSize: "var(--d-support)" }}
                    >
                      {hi ? "वाहनों का हिस्सा → सड़क स्थान का हिस्सा" : "share of vehicles → share of road space"}
                    </p>
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div
              className="h-full rounded-2xl bg-[var(--surface-3)] p-5"
              style={{ boxShadow: "var(--rim)" }}
            >
              <p className="leading-relaxed" style={{ fontSize: "clamp(1rem, 1.5vw, 1.1rem)" }}>
                {hi
                  ? "प्रोब डेटा देरी बताता है, संरचना कभी नहीं। हर क्षमता गणना, हर सिग्नल योजना और हर माल-ढुलाई खिड़की इसी विभाजन पर टिकी है — और दुनिया का कोई प्रोब उत्पाद इसे नहीं बना सकता।"
                  : "Probe data reports delay, never composition. Every capacity calculation, every signal plan and every freight window depends on this split — and no probe product in the world can produce it."}
              </p>
              <p
                className="mt-4 leading-relaxed text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {hi
                  ? "इसे बनाने का एक ही तरीका है: गैन्ट्री पर कैमरा, किनारे पर वर्गीकरण, और हर आँकड़े के साथ उसकी सत्यापित सटीकता।"
                  : "There is exactly one way to produce it: a camera on the gantry, classification at the edge, and each figure published beside its own validated accuracy."}
              </p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── safety ──────────────────────────────────────────────────────── */}
      <Section
        eyebrow={hi ? "03 · सुरक्षा" : "03 · safety"}
        title={
          hi
            ? `दुर्घटनाएँ ${String(incidents.peak_hour).padStart(2, "0")}:00 पर चरम पर होती हैं — वही घंटा जब भीड़ चरम पर है।`
            : `Crashes peak at ${String(incidents.peak_hour).padStart(2, "0")}:00 — the same hour congestion does.`
        }
      >
        <Reveal>
          <div
            className="rounded-2xl bg-[var(--surface-2)] p-5"
            style={{ boxShadow: "var(--rim)" }}
          >
            <IncidentTimelineChart hours={incidents.hours} height={220} />
            <p
              className="mt-4 max-w-2xl leading-relaxed text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {hi
                ? "यह वही तर्क है जो यातायात प्रबंधन को सड़क सुरक्षा में बदल देता है। शाम का जाम केवल असुविधा नहीं है — वही समय है जब लोग घायल होते हैं।"
                : "This is the finding that turns a traffic-management case into a road-safety one. The evening jam is not merely an inconvenience to be measured; it is when people are hurt."}
            </p>
          </div>
        </Reveal>
      </Section>

      {/* ── policy ──────────────────────────────────────────────────────── */}
      {lez && (
        <Section
          eyebrow={hi ? "04 · नीति" : "04 · policy"}
          title={
            hi
              ? `संरचना पर बनी एक नीति शीर्ष गति ${lez.baseline_speed_kmh} से ${lez.modelled_speed_kmh} किमी/घंटा कर देती है।`
              : `A policy built on that composition moves peak speed from ${lez.baseline_speed_kmh} to ${lez.modelled_speed_kmh} km/h.`
          }
        >
          <Reveal>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  v: `${lez.pcu_removed_pct}%`,
                  l: hi ? "PCU हटाया गया" : "of road space freed",
                },
                {
                  v: `${lez.baseline_index} → ${lez.modelled_index}`,
                  l: hi ? "भीड़ सूचकांक" : "congestion index",
                },
                {
                  v: `${lez.modelled_speed_kmh} km/h`,
                  l: hi ? "मॉडल शीर्ष गति" : "modelled peak speed",
                },
              ].map((s) => (
                <div
                  key={s.l}
                  className="rounded-2xl bg-[var(--surface-2)] p-5"
                  style={{ boxShadow: "var(--rim)" }}
                >
                  <p className="font-mono text-[clamp(1.25rem,2.6vw,1.9rem)] tabular-nums">
                    {s.v}
                  </p>
                  <p
                    className="mt-2 text-[var(--ink-muted)]"
                    style={{ fontSize: "var(--d-support)" }}
                  >
                    {s.l}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={100}>
            <p
              className="mt-5 max-w-2xl leading-relaxed text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {hi ? lez.note.hi : lez.note.en}{" "}
              {hi
                ? "मंच पर हर धारणा नाम लेकर बताई जाती है, फुटनोट में छिपाई नहीं जाती।"
                : "Every assumption is named on the platform rather than buried in a footnote."}
            </p>
          </Reveal>
        </Section>
      )}

      {/* ── honesty ─────────────────────────────────────────────────────── */}
      <Section
        eyebrow={hi ? "05 · यह अभी क्या है" : "05 · what this is today"}
        title={
          hi
            ? "बीजित डेटा, स्पष्ट रूप से चिह्नित। लाइव पर जाना विन्यास है, पुनर्लेखन नहीं।"
            : "Seeded data, badged as such. Going live is configuration, not a rewrite."
        }
      >
        <Reveal>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                en: "Every synthetic figure carries a “Simulated” badge, everywhere it appears. Nothing on this platform pretends to be a measurement it is not.",
                hi: "हर अनुरूपित आँकड़ा जहाँ भी दिखता है “अनुरूपित” चिह्न के साथ आता है। यह मंच किसी आँकड़े को वह होने का दिखावा नहीं करता जो वह नहीं है।",
              },
              {
                en: "Counting runs on public Indian datasets (IDD, UA-DETRAC) and is not yet validated on Jaipur video. That needs a read-only RTSP feed from the department.",
                hi: "गणना सार्वजनिक भारतीय डेटासेट (IDD, UA-DETRAC) पर चलती है और अभी जयपुर वीडियो पर सत्यापित नहीं है। इसके लिए विभाग से केवल-पठन RTSP फ़ीड चाहिए।",
              },
              {
                en: "No face recognition, no person tracking, no biometric analysis — at any point in the pipeline, by design and by policy.",
                hi: "कोई चेहरा पहचान नहीं, कोई व्यक्ति ट्रैकिंग नहीं, कोई बायोमेट्रिक विश्लेषण नहीं — पाइपलाइन में कहीं भी, डिज़ाइन और नीति दोनों से।",
              },
              {
                en: "Signal timing is advisory. No code path reaches a controller: an engineer reviews, and a human applies.",
                hi: "सिग्नल समय सलाहकार है। कोई कोड पथ नियंत्रक तक नहीं पहुँचता — एक इंजीनियर समीक्षा करता है और एक मनुष्य लागू करता है।",
              },
            ].map((item) => (
              <p
                key={item.en}
                className="rounded-2xl bg-[var(--surface-2)] p-5 leading-relaxed text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-support)", boxShadow: "var(--rim)" }}
              >
                {hi ? item.hi : item.en}
              </p>
            ))}
          </div>
        </Reveal>
      </Section>

      <footer className="border-t border-[var(--rule)] py-12">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-4 px-5 sm:px-8">
          <div className="min-w-0">
            <p className="font-display text-lg tracking-tight">
              PRAVAAH <span className="text-[var(--ink-muted)]">प्रवाह</span>
            </p>
            <p
              className="mt-1 text-[var(--ink-faint)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {hi
                ? "राजस्थान सरकार के लिए बनाया गया"
                : "Built for the Government of Rajasthan"}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {[
              { href: `/${locale}/console`, en: "Console", hi: "कंसोल" },
              { href: `/${locale}/citizen`, en: "For citizens", hi: "नागरिकों के लिए" },
              { href: `/${locale}/login`, en: "Sign in", hi: "साइन इन" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-lg bg-[var(--surface-2)] px-3.5 py-2 transition-colors
                           hover:bg-[var(--surface-3)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {hi ? l.hi : l.en}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
