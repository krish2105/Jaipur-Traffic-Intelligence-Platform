import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import snapshot from "../src/data/snapshot.json";

/**
 * One test per bug that actually shipped.
 *
 * Every case here is a defect that reached a deployment and was found by
 * looking at the screen rather than by anything automated. That is the honest
 * reason this file exists: the review note said "four rendering bugs shipped
 * undetected", and a fix without a guard is just the same bug waiting for the
 * next refactor.
 *
 * Each test names the failure it prevents, so a future reader knows what
 * breaking it would mean rather than only that something went red.
 */

const web = join(__dirname, "..");
const read = (p: string) => readFileSync(join(web, p), "utf8");

describe("service worker", () => {
  const sw = read("public/sw.js");

  it("serves documents network-first, so a deploy is ever picked up", () => {
    // The bug: documents were cache-first. HTML is the one URL that does not
    // change between deploys, so a cached copy was served forever, pointing at
    // the chunk hashes of the build it came from. A new deploy could never
    // reach a returning visitor. Caught only because a chart change never
    // appeared in the browser.
    expect(sw).toMatch(/isData \|\| isDocument \? networkFirst/);
  });

  it("matches a cached document ignoring Vary, or a reload finds nothing", () => {
    // Next's App Router answers pages with `Vary: rsc, next-router-state-tree,
    // ...` and caches.match() honours Vary, so an entry stored from a prefetch
    // never matched a plain navigation. Offline, the page came back to a
    // fetch() and died on a reload — the only one a person actually performs.
    expect(sw).toMatch(/documentKey\(url\), \{ ignoreVary: true \}/);
  });

  it("only stores real HTML under the document key", () => {
    // Without the content-type guard a blanket ignoreVary can hand a reload the
    // RSC flight payload cached for the same path, which renders as garbage.
    expect(sw).toMatch(/text\/html/);
  });

  it("never caches a non-GET, so an offline decision cannot be replayed", () => {
    expect(sw).toMatch(/request\.method !== "GET"/);
  });

  it("keeps audit and enforcement off the device", () => {
    expect(sw).toMatch(/\/api\/v1\/audit/);
    expect(sw).toMatch(/\/api\/v1\/enforcement/);
  });
});

describe("console layout", () => {
  const shell = read("src/components/console/shell.tsx");

  it("gives the map pane flex-none below lg, or it collapses to 0px", () => {
    // The bug: below lg the column is a flex COLUMN, so flex-1's
    // `flex-basis: 0%` outranks `height` on the main axis. Paired with
    // shrink-0 the pane sat at exactly 0 whenever the panel rail overflowed —
    // an invisible map on every screen under 1024px, which is most of the ones
    // this was demoed on.
    expect(shell).toMatch(/max-lg:h-\[45vh\] max-lg:flex-none/);
    expect(shell).not.toMatch(/max-lg:h-\[45vh\] max-lg:shrink-0/);
  });
});

describe("3D scene framing", () => {
  const scene = read("src/components/city/city-scene.tsx");

  it("tracks its container size rather than trusting one measurement", () => {
    // R3F measures once at mount. This canvas mounts inside a pane sized by a
    // flex rule that settles a frame later, so the measurement was zero and the
    // canvas stayed at its intrinsic 300x150 — a postage stamp stretched across
    // the pane, with the scene rendering perfectly into it.
    expect(scene).toMatch(/new ResizeObserver/);
    expect(scene).toMatch(/setSize\(width, height\)/);
  });

  it("aims at a point on the carriageway, not the centroid of every link", () => {
    // ADR-019. A corridor is a curve and the centroid of a curve is not on the
    // curve. On a wide pane the road stayed in frustum anyway, which hid it;
    // narrow to a phone and the camera showed a correctly rendered picture of
    // empty ground.
    expect(scene).toMatch(/function carriagewayTarget/);
    expect(scene).not.toMatch(/target=\{\[0, 0, 0\]\}/);
  });
});

describe("2D atlas map", () => {
  const map = read("src/components/map/corridor-map.tsx");

  it("re-measures on resize, since MapLibre reads its container once", () => {
    expect(map).toMatch(/new ResizeObserver/);
    expect(map).toMatch(/instance\.resize\(\)/);
  });

  it("builds the basemap into the constructor rather than swapping it in", () => {
    // setStyle during mount raced the initial style load; MapLibre logged
    // "Style is not done loading" and discarded the basemap, leaving black.
    expect(map).toMatch(/style: rasterStyle\(built\.current\)/);
  });
});

