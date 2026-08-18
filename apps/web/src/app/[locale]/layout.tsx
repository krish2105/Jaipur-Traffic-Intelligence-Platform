import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Anek_Devanagari, Anek_Latin, IBM_Plex_Mono } from "next/font/google";

import { routing } from "@/i18n/routing";
import { ThemeScript } from "@/components/theme/theme-script";
import "@/styles/globals.css";

/**
 * Anek is a variable superfamily built by the Indian Type Foundry specifically
 * for Devanagari–Latin pairing (docs/06 §Typography). Listing Latin first and
 * Devanagari second means each script renders from the family that covers it,
 * so Hindi looks designed rather than fallback-rendered.
 */
const anekLatin = Anek_Latin({
  subsets: ["latin"],
  variable: "--font-anek-latin",
  display: "swap",
});
const anekDevanagari = Anek_Devanagari({
  subsets: ["devanagari", "latin"],
  variable: "--font-anek-devanagari",
  display: "swap",
});
/** Tabular figures for every measurement — values must not jitter as they update. */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: { default: t("title"), template: `%s · ${t("shortTitle")}` },
    description: t("description"),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2EDE4" },
    { media: "(prefers-color-scheme: dark)", color: "#14120F" },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${anekLatin.variable} ${anekDevanagari.variable} ${plexMono.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
