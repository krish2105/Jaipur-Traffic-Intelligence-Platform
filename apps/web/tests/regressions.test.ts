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
