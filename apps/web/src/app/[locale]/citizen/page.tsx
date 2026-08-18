import { setRequestLocale } from "next-intl/server";

import { api } from "@/lib/api";
import { CitizenView } from "@/components/citizen/citizen-view";
import type { SceneLink } from "@/components/city/city-view";

export const dynamic = "force-dynamic";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

export default async function CitizenPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [scene, profile, weather] = await Promise.all([
    fetch(`${BASE}/api/v1/scene?corridor_id=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .catch(() => ({ links: [] })),
    api.dayProfile(1).catch(() => ({
      points: [],
      peak: null,
      is_synthetic: true,
      calibration: { source: "", morning_peak_pct: 0, evening_peak_pct: 0 },
    })),
    api.weather().catch(() => ({ available: false })),
  ]);

  return (
    <CitizenView
      links={(scene.links ?? []) as SceneLink[]}
      profile={profile}
      weather={weather}
    />
  );
}
