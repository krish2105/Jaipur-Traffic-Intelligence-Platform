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
    del postings  # built only to compute df; never shipped

    n = len(chunks)
    avgdl = sum(lengths) / n if n else 0.0
    # Precomputed so the browser does no log() at query time.
    idf = {
        term: round(math.log(1 + (n - freq + 0.5) / (freq + 0.5)), 4)
        for term, freq in df.items()
        # A term in almost every chunk cannot discriminate between them.
        if freq < n * 0.6
    }

    # Term frequencies are NOT shipped. They are recoverable from the chunk text
    # by the same tokeniser, and 362 chunks of ~69 tokens is a few milliseconds
    # of work in the browser — against ~300 KB of duplicated payload if sent.
    index = {
        "chunks": [
            {"d": c["doc"], "h": c["heading"], "t": c["text"]}
            for c in chunks
        ],
        "idf": idf,
        "avgdl": round(avgdl, 2),
        "n": n,
        "method": "BM25 (k1=1.5, b=0.75), lexical, built at compile time",
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(index, separators=(",", ":"), ensure_ascii=False))
    print(f"{OUT}  {OUT.stat().st_size / 1024:.0f} KB")
    print(f"  {n} chunks from {len(list(DOCS.glob('*.md')))} documents")
    print(f"  {len(idf)} indexed terms, avg chunk {avgdl:.0f} tokens")


if __name__ == "__main__":
    main()
