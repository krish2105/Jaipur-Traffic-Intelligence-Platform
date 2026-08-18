"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, in production only.
 *
 * In development a service worker caches the very files that are supposed to be
 * hot-reloading, which produces "my change did not appear" bugs that cost more
 * time than the offline support saves. `next dev` also serves a different asset
 * graph than a build, so a worker trained on it would cache paths that do not
 * exist in production.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // After load: registering during hydration competes with the requests that
    // are painting the first screen.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // A refused registration (private mode, unsupported browser) is not an
        // error worth surfacing — the app works, it simply will not work
        // offline.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
