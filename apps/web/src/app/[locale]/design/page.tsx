import { setRequestLocale } from "next-intl/server";

import { api } from "@/lib/api";
import { CardStyleGallery } from "@/components/console/card-gallery";

export const dynamic = "force-dynamic";

/**
 * Card-language decision aid.
 *
 * One panel, three treatments, the same live data. Judging a card language from
 * a description does not work — the whole complaint was that panels looked flat
 * and cramped, and that is only visible rendered.
 */
export default async function DesignPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [summary, profile] = await Promise.all([api.summary(1), api.dayProfile(1)]);
  return <CardStyleGallery summary={summary} profile={profile} />;
}
