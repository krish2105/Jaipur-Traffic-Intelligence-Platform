"use client";

import { useCallback, useRef, useState } from "react";

import { answer as runAgent, loadIndex, type AgentAnswer } from "@/lib/rag";

/**
 * Search the specification, from inside the console.
 *
 * NEETI already answers the questions someone thought to put in a catalogue.
 * This answers the ones they did not: what DPDP requires of a number plate,
 * which detector and under what licence, why composition beats probe data. An
 * official checking whether this platform can be defended in a review is asking
 * that second kind, and until now they had to leave the console to do it.
 *
 * Runs entirely in the browser over an index built at compile time, so it works
 * with the network down and costs nothing per query.
 *
 * It retrieves and cites. It does not generate. A model writing fluent prose
 * over a department's own casualty figures will eventually write a fluent wrong
 * one, and there is no budget for that in rupees or in credibility.
 */

const SUGGESTED = [
  { en: "What does DPDP require for number plates?", hi: "नंबर प्लेट के लिए DPDP क्या माँगता है?" },
  { en: "Which detection model and what licence?", hi: "कौन सा डिटेक्शन मॉडल, कौन सा लाइसेंस?" },
  { en: "Why is composition better than probe data?", hi: "प्रोब डेटा से संरचना बेहतर क्यों?" },
  { en: "What is the congestion ramp?", hi: "भीड़ रैंप क्या है?" },
];

export function CorpusSearch({ hi }: { hi: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "ready">("idle");
  const [result, setResult] = useState<AgentAnswer | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLParagraphElement>(null);

  const ask = useCallback(
    async (q: string) => {
      const text = q.trim();
      if (!text) return;
      setState("loading");
      try {
        setResult(runAgent(await loadIndex(), text, {}));
      } catch {
        setResult({
          plan: [],
          passages: [],
          figures: [],
          refusal: hi ? "सूचकांक लोड नहीं हुआ।" : "The index could not be loaded.",
          method: "",
        });
      }
      setState("ready");
    },
    [hi],
  );

  return (
    <section
      className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-4 sm:p-5"
      aria-labelledby="corpus-heading"
    >
      <h3
        id="corpus-heading"
        className="font-display tracking-tight text-[var(--ink)]"
        style={{ fontSize: "calc(var(--d-support) * 1.25)" }}
      >
        {hi ? "विनिर्देश खोजें" : "Search the specification"}
      </h3>
      <p className="mt-1 text-[var(--ink-muted)]" style={{ fontSize: "var(--d-support)" }}>
        {hi
          ? "362 अनुच्छेद, 15 दस्तावेज़। उत्तर उद्धरण के साथ आता है, गढ़ा हुआ नहीं।"
          : "362 passages across 15 documents. Answers arrive as citations, not as prose."}
      </p>

      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input.current?.value ?? "");
        }}
      >
        <label htmlFor="corpus-q" className="sr-only">
          {hi ? "विनिर्देश से प्रश्न" : "Question for the specification"}
        </label>
        <input
          id="corpus-q"
          ref={input}
          type="search"
          placeholder={hi ? "प्रश्न लिखिए…" : "Ask a question…"}
          className="min-w-0 flex-1 rounded-lg border border-[var(--rule)] bg-[var(--surface-2)]
                     px-3 py-2 text-[var(--ink)] outline-none
                     placeholder:text-[var(--ink-faint)]
                     focus-visible:border-[var(--accent)]"
          style={{ fontSize: "var(--d-support)" }}
        />
        <button
          type="submit"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[var(--accent-ink)]
                     transition-colors hover:bg-[var(--accent-2)]
                     focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {hi ? "खोजें" : "Search"}
        </button>
      </form>

      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {SUGGESTED.map((s) => (
          <li key={s.en}>
            <button
              type="button"
              onClick={() => {
                const q = hi ? s.hi : s.en;
                if (input.current) input.current.value = q;
                void ask(q);
              }}
              className="rounded-full border border-[var(--rule)] px-2.5 py-1
                         text-[var(--ink-muted)] transition-colors
                         hover:border-[var(--accent)] hover:text-[var(--ink)]
                         focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
            >
              {hi ? s.hi : s.en}
            </button>
          </li>
        ))}
      </ul>

      {/* Announced to assistive tech, because a result that appears silently is
          a result a screen-reader user never learns arrived. */}
      <p ref={status} role="status" aria-live="polite" className="sr-only">
        {state === "loading"
          ? hi ? "खोज जारी" : "Searching"
          : state === "ready"
            ? `${result?.passages.length ?? 0} ${hi ? "परिणाम" : "results"}`
            : ""}
      </p>

      {state === "loading" && (
        <p
          className="mt-4 text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-support)" }}
        >
          {hi ? "खोजा जा रहा है…" : "Searching…"}
        </p>
      )}

      {state === "ready" && result && (
        <div className="mt-4 space-y-3">
          {result.refusal && (
            <p
              className="rounded-lg border border-[var(--rule)] bg-[var(--surface-2)] p-3
                         leading-relaxed text-[var(--ink-muted)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {result.refusal}
            </p>
          )}
          {result.passages.map((p, i) => (
            <figure
              key={`${p.doc}-${i}`}
              className="rounded-lg border border-[var(--rule)] bg-[var(--surface-2)] p-3"
            >
              <blockquote
                className="leading-relaxed text-[var(--ink)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {p.text.length > 340 ? `${p.text.slice(0, 340)}…` : p.text}
              </blockquote>
              <figcaption
                className="mt-2 flex flex-wrap items-baseline gap-x-2.5 border-t
                           border-[var(--rule)] pt-2 text-[var(--ink-faint)]"
                style={{ fontSize: "calc(var(--d-support) * 0.88)" }}
              >
                <span className="text-[var(--accent)]">{p.doc}</span>
                <span className="min-w-0 truncate">{p.heading}</span>
                <span className="ml-auto font-mono tabular-nums">BM25 {p.score.toFixed(1)}</span>
              </figcaption>
            </figure>
          ))}
          {result.method && (
            <p
              className="text-[var(--ink-faint)]"
              style={{ fontSize: "calc(var(--d-support) * 0.88)" }}
            >
              {hi
                ? "शाब्दिक पुनर्प्राप्ति, ब्राउज़र में। कोई भाषा मॉडल नहीं। "
                : "Lexical retrieval, in the browser. No language model. "}
              {result.method}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
