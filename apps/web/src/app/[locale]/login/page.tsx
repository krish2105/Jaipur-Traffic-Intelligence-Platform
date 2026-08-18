import { setRequestLocale } from "next-intl/server";

import { LoginView } from "@/components/auth/login-view";

export const dynamic = "force-static";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LoginView />;
}
