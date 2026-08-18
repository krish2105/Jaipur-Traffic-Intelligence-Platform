"use client";

import { useCallback, useRef, useState } from "react";
import { useLocale } from "next-intl";

import type { Locale } from "@/i18n/routing";
import type { SeverityFinding } from "@/lib/api";
import { answer as runAgent, loadIndex, type AgentAnswer } from "@/lib/rag";

/**
 * Ask the specification a question.
 *
 * The whole thing runs in the browser: the index is built at compile time and
 * fetched on the first question, so there is no backend, no API key and no
 * per-query cost. That is not a shortcut around the free tier — it is what
 * makes this survive the network being down at the pitch, which docs/03 §5
 * requires of every part of the demo.
 *
 * It retrieves and cites. It does not generate. A model writing fluent prose
 * over a department's own casualty figures will eventually write a fluent wrong
 * one, and the cost of that is not measured in rupees. So the answer is the
 * passage, the citation is the document and section, and any figure comes from
 * the published payload rather than from the retrieved text.
 *
 * The plan renders before the answer, deliberately. An official who can see
 * what the system chose to look up can judge whether the answer is worth
 * reading — which is the only kind of trust that survives being wrong once.
 */

const SUGGESTED: { en: string; hi: string }[] = [
  { en: "What does DPDP require for number plates?", hi: "नंबर प्लेट के लिए DPDP क्या अनिवार्य करता है?" },
  { en: "Why is composition better than probe data?", hi: "प्रोब डेटा से संरचना बेहतर क्यों है?" },
  { en: "How many deaths per 100 crashes in Jaipur?", hi: "जयपुर में प्रति 100 दुर्घटनाओं पर कितनी मृत्यु?" },
  { en: "Which detection model and what licence?", hi: "कौन सा डिटेक्शन मॉडल और कौन सा लाइसेंस?" },
];

