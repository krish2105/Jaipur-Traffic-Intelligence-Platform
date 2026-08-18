"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Locale } from "@/i18n/routing";

/**
 * ⌘K / Ctrl-K command palette.
 *
 * The console has eight sections, a theme, a language, a 2D/3D toggle and a
 * resizable rail. A control-room operator under load should not be hunting for
 * any of them with a mouse — docs/06 §3 makes keyboard reachability a
 * requirement, not a nicety, and in a room with a shared screen and a single
 * keyboard it is often the only usable input.
 *
 * Matching runs over BOTH languages regardless of the interface language. An
 * officer whose interface is Hindi may still type "signals", and one on the
 * English interface may type "प्रवर्तन". Refusing the other language would be
 * a bilingual product that is only bilingual one way at a time.
 */

export interface Command {
  id: string;
  en: string;
  hi: string;
  /** Extra terms that should match — English and Hindi both. */
  keywords?: string;
  hint?: string;
  group: "navigate" | "view" | "action";
  run: () => void;
}

const GROUP_LABEL: Record<Command["group"], { en: string; hi: string }> = {
  navigate: { en: "Go to", hi: "जाएँ" },
  view: { en: "View", hi: "दृश्य" },
  action: { en: "Action", hi: "कार्रवाई" },
};

function score(command: Command, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const haystacks = [command.en, command.hi, command.keywords ?? "", command.id];
  let best = 0;
  for (const raw of haystacks) {
    const h = raw.toLowerCase();
    if (h === q) best = Math.max(best, 100);
    else if (h.startsWith(q)) best = Math.max(best, 80);
    else if (h.includes(q)) best = Math.max(best, 50);
    else {
      // Subsequence match, so "encm" finds "Enforcement".
      let i = 0;
      for (const ch of h) if (ch === q[i]) i += 1;
      if (i === q.length) best = Math.max(best, 20);
    }
  }
  return best;
}

export function CommandPalette({
  commands,
  locale,
}: {
  commands: Command[];
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);

  // Global hotkey. Registered on window so it works wherever focus is —
  // including inside the WebGL canvas, which swallows most key handling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  // The dialog is mounted fresh each time rather than reset by an effect.
  // Resetting query and cursor in an effect is a cascading render — the
  // compiler flags it, and it is also simply the wrong tool: a component that
  // should start clean should be *created* clean.
  return <PaletteDialog commands={commands} locale={locale} onClose={() => setOpen(false)} />;
}

function PaletteDialog({
  commands,
  locale,
  onClose,
}: {
  commands: Command[];
  locale: Locale;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [rawCursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    return commands
      .map((c) => ({ c, s: score(c, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c);
  }, [commands, query]);

  // Clamped during render rather than corrected by an effect, so the cursor is
  // never briefly out of range while a re-render catches up.
  const cursor = Math.min(rawCursor, Math.max(0, results.length - 1));

  useEffect(() => {
    // Focus after paint: the input mounts in this same frame, and focusing
    // before the browser has laid it out is silently dropped.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const label = (c: Command) => (locale === "hi" ? c.hi : c.en);

  const runAt = (index: number) => {
    const command = results[index];
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label={locale === "hi" ? "कमांड पैलेट" : "Command palette"}
    >
      {/* The scrim is a button so a click anywhere outside closes it, and so
          the close affordance is reachable by keyboard rather than mouse-only. */}
      <button
        type="button"
        aria-label={locale === "hi" ? "बंद करें" : "Close"}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--scrim)] backdrop-blur-sm
                   motion-safe:animate-[fade_140ms_ease-out]"
      />
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-[var(--surface-2)]
                   motion-safe:animate-[rise_160ms_cubic-bezier(0.16,1,0.3,1)]"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="text-[var(--ink-faint)]">
            ⌘
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor(Math.min(results.length - 1, cursor + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor(Math.max(0, cursor - 1));
              }
              if (e.key === "Enter") {
                e.preventDefault();
                runAt(cursor);
              }
            }}
            placeholder={
              locale === "hi"
                ? "खोजें — अनुभाग, दृश्य, कार्रवाई"
                : "Search sections, views, actions"
            }
            aria-label={locale === "hi" ? "कमांड खोजें" : "Search commands"}
            className="w-full bg-transparent text-[var(--ink)] outline-none
                       placeholder:text-[var(--ink-faint)]"
            style={{ fontSize: "var(--d-body)" }}
          />
          <kbd
            className="shrink-0 rounded-md bg-[var(--surface-3)] px-1.5 py-0.5 font-mono
                       text-[10px] text-[var(--ink-faint)]"
          >
            esc
          </kbd>
        </div>

        <div className="h-px bg-[var(--rule)]" />

        <ul ref={listRef} className="max-h-[46vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <li
              className="px-3 py-6 text-center text-[var(--ink-faint)]"
              style={{ fontSize: "var(--d-support)" }}
            >
              {locale === "hi" ? "कोई परिणाम नहीं" : "No matches"}
            </li>
          )}
          {results.map((command, index) => {
            const previous = results[index - 1];
            const newGroup = !previous || previous.group !== command.group;
            return (
              <li key={command.id}>
                {newGroup && (
                  <p
                    className="px-3 pb-1 pt-3 uppercase tracking-[0.14em] text-[var(--ink-faint)]"
                    style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
                  >
                    {GROUP_LABEL[command.group][locale === "hi" ? "hi" : "en"]}
                  </p>
                )}
                <button
                  type="button"
                  data-index={index}
                  onMouseMove={() => setCursor(index)}
                  onClick={() => runAt(index)}
                  aria-current={index === cursor}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2
                             text-left text-[var(--ink-muted)] transition-colors
                             aria-[current=true]:bg-[var(--surface-3)]
                             aria-[current=true]:text-[var(--ink)]"
                  style={{ fontSize: "var(--d-support)" }}
                >
                  <span className="truncate">{label(command)}</span>
                  {command.hint && (
                    <kbd
                      className="shrink-0 rounded bg-[var(--surface-1)] px-1.5 py-0.5 font-mono
                                 text-[10px] text-[var(--ink-faint)]"
                    >
                      {command.hint}
                    </kbd>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** The trigger shown in the top bar, so the shortcut is discoverable at all. */
export function CommandHint({ locale }: { locale: Locale }) {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
        )
      }
      className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-[var(--surface-2)] px-2.5
                 py-1 text-[var(--ink-faint)] transition-colors hover:text-[var(--ink)]
                 sm:inline-flex"
      style={{ fontSize: "calc(var(--d-label) * 0.95)" }}
    >
      {locale === "hi" ? "खोजें" : "Search"}
      <kbd className="font-mono text-[10px]">⌘K</kbd>
    </button>
  );
}
