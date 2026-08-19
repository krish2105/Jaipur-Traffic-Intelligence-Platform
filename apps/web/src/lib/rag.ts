/**
 * Retrieval over the specification corpus, in the browser.
 *
 * The API is not hosted (free tier, ADR-062), so a server-side retriever would
 * be invisible in the deployment — the one place this is actually seen. The
 * index is built at compile time by `scripts/build_rag_index.py` and searched
 * here. No backend, no key, no per-query cost, and it works with the network
 * down, which the demo requires anyway.
 *
 * It is **lexical** retrieval (BM25), not dense. On a specification corpus that
 * is a strength rather than a compromise: the questions are terminological —
 * "what does DPDP require", "which detector", "what is the congestion ramp" —
 * and the exact term is the signal an embedding would blur. The honest limit is
 * the other direction: a genuine paraphrase that shares no vocabulary will be
 * missed. The UI says which of the two this is rather than calling it "AI".
 *
 * Nothing here generates prose. It retrieves passages and cites them. A model
 * that writes a fluent answer over government figures is a model that will
 * eventually write a fluent wrong one, and there is no budget — in rupees or in
 * credibility — for that.
 */

const K1 = 1.5;
const B = 0.75;

const STOP = new Set(
  ("a an and are as at be been but by can do does for from had has have how i if in " +
    "into is it its may must no not of on or should so than that the their then there " +
    "these they this to was we were what when where which who will with would you your")
    .split(" "),
);

const TOKEN = /[a-z0-9][a-z0-9\-_/§.]*/g;

export function tokenise(text: string): string[] {
  return (text.toLowerCase().match(TOKEN) ?? []).filter(
    (t) => t.length > 1 && !STOP.has(t),
  );
}

interface RawIndex {
  chunks: { d: string; h: string; t: string }[];
  idf: Record<string, number>;
  avgdl: number;
  n: number;
  /** Term to the words it actually occurs beside in this corpus. */
  expansion?: Record<string, string[]>;
  method: string;
  expansion_note?: string;
}

export interface Passage {
  doc: string;
  heading: string;
  text: string;
  score: number;
}

interface Prepared {
  raw: RawIndex;
  /** Term frequencies, rebuilt here rather than shipped — see the build script. */
  tf: Map<string, number>[];
  len: number[];
}

let prepared: Prepared | null = null;
let inflight: Promise<Prepared> | null = null;

