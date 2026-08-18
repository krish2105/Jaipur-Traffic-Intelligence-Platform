"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

import type { Locale } from "@/i18n/routing";
import { ROLES, ROLE_LABEL, capabilitiesOf, signIn, type Role } from "@/lib/rbac";
import { ThemeToggle } from "@/components/console/theme-toggle";

/**
 * Sign-in.
 *
 * **No password is collected here, and that is deliberate.** In deployment this
 * screen redirects to Keycloak, federated to the state SSO, with MFA mandatory
 * for any role touching P2 data (docs/07 §5). A demo that asks an official to
 * type a password teaches them that this product handles credentials in its own
 * form — the exact habit that makes a government workforce phishable. So the
 * demo path selects a role instead, and says so on screen.
 *
 * The role list is the point of the screen rather than a detail of it. "What
 * will my enforcement team actually see?" is the question that decides a
 * procurement, and it is answered here by picking their role and looking.
 */

const CAP_LABEL: Record<string, { en: string; hi: string }> = {
  "read:traffic": { en: "Live traffic & map", hi: "लाइव यातायात और मानचित्र" },
  "read:analytics": { en: "Historical analysis", hi: "ऐतिहासिक विश्लेषण" },
  "read:signals": { en: "Signal advisories", hi: "सिग्नल सलाह" },
  "approve:signals": { en: "Approve signal plans", hi: "सिग्नल योजना स्वीकृति" },
  "read:enforcement": { en: "Violation queue", hi: "उल्लंघन सूची" },
  "review:violations": { en: "Review violations", hi: "उल्लंघन समीक्षा" },
  "unmask:plate": { en: "Reveal plate (audited)", hi: "नंबर प्लेट देखें (लेखा-परीक्षित)" },
  "read:defaulters": { en: "Defaulter scores", hi: "डिफॉल्टर स्कोर" },
  "use:neeti": { en: "NEETI policy assistant", hi: "नीति सहायक" },
  "read:audit": { en: "Audit log", hi: "लेखा-परीक्षा लॉग" },
  "admin:sources": { en: "Source configuration", hi: "स्रोत विन्यास" },
};

