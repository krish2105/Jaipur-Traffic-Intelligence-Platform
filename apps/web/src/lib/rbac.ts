"use client";

import { useSyncExternalStore } from "react";

/**
 * Role-based access control, client side.
 *
 * **This is a rendering aid, not a security boundary.** Every capability below
 * is enforced again server-side by `request_scope` and by Postgres RLS
 * (docs/07 §4). Hiding a control the user cannot use is good interface design;
 * relying on that hiding for access control is how products get breached,
 * because the API is reachable without the interface. Both layers exist, and
 * the server one is the one that counts.
 *
 * The seven roles mirror `VALID_ROLES` in `apps/api/.../deps.py` exactly. If
 * they drift, the interface offers a role the server rejects.
 */

export const ROLES = [
  "viewer",
  "analyst",
  "traffic_officer",
  "enforcement_officer",
  "enforcement_supervisor",
  "data_admin",
  "auditor",
] as const;

export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  /** See measured counts, congestion, the map. The baseline. */
  "read:traffic",
  /** Historical analysis, weekly matrices, model diagnostics. */
  "read:analytics",
  /** Signal timing advisories. Reading them is not applying them. */
  "read:signals",
  /** Record that an advisory was applied. Human-in-the-loop, docs/07 §6. */
  "approve:signals",
  /** The violation queue, with plates masked. */
  "read:enforcement",
  /** Confirm or reject a violation — the act that creates a challan. */
  "review:violations",
  /** Reveal a plate. Requires a reason code and writes an audit row first. */
  "unmask:plate",
  /** Defaulter scores. A road-safety targeting tool, not a revenue one. */
  "read:defaulters",
  /** The NEETI policy assistant and its generated SQL. */
  "use:neeti",
  /** The immutable audit log. */
  "read:audit",
  /** Source configuration, keys, retention. */
  "admin:sources",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const MATRIX: Record<Role, readonly Capability[]> = {
  viewer: ["read:traffic"],
  analyst: ["read:traffic", "read:analytics", "read:signals", "use:neeti"],
  traffic_officer: [
    "read:traffic",
    "read:analytics",
    "read:signals",
    "approve:signals",
    "use:neeti",
  ],
  enforcement_officer: ["read:traffic", "read:enforcement", "review:violations"],
  enforcement_supervisor: [
    "read:traffic",
    "read:analytics",
    "read:enforcement",
    "review:violations",
    // Only this role may see a registration number, and only with a reason
    // code that is written to the audit log BEFORE the plate is returned.
    "unmask:plate",
    "read:defaulters",
  ],
  data_admin: ["read:traffic", "read:analytics", "admin:sources", "read:audit"],
  auditor: ["read:traffic", "read:audit", "read:analytics"],
};

export const ROLE_LABEL: Record<Role, { en: string; hi: string }> = {
  viewer: { en: "Viewer", hi: "दर्शक" },
  analyst: { en: "Analyst", hi: "विश्लेषक" },
  traffic_officer: { en: "Traffic officer", hi: "यातायात अधिकारी" },
  enforcement_officer: { en: "Enforcement officer", hi: "प्रवर्तन अधिकारी" },
  enforcement_supervisor: { en: "Enforcement supervisor", hi: "प्रवर्तन पर्यवेक्षक" },
  data_admin: { en: "Data administrator", hi: "डेटा प्रशासक" },
  auditor: { en: "Auditor", hi: "लेखा परीक्षक" },
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role].includes(capability);
}

export function capabilitiesOf(role: Role): readonly Capability[] {
  return MATRIX[role];
}

/* ────────────────────────────────────────────────────────────────────────
   Session. Demo mode only.

   A real deployment replaces this entirely with a Keycloak OIDC session and a
   verified access token (docs/07 §5). Nothing here reads a password or holds a
   credential; the demo "sign in" selects a role so an official can see what
   each of their staff would see, which is the single most requested thing in a
   government demo.
   ──────────────────────────────────────────────────────────────────────── */

export interface Session {
  role: Role;
  name: string;
  /** Corridor ids this session is scoped to. Empty means all. */
  corridors: readonly number[];
  demo: true;
}

const KEY = "pravaah-session";
const listeners = new Set<() => void>();
let cache: Session | null = null;
let cacheRaw: string | null = null;

function read(): Session | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) {
    cache = null;
    cacheRaw = null;
    return null;
  }
  // useSyncExternalStore compares snapshots by identity, so parsing on every
  // call would return a new object each time and loop forever. Cache on the
  // raw string.
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    try {
      const parsed = JSON.parse(raw) as Session;
      cache = ROLES.includes(parsed.role) ? parsed : null;
    } catch {
      cache = null;
    }
  }
  return cache;
}

export function subscribeSession(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function signIn(session: Omit<Session, "demo">): void {
  localStorage.setItem(KEY, JSON.stringify({ ...session, demo: true }));
  listeners.forEach((cb) => cb());
}

export function signOut(): void {
  localStorage.removeItem(KEY);
  listeners.forEach((cb) => cb());
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    subscribeSession,
    read,
    () => null,
  );
}

/** `can`, bound to the active session. Absent session grants nothing. */
export function useCan(): (capability: Capability) => boolean {
  const session = useSession();
  return (capability) => (session ? can(session.role, capability) : false);
}
