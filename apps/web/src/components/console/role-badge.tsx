"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { Locale } from "@/i18n/routing";
import { ROLES, ROLE_LABEL, capabilitiesOf, signIn, signOut, useSession } from "@/lib/rbac";

/**
 * Who is signed in, and — in demo mode only — a switcher.
 *
 * The switcher exists because the single most common question in a government
 * demo is "what would my enforcement team see?", and the only convincing
 * answer is to become them for ten seconds. It is gated on `NEXT_PUBLIC_DEMO_MODE`
 * at build time and refused again by the API, which returns 403 for the
 * `X-Demo-Role` header whenever `DEMO_MODE` is off. A role switcher that
 * survives into production is an authentication bypass, not a convenience —
 * so it is disabled in two independent places rather than one.
 */
const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export function RoleBadge({ locale }: { locale: Locale }) {
  const hi = locale === "hi";
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => router.push(`/${locale}/login`)}
        className="shrink-0 rounded-lg bg-[var(--surface-2)] px-2.5 py-1 text-[var(--ink-muted)]
                   transition-colors hover:text-[var(--ink)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        {hi ? "साइन इन" : "Sign in"}
      </button>
    );
  }

  const initials = session.name.trim().slice(0, 1).toUpperCase() || "•";

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={ROLE_LABEL[session.role][hi ? "hi" : "en"]}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors
                   hover:bg-[var(--surface-2)]"
      >
        <span
          aria-hidden="true"
          className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--accent)]
                     font-medium text-[var(--accent-ink)]"
          style={{ fontSize: "calc(var(--d-label) * 0.95)" }}
        >
          {initials}
        </span>
        <span
          className="hidden max-w-[10rem] truncate text-[var(--ink-muted)] xl:inline"
          style={{ fontSize: "var(--d-support)" }}
        >
          {ROLE_LABEL[session.role][hi ? "hi" : "en"]}
        </span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={hi ? "बंद करें" : "Close"}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[60] cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-[61] mt-2 w-64 overflow-hidden rounded-xl
                       bg-[var(--surface-2)] motion-safe:animate-[rise_140ms_cubic-bezier(0.16,1,0.3,1)]"
            style={{ boxShadow: "var(--shadow-float)" }}
          >
            <div className="px-3.5 py-3">
              <p className="truncate text-[var(--ink)]" style={{ fontSize: "var(--d-support)" }}>
                {session.name}
              </p>
              <p
                className="mt-0.5 text-[var(--ink-faint)]"
                style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
              >
                {capabilitiesOf(session.role).length}{" "}
                {hi ? "अनुमतियाँ" : "capabilities"}
              </p>
            </div>

            {DEMO && (
              <>
                <div className="h-px bg-[var(--rule)]" />
                <div className="p-1.5">
                  <p
                    className="px-2 pb-1 pt-1.5 uppercase tracking-[0.14em] text-[var(--ink-faint)]"
                    style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
                  >
                    {hi ? "डेमो — भूमिका बदलें" : "Demo — switch role"}
                  </p>
                  {ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      role="menuitemradio"
                      aria-checked={role === session.role}
                      onClick={() => {
                        signIn({ role, name: session.name, corridors: session.corridors });
                        setOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5
                                 text-left text-[var(--ink-muted)] transition-colors
                                 hover:bg-[var(--surface-3)] hover:text-[var(--ink)]
                                 aria-[checked=true]:text-[var(--accent)]"
                      style={{ fontSize: "var(--d-support)" }}
                    >
                      <span className="truncate">{ROLE_LABEL[role][hi ? "hi" : "en"]}</span>
                      {role === session.role && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="h-px bg-[var(--rule)]" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                signOut();
                setOpen(false);
              }}
              className="w-full px-3.5 py-2.5 text-left text-[var(--ink-muted)] transition-colors
                         hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {hi ? "साइन आउट" : "Sign out"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