export function AskPanel({ severity }: { severity: SeverityFinding | null }) {
  const locale = useLocale() as Locale;
  const hi = locale === "hi";
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready">("idle");
  const [result, setResult] = useState<AgentAnswer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Figures come from the published payload, never from retrieved prose. */
  const facts = severity
    ? {
        deaths: {
          label: hi ? "मृत्यु, 2025" : "deaths, 2025",
          value: String(severity.deaths?.count ?? "—"),
          source: severity.sources?.crashes?.url ?? "",
        },
        crashes: {
          label: hi ? "दुर्घटनाएँ, 2025" : "crashes, 2025",
          value: String(severity.crashes?.count ?? "—"),
          source: severity.sources?.crashes?.url ?? "",
        },
        severity: {
          label: hi ? "प्रति 100 पर मृत्यु" : "deaths per 100 crashes",
          value: String(severity.fatality_rate_per_100 ?? "—"),
          source: severity.sources?.crashes?.url ?? "",
        },
        enforcement: {
          label: hi ? "प्रवर्तन मिश्रण" : "enforcement mix",
          value: `${severity.enforcement?.mix_pct?.over_speeding ?? "—"}% speed / ${severity.enforcement?.mix_pct?.no_helmet ?? "—"}% helmet`,
          source: severity.sources?.enforcement?.url ?? "",
        },
        helmet: {
          label: hi ? "हेलमेट-सम्बन्धी मृत्यु हिस्सा" : "helmet share of fatalities",
          value: `${severity.severity_drivers?.helmet_fatality_share_pct ?? "—"}%`,
          source: severity.sources?.helmet?.url ?? "",
        },
      }
    : {};

  const ask = useCallback(
    async (q: string) => {
      const text = q.trim();
      if (!text) return;
      setQuery(text);
      setState("loading");
      try {
        const index = await loadIndex();
        setResult(runAgent(index, text, facts));
      } catch {
        setResult({
          plan: [],
          passages: [],
          figures: [],
          refusal: hi
            ? "सूचकांक लोड नहीं हो सका।"
            : "The index could not be loaded.",
          method: "",
        });
      }
      setState("ready");
    },
    // `facts` is derived from a prop and rebuilt each render; depending on it
    // would re-create this callback constantly for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hi, severity],
  );

  return (
    <section className="border-t border-[var(--rule)] py-14 sm:py-20">
      <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        <p
          className="uppercase tracking-[0.18em] text-[var(--accent)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          {hi ? "05 · नीति · पूछिए" : "05 · NEETI · ask"}
        </p>
        <h2 className="mt-3 max-w-3xl font-display text-[clamp(1.5rem,3.4vw,2.5rem)] leading-[1.12] tracking-tight">
          {hi
            ? "विनिर्देश से पूछिए। उत्तर उद्धरण के साथ आता है, गढ़ा हुआ नहीं।"
            : "Ask the specification. The answer arrives as a citation, not as prose."}
        </h2>

        <form
          className="mt-8 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(inputRef.current?.value ?? "");
          }}
        >
          <input
            ref={inputRef}
            type="text"
            defaultValue={query}
            placeholder={hi ? "एक प्रश्न लिखिए…" : "Ask a question…"}
            aria-label={hi ? "प्रश्न" : "Question"}
            className="min-w-0 flex-1 rounded-xl border border-[var(--rule)] bg-[var(--surface)]
                       px-4 py-3 text-[var(--ink)] outline-none
                       placeholder:text-[var(--ink-faint)]
                       focus-visible:border-[var(--accent)]"
          />
          <button
            type="submit"
            className="rounded-xl bg-[var(--accent)] px-5 py-3 font-medium text-[var(--accent-ink)]
                       transition-colors hover:bg-[var(--accent-2)]"
          >
            {hi ? "पूछें" : "Ask"}
          </button>
        </form>

        <ul className="mt-3 flex flex-wrap gap-2">
          {SUGGESTED.map((s) => (
            <li key={s.en}>
              <button
                type="button"
                onClick={() => {
                  if (inputRef.current) inputRef.current.value = hi ? s.hi : s.en;
                  void ask(hi ? s.hi : s.en);
                }}
                className="rounded-full border border-[var(--rule)] px-3 py-1.5
                           text-[var(--ink-muted)] transition-colors
                           hover:border-[var(--accent)] hover:text-[var(--ink)]"
                style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
              >
                {hi ? s.hi : s.en}
              </button>
            </li>
          ))}
        </ul>

        {state === "loading" && (
          <p className="mt-6 text-[var(--ink-muted)]" style={{ fontSize: "var(--d-support)" }}>
            {hi ? "सूचकांक खोजा जा रहा है…" : "Searching the corpus…"}
          </p>
        )}

        {state === "ready" && result && (
          <div className="mt-8 space-y-5">
            {/* The plan, before the answer. */}
            {result.plan.length > 0 && (
              <ol className="space-y-1.5">
                {result.plan.map((step, i) => (
                  <li
                    key={`${step.kind}-${i}`}
                    className="flex gap-2.5 text-[var(--ink-muted)]"
                    style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
                  >
                    <span className="font-mono text-[var(--accent)]">{i + 1}</span>
                    <span>
                      {step.label}
                      <span className="ml-2 text-[var(--ink-faint)]">— {step.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {result.figures.length > 0 && (
              <div className="flex flex-wrap gap-4">
                {result.figures.map((f) => (
                  <a
                    key={f.label}
                    href={f.source || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] px-4 py-3
                               transition-colors hover:border-[var(--accent)]"
                  >
                    <p className="font-mono text-[1.4rem] tabular-nums text-[var(--ink)]">
                      {f.value}
                    </p>
                    <p
                      className="mt-0.5 text-[var(--ink-muted)]"
                      style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
                    >
                      {f.label}
                    </p>
                  </a>
                ))}
              </div>
            )}

            {result.refusal && (
              <p
                className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-4
                           leading-relaxed text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {result.refusal}
              </p>
            )}

            {result.passages.map((p, i) => (
              <figure
                key={`${p.doc}-${i}`}
                className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-4 sm:p-5"
              >
                <blockquote
                  className="leading-relaxed text-[var(--ink)]"
                  style={{ fontSize: "var(--d-support)" }}
                >
                  {p.text.length > 420 ? `${p.text.slice(0, 420)}…` : p.text}
                </blockquote>
                <figcaption
                  className="mt-3 flex flex-wrap items-baseline gap-x-3 border-t border-[var(--rule)]
                             pt-2.5 text-[var(--ink-faint)]"
                  style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
                >
                  <span className="text-[var(--accent)]">{p.doc}</span>
                  <span>{p.heading}</span>
                  <span className="ml-auto font-mono tabular-nums">
                    BM25 {p.score.toFixed(1)}
                  </span>
                </figcaption>
              </figure>
            ))}

            {result.method && (
              <p
                className="text-[var(--ink-faint)]"
                style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
              >
                {hi
                  ? "शाब्दिक पुनर्प्राप्ति, ब्राउज़र में — कोई भाषा मॉडल नहीं, कोई गढ़ा हुआ पाठ नहीं। "
                  : "Lexical retrieval, in the browser — no language model, no generated text. "}
                {result.method}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
