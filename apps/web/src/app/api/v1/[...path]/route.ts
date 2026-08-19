import { NextResponse } from "next/server";

import snapshot from "@/data/snapshot.json";

/**
 * A real, callable read API on the deployment.
 *
 * Until now the captured API responses (ADR-062) were bundled into pages and
 * nothing else. That is fine for rendering and useless for scrutiny: an
 * engineer at the Commissionerate who wants to check a figure has no URL to
 * call, and "no hosted API" is the first thing a technical review writes down.
 *
 * Render wants a payment card and the project is on free tier throughout, so
 * the API is served from the frontend's own deployment instead. Same JSON, same
 * citations, same figures the pages render — reachable with curl.
 *
 * **This is a read-only mirror, not the backend.** FastAPI remains the real
 * service: it holds the database, the RBAC, the audit trail and every write
 * path. What is exposed here is the subset that is already public on the pages,
 * which is why it can be CORS-open and unauthenticated without giving anything
 * away. `X-PRAVAAH-Source: snapshot` says so on every response, so nothing here
 * can be mistaken for a live measurement.
 *
 * Deliberately absent: /audit and /enforcement/defaulters. They are role-gated
 * in the real API, and mirroring them into an unauthenticated endpoint would
 * contradict the access-control story the rest of the platform makes — the same
 * reasoning that kept them out of the snapshot in the first place.
 */

const DATA = snapshot as Record<string, unknown>;

/** Never served here, whatever the snapshot happens to contain. */
const WITHHELD = [/^\/audit/, /^\/enforcement\/defaulters/];

const CORS = {
  // Open on purpose: every figure behind it is already published on the pages,
  // and a department that cannot call it from a spreadsheet will not call it.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function headers(extra: Record<string, string> = {}) {
  return {
    ...CORS,
    "X-PRAVAAH-Source": "snapshot",
    "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
    ...extra,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const pathname = `/${(path ?? []).join("/")}`;

  if (WITHHELD.some((re) => re.test(pathname))) {
    return NextResponse.json(
      {
        error: "withheld",
        detail:
          "Role-gated in the PRAVAAH API and deliberately not mirrored to an " +
          "unauthenticated endpoint. Available to an authorised officer through " +
          "the authenticated service.",
      },
      { status: 403, headers: headers() },
    );
  }

  const search = new URL(request.url).search;
  // The snapshot is keyed by the exact path the client requested, query string
  // included, because /counts/summary means nothing without its corridor_id.
  // Try the qualified key first, then the bare path, so both work.
  const body = DATA[`${pathname}${search}`] ?? DATA[pathname];

  if (body === undefined) {
    return NextResponse.json(
      {
        error: "not_found",
        detail: `No captured response for ${pathname}${search}.`,
        available: Object.keys(DATA).sort(),
      },
      { status: 404, headers: headers() },
    );
  }

  return NextResponse.json(refreshed(body), { headers: headers() });
}

/**
 * Recompute any freshness a captured payload declares about itself.
 *
 * A snapshot freezes every field, including the ones whose whole job is to say
 * how old the data is. `/probe/coverage` was captured saying `is_fresh: true`
 * and `age_minutes: 5.6`, and would have gone on saying it for as long as the
 * build was deployed — a stale reading wearing a fresh label, which is the one
 * thing the probe layer was built to prevent.
 *
 * So any payload carrying both `captured_at` and `max_age_minutes` gets those
 * two fields recomputed from the clock now. Deliberately a general rule rather
 * than a special case for one path: a mirror that freezes time should re-derive
 * anything that claims to be about the present, and the next endpoint to report
 * its own age gets this for free instead of shipping the same bug again.
 */
function refreshed(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return body;
  const record = body as Record<string, unknown>;
  const capturedAt = record.captured_at;
  const maxAge = record.max_age_minutes;
  if (typeof capturedAt !== "string" || typeof maxAge !== "number") return body;

  const captured = Date.parse(capturedAt);
  if (Number.isNaN(captured)) return body;

  const ageMinutes = (Date.now() - captured) / 60000;
  return {
    ...record,
    age_minutes: Math.round(ageMinutes * 10) / 10,
    is_fresh: ageMinutes >= 0 && ageMinutes <= maxAge,
    // Said plainly, because "the deployment reads a captured file" is exactly
    // the kind of thing a reviewer should not have to infer from a header.
    freshness_note:
      "Captured, not live. Age is recomputed on each request from captured_at, " +
      "so this goes stale honestly rather than staying green forever.",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: headers() });
}