export function LoginView() {
  const locale = useLocale() as Locale;
  const hi = locale === "hi";
  const router = useRouter();
  const [role, setRole] = useState<Role>("traffic_officer");
  const [name, setName] = useState("");

  const caps = capabilitiesOf(role);

  return (
    <main className="grid min-h-dvh bg-[var(--ground)] text-[var(--ink)] lg:grid-cols-[1.1fr_1fr]">
      {/* ── the argument, not decoration ────────────────────────────────── */}
      <section className="relative hidden overflow-hidden bg-[var(--surface)] p-12 lg:block">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            background:
              "radial-gradient(60% 50% at 20% 10%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%)," +
              "radial-gradient(50% 45% at 85% 80%, color-mix(in oklab, var(--congestion-critical) 16%, transparent), transparent 70%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-2xl tracking-tight">PRAVAAH</span>
            <span className="text-lg text-[var(--ink-muted)]" lang="hi">
              प्रवाह
            </span>
          </div>

          <div className="max-w-lg">
            <h1 className="font-display text-[clamp(2rem,3.2vw,3.25rem)] leading-[1.08] tracking-tight">
              {hi
                ? "जयपुर की सड़कों का मापा हुआ सच।"
                : "A measured account of Jaipur's roads."}
            </h1>
            <p className="mt-5 text-[var(--ink-muted)]" style={{ fontSize: "var(--d-body)" }}>
              {hi
                ? "प्रोब डेटा केवल देरी बताता है। यह मंच वाहन गिनता है, उनका वर्ग पहचानता है, और हर आँकड़े के साथ उसकी गुणवत्ता दिखाता है।"
                : "Probe data reports delay. This platform counts vehicles, classifies them, and shows the quality of every figure beside the figure."}
            </p>

            <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-[var(--rule)] pt-6">
              {[
                { v: "94.9%", en: "peak congestion", hi: "शीर्ष भीड़" },
                { v: "18,578", en: "crashes analysed", hi: "दुर्घटनाएँ विश्लेषित" },
                { v: "6,430", en: "lives lost", hi: "जानें गईं" },
              ].map((s) => (
                <div key={s.v}>
                  <dt className="font-mono text-2xl tabular-nums">{s.v}</dt>
                  <dd
                    className="mt-1 text-[var(--ink-muted)]"
                    style={{ fontSize: "var(--d-support)" }}
                  >
                    {hi ? s.hi : s.en}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="text-[var(--ink-faint)]" style={{ fontSize: "var(--d-support)" }}>
            {hi
              ? "राजस्थान सरकार के लिए बनाया गया · सभी आँकड़े अनुरूपित, स्पष्ट रूप से चिह्नित"
              : "Built for the Government of Rajasthan · all figures simulated and badged as such"}
          </p>
        </div>
      </section>

      {/* ── the form ────────────────────────────────────────────────────── */}
      <section className="flex flex-col justify-center p-6 sm:p-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-baseline gap-2 lg:hidden">
              <span className="font-display text-xl tracking-tight">PRAVAAH</span>
              <span className="text-[var(--ink-muted)]" lang="hi">
                प्रवाह
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <a
                href={hi ? "/en/login" : "/hi/login"}
                className="rounded-lg px-2.5 py-1 text-[var(--ink-muted)] transition-colors
                           hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                style={{ fontSize: "var(--d-support)" }}
              >
                {hi ? "English" : "हिन्दी"}
              </a>
              <ThemeToggle />
            </div>
          </div>

          <h2 className="font-display text-2xl tracking-tight">
            {hi ? "साइन इन करें" : "Sign in"}
          </h2>

          <div
            className="mt-4 rounded-xl bg-[var(--surface-2)] p-3.5 text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-support)", boxShadow: "var(--rim)" }}
          >
            <p>
              <span className="text-[var(--accent)]">
                {hi ? "डेमो मोड" : "Demo mode"}
              </span>{" "}
              {hi
                ? "— यह स्क्रीन कोई पासवर्ड नहीं माँगती। तैनाती में यह Keycloak और राज्य SSO पर जाती है, P2 डेटा वाली हर भूमिका के लिए MFA अनिवार्य।"
                : "— this screen collects no password. In deployment it redirects to Keycloak federated to the state SSO, with MFA mandatory for any role touching P2 data."}
            </p>
          </div>

          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              signIn({
                role,
                name: name.trim() || ROLE_LABEL[role][hi ? "hi" : "en"],
                corridors: [],
              });
              router.push(`/${locale}/console`);
            }}
          >
            <label className="block">
              <span
                className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-label)" }}
              >
                {hi ? "नाम (वैकल्पिक)" : "Name (optional)"}
              </span>
              <input
                aria-label={hi ? "अधिकारी का नाम" : "Officer name"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                placeholder={hi ? "जैसे, श्री शर्मा" : "e.g. Mr Sharma"}
                className="mt-1.5 w-full rounded-xl bg-[var(--surface-2)] px-3.5 py-2.5
                           text-[var(--ink)] outline-none transition-shadow
                           placeholder:text-[var(--ink-faint)]
                           focus:ring-2 focus:ring-[var(--accent)]"
                style={{ fontSize: "var(--d-body)", boxShadow: "var(--rim)" }}
              />
            </label>

            <fieldset className="mt-6">
              <legend
                className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-label)" }}
              >
                {hi ? "भूमिका" : "Role"}
              </legend>
              <div className="mt-2 grid gap-1.5">
                {ROLES.map((r) => (
                  <label
                    key={r}
                    className="flex cursor-pointer items-center gap-3 rounded-xl px-3.5 py-2.5
                               transition-colors has-[:checked]:bg-[var(--surface-3)]
                               hover:bg-[var(--surface-2)]"
                    style={{ boxShadow: r === role ? "var(--rim)" : undefined }}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={r}
                      checked={role === r}
                      onChange={() => setRole(r)}
                      className="size-3.5 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1" style={{ fontSize: "var(--d-body)" }}>
                      {ROLE_LABEL[r][hi ? "hi" : "en"]}
                    </span>
                    <span
                      className="shrink-0 font-mono tabular-nums text-[var(--ink-faint)]"
                      style={{ fontSize: "var(--d-support)" }}
                    >
                      {capabilitiesOf(r).length}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* What this role can do, updating as they choose. The honest
                answer to "what will my team see?" is a list, shown before
                signing in rather than discovered afterwards. */}
            <div className="mt-5 rounded-xl bg-[var(--surface-2)] p-3.5" style={{ boxShadow: "var(--rim)" }}>
              <p
                className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
                style={{ fontSize: "var(--d-label)" }}
              >
                {hi ? "इस भूमिका की पहुँच" : "This role can"}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {caps.map((c) => (
                  <li
                    key={c}
                    className="rounded-full bg-[var(--surface-3)] px-2.5 py-1 text-[var(--ink-muted)]"
                    style={{ fontSize: "var(--d-support)" }}
                  >
                    {CAP_LABEL[c]?.[hi ? "hi" : "en"] ?? c}
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="submit"
              className="mt-6 w-full rounded-xl bg-[var(--accent)] px-4 py-3 font-medium
                         text-[var(--accent-ink)] transition-transform
                         motion-safe:hover:-translate-y-px active:translate-y-0"
              style={{ fontSize: "var(--d-body)" }}
            >
              {hi ? "कंसोल खोलें" : "Enter the console"}
            </button>
          </form>

          <p
            className="mt-6 text-[var(--ink-faint)]"
            style={{ fontSize: "var(--d-support)" }}
          >
            {hi
              ? "भूमिका इंटरफ़ेस को आकार देती है, पर उसकी रक्षा नहीं करती। हर अनुरोध सर्वर पर दोबारा जाँचा जाता है और Postgres RLS द्वारा लागू होता है।"
              : "The role shapes this interface but does not secure it. Every request is checked again on the server and enforced by Postgres row-level security."}
          </p>
        </div>
      </section>
    </main>
  );
}
