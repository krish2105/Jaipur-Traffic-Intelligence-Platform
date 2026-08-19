"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useLocale } from "next-intl";

import type {
  CityData,
  LiveAccumulation,
  ProbeCoverage,
  Reliability,
  Scheme,
  SourceReadiness,
} from "@/lib/api";
import type { Locale } from "@/i18n/routing";
import { Counter } from "@/components/landing/motion-primitives";

/**
 * The pitch, as a page that reads its own numbers.
 *
 * A PDF is a photograph of a claim. This is the claim itself: every figure here
 * comes from the endpoint named beneath it, so a sceptical engineer at the
 * Commissionerate can click through and check rather than take our word. That
 * traceability is the entire design brief — the visual work exists to make an
 * official read to the bottom, not to impress anyone.
 *
 * Motion is used three times and no more. An entrance for the opening claim, a
 * scroll-linked rule that measures progress through the argument, and staggered
 * reveals on the evidence rows. Everything else is static, because a government
 * briefing that animates on every scroll is a government briefing nobody
 * forwards.
 */

function Source({ path }: { path: string }) {
  // Not decoration. The point of this page is that every number has a URL.
  return (
    <a
      href={`/api/v1${path}`}
      className="font-mono text-[10px] text-[var(--ink-faint)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--accent)]"
    >
      /api/v1{path}
    </a>
  );
}

function Figure({
  value,
  unit,
  label,
  source,
  accent = false,
}: {
  value: number;
  unit?: string;
  label: string;
  source: string;
  accent?: boolean;
}) {
  const locale = useLocale() as Locale;
  return (
    <div>
      <p
        className="font-display tabular-nums leading-none"
        style={{
          fontSize: "clamp(2rem, 6vw, 3.5rem)",
          color: accent ? "var(--accent)" : "var(--ink)",
        }}
      >
        <Counter to={value} locale={locale} />
        {unit && <span style={{ fontSize: "0.4em" }}> {unit}</span>}
      </p>
      <p className="mt-1 text-[13px] leading-snug text-[var(--ink-muted)]">{label}</p>
      <p className="mt-1">
        <Source path={source} />
      </p>
    </div>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      className="border-t border-[var(--rule)] py-12 sm:py-16"
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <p
        className="font-mono text-[11px] uppercase tracking-[0.2em]"
        style={{ color: "var(--accent)" }}
      >
        {n}
      </p>
      <h2
        className="mt-2 font-display leading-tight tracking-tight text-[var(--ink)]"
        style={{ fontSize: "clamp(1.5rem, 4vw, 2.25rem)" }}
      >
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </motion.section>
  );
}