/** Fetched once, on the first question. Pages nobody queries never pay for it. */
export async function loadIndex(): Promise<Prepared> {
  if (prepared) return prepared;
  if (inflight) return inflight;
  inflight = fetch("/data/rag-index.json")
    .then((r) => {
      if (!r.ok) throw new Error(`rag index ${r.status}`);
      return r.json() as Promise<RawIndex>;
    })
    .then((raw) => {
      const tf = raw.chunks.map((c) => {
        const counts = new Map<string, number>();
        for (const term of tokenise(c.t)) counts.set(term, (counts.get(term) ?? 0) + 1);
        return counts;
      });
      prepared = { raw, tf, len: tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0)) };
      return prepared;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Standard BM25. Written out rather than pulled in, because it is nine lines. */
/**
 * Weight given to a term the question did not contain.
 *
 * Expansion terms are a guess about what was meant, so they must never outvote
 * the words actually typed. A quarter is enough to break a tie between two
 * chunks that score the same lexically, and too little to pull an unrelated
 * chunk to the top on its own.
 */
const EXPANSION_WEIGHT = 0.25;

/**
 * The query's own terms, plus the words this corpus uses alongside them.
 *
 * BM25 matches words, so a question phrased differently from the documents
 * scores zero however well it matches in meaning. The expansion map, built from
 * corpus co-occurrence at compile time, bridges some of that without shipping a
 * model to the browser — which matters because this index is a static asset
 * that has to work with the network cable pulled.
 */
function expand(raw: RawIndex, terms: string[]): { term: string; weight: number }[] {
  const seen = new Set(terms);
  const out = terms.map((term) => ({ term, weight: 1 }));
  for (const term of terms) {
    for (const related of raw.expansion?.[term] ?? []) {
      if (seen.has(related)) continue;
      seen.add(related);
      out.push({ term: related, weight: EXPANSION_WEIGHT });
    }
  }
  return out;
}

export function search(index: Prepared, query: string, top = 4): Passage[] {
  const terms = tokenise(query);
  if (terms.length === 0) return [];
  const { raw, tf, len } = index;
  const weighted = expand(raw, terms);

  const scored = raw.chunks.map((chunk, i) => {
    let score = 0;
    for (const { term, weight } of weighted) {
      const f = tf[i]?.get(term);
      if (!f) continue;
      const idf = raw.idf[term];
      if (idf === undefined) continue;
      const norm = 1 - B + (B * (len[i] ?? 0)) / (raw.avgdl || 1);
      score += weight * idf * ((f * (K1 + 1)) / (f + K1 * norm));
    }
    return { doc: chunk.d, heading: chunk.h, text: chunk.t, score };
  });

  return scored
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}

// ── the agent ───────────────────────────────────────────────────────────────

export interface PlanStep {
  kind: "retrieve" | "figure" | "refuse";
  label: string;
  detail: string;
}

export interface AgentAnswer {
  plan: PlanStep[];
  passages: Passage[];
  /** Figures pulled from the live payloads, never from the corpus text. */
  figures: { label: string; value: string; source: string }[];
  refusal: string | null;
  method: string;
}

/** Questions that are about a measurement, not about the specification. */
const FIGURE_PATTERNS: { re: RegExp; key: string }[] = [
  { re: /\b(death|fatalit|killed|died|mrityu)/i, key: "deaths" },
  { re: /\b(crash|accident|collision)/i, key: "crashes" },
  { re: /\b(challan|enforce|fine|penalt)/i, key: "enforcement" },
  { re: /\b(helmet)/i, key: "helmet" },
  { re: /\b(sever|ksi|per 100)/i, key: "severity" },
];

/**
 * Plan first, then answer — and show the plan.
 *
 * The agentic part is deliberately small and legible. It decides whether a
 * question wants a *figure* (answered from the live payload, which has
 * provenance) or an *explanation* (answered from the corpus, which has
 * citations), does both when a question wants both, and refuses when it can do
 * neither rather than composing something plausible.
 *
 * The plan is returned so the UI can render it before the answer. An official
 * who can see what the system decided to look up can tell whether the answer is
 * worth reading, which is the only form of trust that survives being wrong once.
 */
export function plan(
  question: string,
  facts: Record<string, { label: string; value: string; source: string }>,
): PlanStep[] {
  const steps: PlanStep[] = [];
  const wanted = FIGURE_PATTERNS.filter((p) => p.re.test(question)).map((p) => p.key);

  for (const key of wanted) {
    const fact = facts[key];
    if (fact) {
      steps.push({
        kind: "figure",
        label: `Read ${fact.label}`,
        detail: "from the published figures, with its source",
      });
    }
  }
  steps.push({
    kind: "retrieve",
    label: "Search the specification corpus",
    detail: "BM25 over 362 passages from 15 documents",
  });
  return steps;
}

export function answer(
  index: Prepared,
  question: string,
  facts: Record<string, { label: string; value: string; source: string }>,
): AgentAnswer {
  const steps = plan(question, facts);
  const passages = search(index, question);
  const figures = steps
    .filter((s) => s.kind === "figure")
    .map((s) => Object.values(facts).find((f) => s.label.endsWith(f.label)))
    .filter((f): f is NonNullable<typeof f> => f != null);

  // Nothing retrieved and no figure matched. Say so rather than answer anyway.
  const refusal =
    passages.length === 0 && figures.length === 0
      ? "Nothing in the corpus or the published figures matches that. " +
        "Rather than compose an answer, this is a miss — try the terms the " +
        "specification itself uses."
      : null;

  return { plan: steps, passages, figures, refusal, method: index.raw.method };
}
