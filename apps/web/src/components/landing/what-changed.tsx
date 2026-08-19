"use client";

import { useLocale } from "next-intl";
import Link from "next/link";

import type { CityData, LiveAccumulation, Scheme } from "@/lib/api";
import type { Locale } from "@/i18n/routing";

/**
 * Three things that changed the argument, told in the order they landed.
 *
 * The landing page already carries the problem and the method. This carries what
 * happened when the method met reality: a validation that failed, a work order
 * about to be signed on a corridor we model, and a discovery that the thing we
 * had been asking for already exists.
 *
 * No entrance animation of its own. The page's `Reveal` wrapper is a CSS
 * animation precisely so a failed hydration cannot leave the section blank, and
 * the brief page relearned that lesson the hard way this afternoon by fading in
 * from opacity zero and settling at 0.23.
 */
export function WhatChanged({
  accumulation,
  scheme,
  cityData,
}: {
  accumulation: LiveAccumulation | null;
  scheme: Scheme | null;
  cityData: CityData | null;
}) {
  const hi = (useLocale() as Locale) === "hi";
  const wanted = cityData?.resources.filter((r) => r.wanted_by_pravaah) ?? [];
  const middle = scheme?.results?.[Math.floor((scheme.results.length - 1) / 2)];
  if (!accumulation && !scheme && wanted.length === 0) return null;

  const cards = [
    accumulation && {
      key: "validation",
      tag: hi ? "जाँच" : "the test",
      title: hi ? "हमने अपनी ही संख्या गिराई" : "We broke our own number",
      body: hi
        ? "गति से वाहन गिनने का पाठ्यपुस्तक स्थिरांक व्यस्त सड़कों पर 63% ग़लत निकला। 54 सिमुलेशन रन के विरुद्ध पुनः अंशांकन के बाद त्रुटि 2.8% है। हल्के भार पर अब भी 65% — इसलिए वहाँ हम कोई संख्या नहीं दिखाते।"
        : "The textbook constant for turning speed into vehicles was 63 percent wrong on busy roads. Refitted against 54 simulation runs, the error is 2.8 percent. On a lightly loaded road it is still 65, so there we print nothing at all.",
      figure: "2.8%",
      href: "/api/v1/areas/accumulation/live",
    },
    scheme &&
      middle && {
        key: "scheme",
        tag: hi ? "समय" : "the timing",
        title: hi ? `₹${scheme.scheme.cost_crore} करोड़, अभी` : `₹${scheme.scheme.cost_crore} crore, now`,
        body: hi
          ? "JDA उसी कॉरिडोर पर एलिवेटेड रोड बना रहा है जिसे हम मॉडल करते हैं। सड़क खुलते ही तुलना का आधार हमेशा के लिए ग़ायब हो जाता है। हमने पहले ही माप तैयार कर दिया है।"
          : "JDA is building an elevated road on a corridor we already model. The moment it opens, the thing you would compare against stops existing. We have set the measurement up first.",
        figure: `${Math.round(middle.groups.through?.saved_s ?? 0)}s`,
        href: "/api/v1/schemes",
      },
    wanted.length > 0 && {
      key: "iudx",
      tag: hi ? "खोज" : "the find",
      title: hi ? "कैमरे पहले से लगे हैं" : "The cameras already exist",
      body: hi
        ? "जयपुर वाहन वर्गीकरण कैमरों की लोकेशन राष्ट्रीय डेटा एक्सचेंज पर प्रकाशित करता है, ऐसे API के तहत जिसे भारतीय मानक ब्यूरो ने अनुमोदित किया है। हमें कैमरे नहीं, केवल पढ़ने की अनुमति चाहिए।"
        : "Jaipur publishes Vehicle Classification Camera locations to the national data exchange, under an API approved by the Bureau of Indian Standards. We are not asking for cameras. We are asking for read access.",
      figure: `${cityData?.resources.length ?? 0}`,
      href: "/api/v1/meta/city-data",
    },
  ].filter(Boolean) as {
    key: string;
    tag: string;
    title: string;
    body: string;
    figure: string;
    href: string;
  }[];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <article
          key={card.key}
          className="flex flex-col rounded-[var(--d-radius)] bg-[var(--surface-2)] p-5 transition-colors hover:bg-[var(--surface-3)]"
        >
          <p
            className="font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ color: "var(--accent)" }}
          >
            {card.tag}
          </p>
          <p
            className="mt-3 font-display tabular-nums leading-none text-[var(--ink)]"
            style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)" }}
          >
            {card.figure}
          </p>
          <h3 className="mt-3 font-display text-[15px] leading-snug tracking-tight text-[var(--ink)]">
            {card.title}
          </h3>
          <p className="mt-2 flex-1 text-[13px] leading-relaxed text-[var(--ink-muted)]">
            {card.body}
          </p>
          <Link
            href={card.href}
            className="mt-3 font-mono text-[10px] text-[var(--ink-faint)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--accent)]"
          >
            {card.href}
          </Link>
        </article>
      ))}
    </div>
  );
}
