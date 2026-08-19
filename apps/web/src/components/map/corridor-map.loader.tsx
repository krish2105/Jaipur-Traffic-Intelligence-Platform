"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import { useMounted } from "@/lib/use-mounted";
import type { CorridorMap as CorridorMapComponent } from "./corridor-map";

/**
 * MapLibre and deck.gl together are a large dependency, and the console's
 * default view is the 3D scene. Loading them on first paint would cost every
 * user the bundle for a view most never open. `ssr: false` because MapLibre
 * touches `window` at module scope.
 *
 * Why the mount gate below
 * ------------------------
 * `ssr: false` renders `loading` on the server, and the intent is that the
 * client's first render produces the same thing. It does not always: when the
 * chunk is already available the import resolves before hydration, React's
 * first client render is the real map where the server HTML holds an ellipsis,
 * and that structural difference is hydration error #418. React recovers by
 * discarding the server markup for the subtree and re-rendering it, so nothing
 * looks wrong, which is why this sat in the console log rather than on screen.
 *
 * It was diagnosed by correlation (ADR-063): the two pages carrying a map fail
 * in the same two chunks, the two without one are silent, and a diff of the
 * server HTML against the hydrated DOM shows the ellipsis present on the server
 * and absent on the client.
 *
 * `useMounted` makes the two renders agree by construction — both produce the
 * fallback — and the real component mounts on the update that follows
 * hydration. Same hook, same reason, as the two Recharts containers.
 *
 * On mount timing, which is the risk here
 * ---------------------------------------
 * This mounts the map one update *later* than before, never earlier. The
 * failures this repo has had with the map pane — ADR-020, and the canvas that
 * came back unmeasured on the deployment — were all measurement happening
 * before layout had settled. Later is the safe direction, and `corridor-map`
 * carries a ResizeObserver that picks up any size it was not given at mount.
 */

function Fallback() {
  return (
    <div
      className="grid h-full w-full place-items-center text-[var(--ink-faint)]"
      style={{ background: "var(--ground-deep)", fontSize: "var(--d-support)" }}
    >
      …
    </div>
  );
}

const Inner = dynamic(() => import("./corridor-map").then((m) => m.CorridorMap), {
  ssr: false,
  loading: Fallback,
});

export function CorridorMap(props: ComponentProps<typeof CorridorMapComponent>) {
  const mounted = useMounted();
  if (!mounted) return <Fallback />;
  return <Inner {...props} />;
}