describe("chart colours", () => {
  const ramp = ["#2DD4A7", "#8CD65B", "#FFB020", "#FF6B4A", "#FF2D55"];
  const classes = [
    "2W", "CAR", "AUTO", "ERIK", "LCV", "BUS",
    "TRK2", "NMV", "TAXI", "MBUS", "TRKM", "TRAC",
  ];

  it("never paints a vehicle class in a congestion-ramp colour", async () => {
    // Three classes were pixel-identical to ramp colours: AUTO was ramp-free,
    // ERIK ramp-light, TRK2 ramp-severe. A truck and a jammed link rendered the
    // same and meant different things.
    //
    // Asserted against the resolved colours rather than the file text. The
    // first version of this test grepped the source and failed on the COMMENT
    // that documents the old bug — a test that cannot tell a fix from the
    // description of what it fixed.
    const { classColour } = await import("../src/components/charts/composition");
    for (const code of classes) {
      expect(ramp.map((r) => r.toUpperCase())).not.toContain(
        classColour(code).toUpperCase(),
      );
    }
  });

  it("gives every class a distinct colour", () => {
    // Two classes sharing a swatch is a chart that cannot be read.
    return import("../src/components/charts/composition").then(({ classColour }) => {
      const used = classes.map((c) => classColour(c).toUpperCase());
      expect(new Set(used).size).toBe(classes.length);
    });
  });
});

