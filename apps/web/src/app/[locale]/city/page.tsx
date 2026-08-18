import { setRequestLocale } from "next-intl/server";

import { CityView, type SceneLink } from "@/components/city/city-view";

export const dynamic = "force-dynamic";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

export default async function CityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [scene, buildings] = await Promise.all([
    fetch(`${BASE}/api/v1/scene?corridor_id=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .catch(() => ({ links: [] })),
    fetch(`${BASE}/api/v1/scene/buildings`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { buildings: [] }))
      .catch(() => ({ buildings: [] })),
  ]);

  return (
    <CityView
      links={(scene.links ?? []) as SceneLink[]}
      buildings={buildings.buildings ?? []}
    />
  );
}
