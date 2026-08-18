import { setRequestLocale } from "next-intl/server";

import { api } from "@/lib/api";
import { OfficerView } from "@/components/officer/officer-view";
import type { SceneLink } from "@/components/city/city-view";

export const dynamic = "force-dynamic";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

export default async function OfficerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [signals, scene] = await Promise.all([
    api.signals().catch(() => ({ advisories: [], method: "", governance: "" })),
    fetch(`${BASE}/api/v1/scene?corridor_id=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .catch(() => ({ links: [] })),
  ]);

  return <OfficerView signals={signals} links={(scene.links ?? []) as SceneLink[]} />;
}