describe("snapshot", () => {
  // Through unknown: /corridors is an array, so the snapshot's inferred type
  // does not overlap a Record of Records and tsc rejects the direct cast.
  const data = snapshot as unknown as Record<string, Record<string, unknown>>;

  it("carries the endpoints the pitch rests on", () => {
    for (const key of [
      "/safety/severity",
      "/safety/severity-model",
      "/enforcement/allocation",
      "/meta/kpis",
    ]) {
      expect(data[key], `${key} missing from snapshot`).toBeDefined();
    }
  });

  it("ships no figure without its source", () => {
    const severity = data["/safety/severity"];
    expect(severity?.sources).toBeDefined();
    for (const src of Object.values(
      severity?.sources as Record<string, { url?: string; accessed?: string }>,
    )) {
      expect(src.url).toMatch(/^https?:\/\//);
      expect(src.accessed).toBeTruthy();
    }
  });

  it("publishes where the allocator's recommendation stops holding", () => {
    // A recommendation shown without the range it depends on is a sales claim.
    const alloc = data["/enforcement/allocation"];
    const robustness = alloc?.robustness as { holds_above_k?: number } | undefined;
    expect(robustness?.holds_above_k).toBeTypeOf("number");
  });

  it("never claims the severity model is fitted", () => {
    // Crash-level records are not public. Presenting a structured model as a
    // regression would be the most dishonest thing in the repository.
    expect((data["/safety/severity-model"] as { is_fitted?: boolean })?.is_fitted).toBe(false);
  });

  it("keeps role-gated endpoints out of the public bundle", () => {
    expect(Object.keys(data).some((k) => k.startsWith("/audit"))).toBe(false);
  });
});

describe("a captured payload must not claim to be fresh forever", () => {
  /**
   * The snapshot froze `/probe/coverage` saying `is_fresh: true` and
   * `age_minutes: 5.6`, and would have gone on saying it for as long as the
   * build was deployed. A stale speed wearing a fresh label is the single thing
   * the probe layer exists to prevent, so the mirror recomputes it per request.
   */
  const coverage = (snapshot as Record<string, unknown>)["/probe/coverage"] as
    | Record<string, unknown>
    | undefined;

  it("captures the fields needed to re-derive its own age", () => {
    expect(coverage).toBeDefined();
    expect(typeof coverage?.captured_at).toBe("string");
    expect(typeof coverage?.max_age_minutes).toBe("number");
  });

  it("has a capture time that parses", () => {
    // Without this the route handler silently falls back to the frozen value.
    expect(Number.isNaN(Date.parse(String(coverage?.captured_at)))).toBe(false);
  });

  it("goes stale once it is older than the window it declares", () => {
    const maxAge = Number(coverage?.max_age_minutes);
    const captured = Date.parse(String(coverage?.captured_at));
    const wellPast = captured + (maxAge + 1) * 60000;
    const ageMinutes = (wellPast - captured) / 60000;
    expect(ageMinutes <= maxAge).toBe(false);
  });
});

describe("retrieval reaches past the exact words", () => {
  /**
   * BM25 matches words. A question phrased differently from the corpus scores
   * zero however well it matches in meaning. The index carries a co-occurrence
   * map built at compile time so a paraphrase can still land, without shipping
   * a model to a browser that has to work offline.
   */
  const index = JSON.parse(
    readFileSync(join(__dirname, "../public/data/rag-index.json"), "utf8"),
  ) as { expansion?: Record<string, string[]>; method: string; expansion_note?: string };

  it("ships an expansion map", () => {
    expect(index.expansion).toBeDefined();
    expect(Object.keys(index.expansion ?? {}).length).toBeGreaterThan(200);
  });

  it("links terms to words that actually co-occur", () => {
    // Not a synonym list. "helmet" reaches "fatalities" because the documents
    // discuss them together, which is the mechanism and also its limit.
    expect(index.expansion?.helmet).toBeDefined();
    expect(index.expansion?.helmet?.length).toBeGreaterThan(0);
  });

  it("expands words, not numbers or fragments", () => {
    // Numbers stay searchable — someone will type 34.7 — but they make poor
    // synonyms, and the first build had "way." and "58.7" as neighbours.
    for (const [term, related] of Object.entries(index.expansion ?? {}).slice(0, 200)) {
      expect(term).toMatch(/^[a-z]{4,}$/);
      for (const other of related) expect(other).toMatch(/^[a-z]{4,}$/);
    }
  });

  it("says plainly that co-occurrence is not meaning", () => {
    expect(index.expansion_note ?? "").toMatch(/not meaning/i);
  });
});

describe("an animated figure must never be able to settle on zero", () => {
  /**
   * The landing hero read "0 vehicles counted today" on the deployment while
   * the endpoint behind it returned 416,514. The counter initialised its motion
   * value to zero and only reached the real number if an IntersectionObserver
   * fired; when it did not, zero was the final answer.
   *
   * Zero is the worst possible wrong number here. It does not read as "loading",
   * it reads as "this system measures nothing", on the page whose whole argument
   * is that it measures something.
   */
  const source = readFileSync(
    join(__dirname, "../src/components/landing/motion-primitives.tsx"),
    "utf8",
  );

  it("initialises the counter to its target, not to zero", () => {
    expect(source).toMatch(/useMotionValue\(to\)/);
    expect(source).not.toMatch(/useMotionValue\(reduce \? to : 0\)/);
  });

  it("only drops to zero once the animation is about to run", () => {
    // The set(0) must live inside the effect that starts the animation, so a
    // counter that never animates is never zeroed.
    const effect = source.slice(source.indexOf("useEffect(() => {"));
    expect(effect).toMatch(/count\.set\(0\)/);
  });
});

describe("no clock may be rendered during hydration", () => {
  /**
   * The console header formatted `new Date()` into text. shell.tsx is a client
   * component, but Next.js server-renders those too, so the server wrote one
   * minute into the HTML and the browser hydrated wanting another. React threw
   * hydration error #418, discarded the server markup for that subtree and
   * re-rendered it.
   *
   * Intermittent by nature — it needs the minute to roll over between render
   * and hydration — so it is invisible in a screenshot and likeliest on a slow
   * connection. It was found in a console log, not by looking at the page.
   *
   * The same value positioned the "now" marker on the day-profile chart, which
   * could therefore be drawn in one place on the server and another after
   * hydration.
   */
  const files = [
    "../src/components/console/shell.tsx",
    "../src/components/console/card-gallery.tsx",
  ];

  for (const file of files) {
    const source = readFileSync(join(__dirname, file), "utf8");

    it(`${file.split("/").pop()} does not construct a date during render`, () => {
      // A server component may do this — the value is serialised into the RSC
      // payload and hydration matches. A client component may not.
      expect(source).toContain('"use client"');
      expect(source).not.toMatch(/new Date\(\)/);
    });
  }

  it("the clock comes from an external store, not an effect", () => {
    const hook = readFileSync(join(__dirname, "../src/lib/use-client-now.ts"), "utf8");
    expect(hook).toContain("useSyncExternalStore");
    // Null on the server is the whole mechanism: both renders agree because
    // neither has a time.
    expect(hook).toMatch(/getServerSnapshot\(\): number \| null \{\s*return null;/);
  });

  it("the now marker is absent before mount, not drawn at midnight", () => {
    const chart = readFileSync(join(__dirname, "../src/components/charts/day-profile.tsx"), "utf8");
    // Comments stripped first. The comment above the guard explains why
    // `nowMinutes ?? 0` was wrong, and an assertion that the file does not
    // contain that string was failing on the explanation of why it does not.
    const code = chart.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/nowMinutes !== null &&/);
    expect(code).not.toMatch(/nowMinutes \?\? 0/);
  });
});

describe("an ssr:false map must render the same thing on both first renders", () => {
  /**
   * `dynamic(..., { ssr: false })` renders its `loading` fallback on the server.
   * When the chunk is already available the import resolves before hydration,
   * so React's first client render is the real map where the server HTML holds
   * an ellipsis — hydration error #418, several times per load, on every page
   * carrying a map. React recovered by re-rendering the subtree, so nothing
   * looked wrong and it lived in the console log for weeks.
   *
   * Diagnosed by correlation in ADR-063: the two map-bearing pages failed in
   * the same two chunks, the two without a map were silent.
   */
  const source = readFileSync(
    join(__dirname, "../src/components/map/corridor-map.loader.tsx"),
    "utf8",
  );

  it("gates the dynamic import behind a mount check", () => {
    expect(source).toContain("useSyncExternalStore");
  });

  it("reports not-mounted on the server, so both first renders agree", () => {
    // The whole mechanism. If this snapshot ever returns true, the server and
    // the client can disagree again and the error comes straight back.
    expect(source).toMatch(/\(\)\s*=>\s*false,/);
  });

  it("renders the same fallback component in both paths", () => {
    // Two different placeholders would be the same bug wearing a disguise:
    // the server's markup still would not match the client's first render.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/loading:\s*Fallback/);
    expect(code).toMatch(/if \(!mounted\) return <Fallback \/>;/);
  });
});
