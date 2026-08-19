"""Build the retrieval index that ships with the frontend.

The index is served as a static asset and fetched only when someone actually
asks a question, so the pages nobody queries never pay for it.

Why this is a build step and not a service
------------------------------------------
The API is not hosted — Render wants a payment card and the project is on free
tier throughout (ADR-062, ADR-064). A server-side RAG would therefore be
invisible in the only place anyone will actually see this: the deployment. So
the index is computed here, at build time, shipped as JSON, and searched in the
browser. Zero backend, zero cost, and it keeps working with the network cable
pulled, which docs/03 §5 requires of the demo anyway.

Why BM25 and not embeddings
---------------------------
This corpus is 41k words of specification, and the questions asked of it are
overwhelmingly terminological — "what does DPDP require", "which detector",
"what is the congestion ramp". Lexical retrieval is *better* than dense
retrieval on that shape of query, because the exact term is the signal and an
embedding blurs it. It is also deterministic, needs no model download, adds no
dependency, and can be explained to a procurement officer in one sentence.

Calling that a limitation would be dishonest in the other direction: BM25 will
miss a genuine paraphrase where an embedding would not. The honest description
is that this is lexical retrieval with exact citations, and the UI says so.

    uv run python scripts/build_rag_index.py
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUT = ROOT / "apps/web/public/data/rag-index.json"

#: Roughly a paragraph. Long enough to be a real answer, short enough that a
#: citation points at something a reader can check in a few seconds.
TARGET_WORDS = 110
MIN_WORDS = 25

#: Terms that carry no retrieval signal in a spec corpus.
#:
#: A split string rather than a list literal, and that is
#: deliberate. As a literal this is one 400-character line; wrapping it silently
#: fused "i"+"if", "the"+"their" and "who"+"will" into three words that are not
#: words, which stopped those six from being stripped and quietly changed the
#: index. Prose in a string cannot fail that way.
STOP = frozenset(
    (  # noqa: SIM905 — a list literal here corrupted three words when wrapped
        "a an and are as at be been but by can do does for from had has "
        "have how i if in into is it its may must no not of on or should "
        "so than that the their then there these they this to was we were "
        "what when where which who will with would you your"
    ).split()
)

TOKEN = re.compile(r"[a-z0-9][a-z0-9\-_/§.]*")


def tokenise(text: str) -> list[str]:
    return [t for t in TOKEN.findall(text.lower()) if t not in STOP and len(t) > 1]


def chunk(path: Path) -> list[dict[str, object]]:
    """Split on headings first, then on size.

    Heading-aware because a citation that names its section is far more useful
    than one that names a byte offset — "docs/07 §3 Data protection" is
    checkable, "chunk 41" is not.
    """
    text = path.read_text(encoding="utf-8")
    out: list[dict[str, object]] = []
    heading = path.stem.replace("_", " ")
    buffer: list[str] = []

    def flush() -> None:
        if not buffer:
            return
        body = " ".join(buffer).strip()
        if len(body.split()) >= MIN_WORDS:
            out.append({"doc": path.name, "heading": heading, "text": body})
        buffer.clear()

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            flush()
            heading = stripped.lstrip("#").strip() or heading
            continue
        if not stripped:
            if len(" ".join(buffer).split()) >= TARGET_WORDS:
                flush()
            continue
        # Skip code fences and table rules: they retrieve badly and read worse.
        if stripped.startswith(("```", "|---", "---")):
            continue
        buffer.append(stripped)
        if len(" ".join(buffer).split()) >= TARGET_WORDS * 1.6:
            flush()
    flush()
    return out


#: Terms rarer than this cannot support a co-occurrence estimate: two shared
#: chunks is a coincidence, not a relationship.
MIN_DF_FOR_EXPANSION = 4

#: How many neighbours to keep per term. Four is enough to bridge a paraphrase
#: and few enough to keep the map from doubling the index.
NEIGHBOURS = 4


def _co_occurrence(
    postings: list[dict[str, int]], df: Counter[str], n: int
) -> dict[str, list[str]]:
    """Terms that occur together more than chance, by pointwise mutual information.

    Raw co-occurrence counts would rank every term's neighbours as the corpus's
    most common words, which helps nobody. PMI divides by what chance predicts,
    so it surfaces pairs that are specifically associated rather than merely
    frequent.
    """
    # Words only, and long enough to carry meaning. Numbers and fragments are
    # excluded from *expansion* but stay fully searchable: "34.7" is exactly the
    # kind of thing someone types, and it should match the chunk that contains
    # it. It just makes a poor synonym for "helmet".
    candidates = {
        term
        for term, freq in df.items()
        if freq >= MIN_DF_FOR_EXPANSION and len(term) >= 4 and term.isalpha()
    }
    together: dict[str, Counter[str]] = {term: Counter() for term in candidates}
    for posting in postings:
        present = sorted(set(posting) & candidates)
        for i, a in enumerate(present):
            for b in present[i + 1 :]:
                together[a][b] += 1
                together[b][a] += 1

    out: dict[str, list[str]] = {}
    for term, counts in together.items():
        scored = []
        for other, shared in counts.items():
            if shared < 2:
                continue
            # PMI: log( P(a,b) / (P(a) P(b)) ), with counts standing in for
            # probabilities since the denominator n cancels in the ranking.
            pmi = math.log((shared * n) / (df[term] * df[other]))
            if pmi > 0:
                scored.append((pmi, other))
        scored.sort(reverse=True)
        best = [other for _, other in scored[:NEIGHBOURS]]
        if best:
            out[term] = best
    return out


def main() -> None:
    chunks: list[dict[str, object]] = []
    for path in sorted(DOCS.glob("*.md")):
        chunks.extend(chunk(path))

    # Document frequency over the whole corpus, for IDF.
    df: Counter[str] = Counter()
    postings: list[dict[str, int]] = []
    lengths: list[int] = []
    for c in chunks:
        tokens = tokenise(str(c["text"]))
        tf = Counter(tokens)
        postings.append(dict(tf))
        lengths.append(len(tokens))
        df.update(tf.keys())
    # Kept now, to build the expansion map below. Still never shipped.

    n = len(chunks)
    avgdl = sum(lengths) / n if n else 0.0
    # Precomputed so the browser does no log() at query time.
    idf = {
        term: round(math.log(1 + (n - freq + 0.5) / (freq + 0.5)), 4)
        for term, freq in df.items()
        # A term in almost every chunk cannot discriminate between them.
        if freq < n * 0.6
    }

    # ── Co-occurrence expansion ────────────────────────────────────────────
    #
    # BM25 matches words. A question phrased in different words than the corpus
    # scores zero however well it matches in meaning: "how many cars are stuck"
    # finds nothing when the documents say "vehicle accumulation".
    #
    # The usual fix is sentence embeddings, which means shipping a model to the
    # browser. That is tens of megabytes, and this index is deliberately a
    # static asset that works with the network cable pulled. So instead: which
    # terms actually occur together in this corpus, measured at build time.
    #
    # This is co-occurrence, not meaning. It will connect "accumulation" to
    # "vehicles" because they appear together, and it will not connect a synonym
    # the corpus never uses. That is a real limit and it is stated in `method`
    # rather than left for someone to discover.
    expansion = _co_occurrence(postings, df, n)
    del postings  # built only for df and the expansion map; never shipped

    # Term frequencies are NOT shipped. They are recoverable from the chunk text
    # by the same tokeniser, and 362 chunks of ~69 tokens is a few milliseconds
    # of work in the browser — against ~300 KB of duplicated payload if sent.
    index = {
        "chunks": [{"d": c["doc"], "h": c["heading"], "t": c["text"]} for c in chunks],
        "idf": idf,
        "avgdl": round(avgdl, 2),
        "n": n,
        "expansion": expansion,
        "method": (
            "BM25 (k1=1.5, b=0.75) over lexical terms, with query expansion from "
            "corpus co-occurrence (PMI). Built at compile time; no model, no "
            "network, works offline."
        ),
        "expansion_note": (
            "Co-occurrence is not meaning. A term is linked to the words it "
            "actually appears beside in these documents, so a synonym the corpus "
            "never uses will still be missed."
        ),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(index, separators=(",", ":"), ensure_ascii=False))
    print(f"{OUT}  {OUT.stat().st_size / 1024:.0f} KB")
    print(f"  {n} chunks from {len(list(DOCS.glob('*.md')))} documents")
    print(f"  {len(idf)} indexed terms, avg chunk {avgdl:.0f} tokens")


if __name__ == "__main__":
    main()