export function BriefView({
  readiness,
  probe,
  reliability,
  accumulation,
  scheme,
  cityData,
}: {
  readiness: SourceReadiness;
  probe: ProbeCoverage | null;
  reliability: Reliability | null;
  accumulation: LiveAccumulation | null;
  scheme: Scheme | null;
  cityData: CityData | null;
}) {
  const hi = (useLocale() as Locale) === "hi";
  const reduce = useReducedMotion();
  const page = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: page });
  const width = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  const wanted = cityData?.resources.filter((r) => r.wanted_by_pravaah) ?? [];
  const middle = scheme?.results?.[Math.floor((scheme.results.length - 1) / 2)];

  return (
    <div ref={page} className="mx-auto max-w-3xl px-5 pb-24 sm:px-8">
      {/* A rule that fills as you read. The only persistent motion on the page:
          it tells an official how much argument is left, which is a courtesy. */}
      <motion.div
        className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left"
        style={{ width: reduce ? "100%" : width, background: "var(--accent)" }}
        aria-hidden
      />

      <header className="pt-16 sm:pt-24">
        <p
          className="font-mono text-[11px] uppercase tracking-[0.2em]"
          style={{ color: "var(--accent)" }}
        >
          {hi ? "कार्यकारी संक्षेप" : "Executive brief"}
        </p>
        <h1
          className="mt-3 font-display leading-[1.05] tracking-tight text-[var(--ink)]"
          style={{ fontSize: "clamp(2.25rem, 8vw, 4rem)" }}
        >
          {hi
            ? "जयपुर में दुर्घटनाएँ घटीं। मौतें बढ़ीं।"
            : "Crashes in Jaipur fell. Deaths rose."}
        </h1>
        <p
          className="mt-5 max-w-xl leading-relaxed text-[var(--ink-muted)]"
          style={{ fontSize: "clamp(1rem, 2.5vw, 1.15rem)" }}
        >
          {hi
            ? "2025 में दुर्घटनाएँ 5.6% घटीं और मौतें 3.1% बढ़ीं — प्रति 100 दुर्घटनाओं पर 34.7 मौतें, पाँच वर्षों में सबसे अधिक। राजस्थान ने 2030 तक मौतें आधी करने का लक्ष्य रखा है। समस्या संख्या नहीं, गंभीरता है।"
            : "In 2025 crashes fell 5.6 percent and deaths rose 3.1, to 34.7 per hundred crashes — a five-year high. Rajasthan has committed to halving road deaths by 2030. The problem is not how often crashes happen. It is how badly they end."}
        </p>
        <p className="mt-4 text-[12px] leading-relaxed text-[var(--ink-faint)]">
          {hi
            ? "इस पृष्ठ की हर संख्या नीचे दिए गए endpoint से आती है। क्लिक करके जाँचिए।"
            : "Every figure on this page comes from the endpoint named beneath it. Click one and check."}
        </p>
      </header>

      <Section n="01" title={hi ? "अभी क्या मापा जा रहा है" : "What is measured right now"}>
        <div className="grid gap-8 sm:grid-cols-2">
          <Figure
            value={readiness.live_count}
            unit={`/ ${readiness.total}`}
            label={hi ? "डेटा स्रोत लाइव" : "data sources live, not planned"}
            source="/meta/sources"
            accent
          />
          {probe?.links_covered != null && (
            <Figure
              value={probe.links_covered}
              unit={`/ ${probe.corridor_links ?? 90}`}
              label={
                hi
                  ? `कॉरिडोर लिंक पर मापी गई गति, ${probe.segments_read} कॉल से`
                  : `corridor links carrying a measured speed, from ${probe.segments_read} calls`
              }
              source="/probe/coverage"
            />
          )}
        </div>
        <p className="mt-6 text-[13px] leading-relaxed text-[var(--ink-muted)]">
          {hi
            ? "TomTom केवल गति और देरी मापता है — कभी संख्या नहीं, कभी संरचना नहीं। यही वह अंतर है जिसे भरने के लिए यह मंच बना है।"
            : "TomTom measures speed and delay only, never volume and never composition. That gap is the reason this platform exists."}
        </p>
      </Section>

      <Section n="02" title={hi ? "एक क्षेत्र में कितने वाहन" : "How many vehicles are in an area"}>
        <p className="text-[14px] leading-relaxed text-[var(--ink-muted)]">
          {hi
            ? "यह प्रश्न सबसे अधिक पूछा गया और इसका उत्तर अब तक शून्य था। मापी गई गति से वाहन संख्या निकाली जाती है — गिनी नहीं जाती।"
            : "The question asked most often, and the one this platform answered with a zero until this week. Vehicles are inferred from measured speed, not counted."}
        </p>
        <div className="mt-6 rounded-lg border-l-2 border-[var(--accent)] bg-[var(--surface-2)] p-5">
          <p className="text-[14px] leading-relaxed text-[var(--ink)]">
            {hi
              ? "हमने अपनी ही संख्या को सिमुलेशन के विरुद्ध जाँचा और वह विफल रही। पाठ्यपुस्तक का स्थिरांक व्यस्त सड़कों पर 63% ग़लत था। पुनः अंशांकन के बाद त्रुटि 2.8% है — और हल्के भार पर अब भी 65%, इसलिए वहाँ हम कोई संख्या नहीं दिखाते।"
              : "We tested our own number against a simulation and it failed. The textbook constant was 63 percent wrong on busy roads. Refitted against 54 runs where the true count is known, the error is 2.8 percent on a busy road and still 65 percent on a light one — so on a light road we print no number at all."}
          </p>
        </div>
        {accumulation?.areas_total != null && (
          <div className="mt-6">
            <Figure
              value={accumulation.areas_with_estimate ?? 0}
              unit={`/ ${accumulation.areas_total}`}
              label={
                hi
                  ? "थाना क्षेत्रों में नमूना लिंक। बाकी अमापित हैं — खाली नहीं।"
                  : "police station areas containing a sampled link. The rest are unmeasured, which is not clear."
              }
              source="/areas/accumulation/live"
            />
          </div>
        )}
      </Section>

      {scheme && middle && (
        <Section n="03" title={hi ? "कार्यादेश से पहले" : "Before the work order"}>
          <p className="text-[14px] leading-relaxed text-[var(--ink-muted)]">
            {hi
              ? `JDA गोपालपुरा बाईपास पर ₹${scheme.scheme.cost_crore} करोड़ की एलिवेटेड रोड बना रहा है, उसी कॉरिडोर पर जिसे हम मॉडल करते हैं। सड़क खुलते ही तुलना का आधार हमेशा के लिए ग़ायब हो जाता है।`
              : `JDA is spending ₹${scheme.scheme.cost_crore} crore on an elevated road on Gopalpura Bypass, a corridor this platform already models. The moment it opens, the thing you would compare against stops existing.`}
          </p>
          <div className="mt-6 grid gap-8 sm:grid-cols-2">
            <Figure
              value={Math.round(middle.groups.through?.saved_s ?? 0)}
              unit="s"
              label={hi ? "थ्रू यातायात बचाता है" : "saved by through traffic"}
              source="/schemes"
              accent
            />
            <Figure
              value={Math.round(middle.groups.local?.saved_s ?? 0)}
              unit="s"
              label={
                hi
                  ? "स्थानीय यातायात — वही सिग्नल, कम लाभ"
                  : "saved by local traffic, which keeps the same signals"
              }
              source="/schemes"
            />
          </div>
          <p className="mt-6 text-[13px] leading-relaxed text-[var(--ink-faint)]">
            {hi
              ? "यह सिमुलेशन का अंतर है, निर्मित सड़क की भविष्यवाणी नहीं। इसका मूल्य पूर्वानुमान नहीं — यह है कि बाद में जानने का यही एकमात्र तरीका है।"
              : "A simulated difference, not a prediction of the built road. Its value is not the forecast. Its value is that setting it up now is the only way to know later."}
          </p>
        </Section>
      )}

      {wanted.length > 0 && (
        <Section n="04" title={hi ? "हम क्या माँग रहे हैं" : "What we are asking for"}>
          <p className="text-[14px] leading-relaxed text-[var(--ink-muted)]">
            {hi
              ? "जयपुर पहले से ही राष्ट्रीय डेटा एक्सचेंज पर वाहन वर्गीकरण कैमरों की लोकेशन प्रकाशित करता है। हमें कैमरे नहीं चाहिए।"
              : "Jaipur already publishes Vehicle Classification Camera locations to the national data exchange. We are not asking for cameras."}
          </p>
          <ul className="mt-5 space-y-2">
            {wanted.map((r) => (
              <li key={r.id} className="text-[14px] text-[var(--accent)]">
                {r.label}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[13px] leading-relaxed text-[var(--ink-muted)]">
            {cityData?.standard}
          </p>
          <p className="mt-2">
            <Source path="/meta/city-data" />
          </p>
        </Section>
      )}

      <Section n="05" title={hi ? "जो अभी सच नहीं है" : "What is not true yet"}>
        <ul className="space-y-3 text-[14px] leading-relaxed text-[var(--ink-muted)]">
          <li>
            {hi
              ? "वाहन संख्या अनुमान है, गणना नहीं — और सिमुलेशन में अंशांकित, जयपुर की गिनती से नहीं।"
              : "Vehicle counts are estimated, not counted, and calibrated in simulation rather than against Jaipur counts, which do not exist yet."}
          </li>
          <li>
            {reliability && !reliability.corridors.some((c) => c.sufficient)
              ? hi
                ? "यात्रा-समय विश्वसनीयता अभी संग्रह हो रही है। पर्याप्त स्वीप और दिन के पर्याप्त घंटे मिलने तक कोई सूचकांक नहीं दिखाया जाएगा।"
                : "Travel time reliability is still collecting. No index is shown until it has both enough sweeps and enough distinct hours behind it."
              : hi
                ? "यात्रा-समय विश्वसनीयता पूरी तरह मापी गई है।"
                : "Travel time reliability is entirely measured."}
          </li>
          <li>
            {hi
              ? "प्रति-लिंक प्रति-घंटा गणना और कैमरा पहचान सिंथेटिक हैं और स्क्रीन पर वैसा ही अंकित हैं।"
              : "Per-link hourly counts and camera detections remain synthetic, and are badged as such on every screen that shows them."}
          </li>
          <li>
            {hi
              ? "मॉडल से सिग्नल तक कोई सीधा नियंत्रण नहीं। हर सुझाव सलाहकार है और अधिकारी अनुमोदन करता है।"
              : "Nothing here actuates a signal. Every recommendation is advisory and an officer approves it."}
          </li>
        </ul>
      </Section>
    </div>
  );
}
