import { NextResponse } from "next/server";

import snapshot from "@/data/snapshot.json";

/**
 * An index, so the API is explorable rather than only guessable.
 *
 * A department engineer handed a base URL and no listing will try two endpoints
 * and give up. This returns every path that answers, which costs nothing and is
 * the difference between an API someone checks and an API someone believes or
 * doesn't.
 */
export async function GET(request: Request) {
  const base = new URL(request.url).origin;
  const paths = Object.keys(snapshot as Record<string, unknown>).sort();

  return NextResponse.json(
    {
      service: "PRAVAAH read API",
      description:
        "Captured responses from the PRAVAAH backend (ADR-062), served from the " +
        "frontend deployment because the API host is not yet provisioned. " +
        "Read-only, unauthenticated, and identical to the figures the pages render.",
      source: "snapshot",
      note:
        "Every figure under /safety/severity, /enforcement/allocation and " +
        "/meta/kpis is a published government statistic and carries its source " +
        "URL in the response body. Per-link counts and camera detections remain " +
        "synthetic and are flagged is_synthetic.",
      withheld: [
        "/audit/*",
        "/enforcement/defaulters",
      ],
      withheld_reason:
        "Role-gated in the authenticated service; not mirrored to a public endpoint.",
      count: paths.length,
      endpoints: paths.map((p) => `${base}/api/v1${p}`),
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "X-PRAVAAH-Source": "snapshot",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
