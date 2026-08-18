import { setRequestLocale } from "next-intl/server";

import { api } from "@/lib/api";
import { ConsoleShell } from "@/components/console/shell";
import type { SceneLink } from "@/components/city/city-view";

export const dynamic = "force-dynamic";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

export default async function ConsolePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [corridors, summary, cameras, forecast, scene, buildings] = await Promise.all([
    api.corridors().catch(() => []),
    api.summary(1),
    api.cameras().catch(() => []),
    api.forecast(),
    fetch(`${BASE}/api/v1/scene?corridor_id=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .catch(() => ({ links: [] })),
    fetch(`${BASE}/api/v1/scene/buildings`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { buildings: [] }))
      .catch(() => ({ buildings: [] })),
  ]);

  return (
    <ConsoleShell
      corridors={corridors}
      summary={summary}
      cameras={cameras}
      forecast={forecast}
      links={(scene.links ?? []) as SceneLink[]}
      buildings={buildings.buildings ?? []}
    />
  );
}
