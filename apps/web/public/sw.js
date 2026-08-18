/**
 * PRAVAAH service worker.
 *
 * docs/03 §5: the demo must render with the network cable pulled. That is not
 * a hypothetical — a government building's guest wifi is exactly the thing that
 * fails during a pitch, and an officer's phone on a flyover has no signal at
 * all.
 *
 * Two caches with two different policies, because they answer different
 * questions:
 *
 *   SHELL   cache-first.    The app's own JS and CSS never change without a new
 *                           deploy, so serving them from disk is both correct
 *                           and instant.
 *   DATA    network-first.  A measurement must be fresh when the network is
 *                           there. When it is not, the last good response is a
 *                           far better answer than a broken page — provided the
 *                           interface says it is stale, which is what the
 *                           `X-PRAVAAH-Stale` header below is for.
 *
 * What is deliberately NOT cached:
 *
 *   - Anything that is not a GET. A decision recorded while offline must fail
 *     loudly rather than be replayed later into an audit log, where it would
 *     carry a timestamp that never happened.
 *   - Anything under /api/v1/audit or /api/v1/enforcement. A shared phone
 *     holding a cached violation queue or audit trail is a data-at-rest problem
 *     nobody signed off, and docs/07 keeps P2 data off the device.
 */

const VERSION = "pravaah-v1";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

/** Never persisted to disk, at any staleness. */
const SENSITIVE = [/\/api\/v1\/audit/, /\/api\/v1\/enforcement/];

self.addEventListener("install", (event) => {
  // Take over promptly; a half-updated worker serving a mix of two builds is
  // harder to reason about than a brief reload.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Non-GET never touches a cache. See the note above on replayed decisions.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !url.pathname.startsWith("/api/")) {
    // Cross-origin assets are the CDN's problem, and caching them here would
    // hide a supply-chain change behind our own storage.
    return;
  }
  if (SENSITIVE.some((re) => re.test(url.pathname))) return;

  const isData = url.pathname.startsWith("/api/");

  event.respondWith(
    isData ? networkFirst(request) : cacheFirst(request),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // A navigation with nothing cached is the one case where there is genuinely
    // nothing to show. Fall through to the browser's own offline handling
    // rather than inventing a page that claims to be PRAVAAH.
    return Response.error();
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (!cached) throw new Error("offline and nothing cached");
    // Re-wrap so the app can tell a served-from-disk answer from a live one.
    // A stale figure shown as live is worse than no figure at all.
    const headers = new Headers(cached.headers);
    headers.set("X-PRAVAAH-Stale", "1");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }
}
