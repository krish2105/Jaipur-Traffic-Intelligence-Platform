# 06 — Design System & Frontend

---

## 1. Design direction

Most government dashboards look like Bootstrap with a state emblem. Most AI-generated "premium" dashboards look like a dark screen with an acid-green accent. Both are defaults, not choices. This one has a thesis.

### The concept: Jantar Mantar

Jaipur has been an instrumentation city since 1734. Jai Singh II built the world's largest stone sundial here to *measure* what everyone else only observed. The Samrat Yantra reads time to two seconds using nothing but a calibrated stone arc and a shadow.

PRAVAAH is a measurement instrument for the same city, three centuries later. So the interface borrows from the yantras — calibrated arcs, brass gradations, the sweep of a gnomon's shadow, engraved numerals, the honesty of an instrument that shows its own scale.

This is not decoration. It solves a real design problem: how do you make a *counting* system feel authoritative rather than like another dashboard? By making it look like an instrument. And it gives you a line in the pitch room that no system integrator will have: *"we designed it after the Jantar Mantar, because Jaipur has been measuring things precisely for 300 years."* In that room, in that city, that lands.

### Tokens

```css
:root {
  /* Light — araish, the lime plaster of Jaipur's walls */
  --ground:        #F2EDE4;   /* araish plaster */
  --surface:       #FBF8F3;
  --surface-sunk:  #E7E0D3;
  --ink:           #1A1714;   /* engraved */
  --ink-muted:     #5C554B;
  --rule:          #CFC5B4;   /* gradation lines */

  /* Dark — basalt, the Jantar Mantar stone at night. Control-room native. */
  --ground-dk:     #14120F;
  --surface-dk:    #1D1A16;
  --surface-sunk-dk:#0D0B09;
  --ink-dk:        #F2EDE4;
  --ink-muted-dk:  #9A9184;
  --rule-dk:       #332E27;

  /* Instrument accents — used with discipline */
  --brass:         #C9A227;   /* the instrument. Primary accent, calibration, focus */
  --brass-dim:     #8A6F1B;
  --indigo:        #2B3A67;   /* the gnomon's shadow. Secondary, selection */
  --verdigris:     #3E8E7E;   /* free flow / good */
  --amber:         #D98A1F;   /* moderate congestion */
  --sindoor:       #C63D22;   /* severe / violation. Jaipur pigment, not generic terracotta */
  --sindoor-deep:  #8E2415;   /* critical */
}
```

**Discipline rule:** brass is the only accent that appears in more than one place. Verdigris/amber/sindoor are reserved *exclusively* for the congestion and severity scales — never for buttons, links, badges or decoration. The moment sindoor appears on a "Save" button, the colour stops meaning "danger" and the whole safety layer loses its signal.

Congestion ramp (fixed, published, used identically everywhere):
`0–25 verdigris · 26–50 #7FA05C · 51–70 amber · 71–85 sindoor · 86–100 sindoor-deep`

### Typography

- **Display + UI: Anek** (Anek Devanagari + Anek Latin). A variable superfamily built by the Indian Type Foundry specifically for Devanagari–Latin pairing. Not a default choice — it is *the correct* choice for a bilingual government product, and Hindi rendered in it looks designed rather than fallback-rendered.
- **Data / numerals: IBM Plex Mono.** Tabular figures for every measurement. Engraved-instrument feel, and monospace numerals stop values jittering as they update in real time.

```
Display  clamp(2.5rem, 5vw, 4.5rem) / 1.05 / weight 600 / -0.02em
H1       clamp(1.75rem, 3vw, 2.5rem) / 1.15 / 600
H2       1.5rem / 1.25 / 550
Body     1rem / 1.6 / 400
Caption  0.8125rem / 1.4 / 450 / +0.01em
Metric   clamp(2rem, 4vw, 3.25rem) / 1 / 500 / Plex Mono / tabular-nums
```

**Devanagari needs more line-height than Latin.** Set `line-height: 1.75` on `[lang="hi"]` body text or the matras collide. Test every screen in Hindi before calling it done — Hindi strings run 15–30% longer and will break any layout designed only in English.

### The signature element: the Gnomon

One memorable thing, executed well, everything else quiet.

**On the landing page:** a scroll-linked shadow sweeps across the hero as you scroll, exactly as the Samrat Yantra's gnomon shadow moves across its calibrated arc through the day. As it sweeps, it reveals the day's congestion profile beneath it — dawn free-flow, the 09:00 climb, the 18:00 wall.

**In the dashboard:** the primary time-of-day visualisation is a **calibrated arc**, not a bar chart. Hours run along the arc like the yantra's scale; congestion is the radial distance; brass gradation marks every hour; the current moment is a brass indicator on the arc. It reads instantly ("the evening bulge is bigger than the morning one") and it is unmistakably *this* product.

Everything else — tables, filters, maps, forms — is quiet, precise, unornamented. Spend the boldness once.

---

## 2. Stack

```
Next.js 15 (App Router) · TypeScript strict · Tailwind v4
Motion (motion/react) · Lenis (smooth scroll)
MapLibre GL + deck.gl (2D map, vector tiles)
React Three Fiber + @react-three/drei (3D corridor twin)
next-intl (i18n) · TanStack Query (server state) · Zustand (UI state)
Recharts (standard charts) · custom SVG (the arc)
```

**Do not use Google Maps.** MapLibre with self-hosted vector tiles: no per-load billing, works offline in the demo, no data leaves the network, and it removes the awkward moment where your Google-dependency-solving product depends on Google.

---

## 3. Screens

### Command centre (`/dashboard`)

```
┌──────────────────────────────────────────────────────────────┐
│ PRAVAAH  प्रवाह      [corridor ▾]  [live ●]   हिं|EN  ☾|☀  👤 │
├──────────────┬───────────────────────────────┬───────────────┤
│ CORRIDORS    │  MAP / 3D TWIN                │  RIGHT RAIL   │
│              │  ┌─────────────────────────┐  │ ┌───────────┐ │
│ ▸ Tonk Rd ●  │  │ congestion-coloured     │  │ │ Now       │ │
│   Ajmer Rd   │  │ links; camera pins;     │  │ │ 12,847 veh│ │
│   Sikar Rd   │  │ incident markers        │  │ │ 8,205 PCU │ │
│   JLN Marg   │  │ [2D ⇄ 3D]               │  │ │ ▲12% base │ │
│              │  └─────────────────────────┘  │ └───────────┘ │
│ ─── ALERTS ──│  ┌─────────────────────────┐  │ ┌───────────┐ │
│ ⚠ Gopalpura  │  │   GNOMON ARC            │  │ │ Class mix │ │
│   queue 340m │  │   calibrated day scale  │  │ │ 2W  61%   │ │
│ ⚠ Riddhi Sid │  │   ◜‾‾‾◝ now ▮           │  │ │ Car 24%   │ │
│   incident   │  └─────────────────────────┘  │ │ ...       │ │
│              │  ┌─────────────────────────┐  │ └───────────┘ │
│ ─── QUALITY ─│  │ FORECAST +15 +30 +60    │  │ ┌───────────┐ │
│ 6/6 cameras  │  │ with 80% bands          │  │ │ NEETI ▸   │ │
│ avg conf 0.91│  └─────────────────────────┘  │ └───────────┘ │
└──────────────┴───────────────────────────────┴───────────────┘
```

Routes: `/dashboard` · `/junctions/[id]` · `/corridors/[id]` · `/scenarios` · `/enforcement` (gated) · `/risk` · `/neeti` · `/reports` · `/admin/cameras`

### The 3D corridor twin

React Three Fiber. Extruded corridor geometry from the PostGIS linestring, junction blocks, animated vehicle particles whose density and speed are driven by *actual measured counts*, congestion colour applied to the road surface, camera frusta showing coverage, and click-to-inspect on any junction.

**Rules that keep it from being a liability:**
- Lazy-loaded behind a dynamic import. The dashboard is fully usable in 2D without it.
- WebGL feature-detected; no WebGL → 2D map, no error, no degraded message.
- Vehicle particles are instanced meshes, capped at 2,000, LOD by camera distance.
- `prefers-reduced-motion` → static 3D scene, no particle animation, no auto-orbit.
- Frame-budget guard: if FPS drops below 30 for 3 seconds, particles halve automatically.
- **Every particle is a real measurement, not decoration.** If counts are suppressed for low quality, that stretch renders greyed with a hatch pattern. The twin must never invent traffic it did not measure.

Three.js note: the target build is r128-compatible, so use `CylinderGeometry`/`SphereGeometry` rather than `CapsuleGeometry`, and avoid `OrbitControls` from the THREE namespace — use drei's.

---

## 4. Motion

Motion is narrative here, not decoration. Four orchestrated moments, nothing else:

1. **Dashboard entry** — staggered reveal, 60ms apart, map → metrics → arc → forecast. 400ms, `cubic-bezier(0.16, 1, 0.3, 1)`.
2. **Live value update** — numerals roll (Plex Mono tabular means no reflow), 300ms, with a 1px brass underline pulse. Never flash the whole card.
3. **The gnomon sweep** — scroll-linked on the landing page via `useScroll` + `useTransform` + `useSpring`.
4. **Alert arrival** — slides in, brass border pulses twice, settles. Critical alerts get one extra pulse and nothing more. No sound by default; control rooms have their own alarm discipline.

**Animate only `transform` and `opacity`.** No animated `width`/`height`/`top`/`left`; use Motion's `layout` prop for layout changes. `backdrop-filter` appears in exactly two places — top nav and modal scrim — because it costs 15–30% FPS on mid-tier Android and half the officers will be on mid-tier Android.

Everything gates on `useReducedMotion()` with a genuine static fallback.

---

## 5. Bilingual implementation

```
apps/web/messages/{en.json,hi.json}
```

Rules:
- No hardcoded user-facing string. Ever. `next-intl` from the first component.
- Numbers via `Intl.NumberFormat` with `en-IN` / `hi-IN` — **the Indian lakh/crore grouping is mandatory.** "12,84,700" not "1,284,700". Getting this wrong is the single most obvious tell that a product wasn't built for India, and a government audience spots it instantly.
- Dates via `Intl.DateTimeFormat`; offer a Vikram Samvat display toggle for official documents.
- Place names come from the database (`name_en` / `name_hi`), never from translation files, so "Tonk Road" and "टोंक रोड" resolve to the same `link_id`.
- `<html lang>` switches with the locale; `[lang="hi"]` carries its own line-height and letter-spacing.
- Layout must survive 30% longer strings. Test with the Hindi locale forced, at 360px width, before any screen ships.
- The language toggle sits in the top bar at all times — not buried in settings. Half the intended users will prefer Hindi and should never have to hunt for it.

---

## 6. Dark / light

Dark is designed first — it is the control-room native mode and where this product actually lives. Light is designed second, deliberately, using the araish palette. Neither is an inversion of the other.

```tsx
// Theme via class strategy + CSS vars. No FOUC:
// inline script in <head> reads localStorage, sets class before paint.
// Respects prefers-color-scheme on first visit, then user choice wins.
```

Persist to the user profile, not just localStorage, so an officer's choice follows them across the control room and their phone. The toggle animates the ground colour over 200ms; text does not cross-fade (it flickers).

---

## 7. 21st.dev Magic MCP usage

You already have this installed. Use it for **scaffolding, not for the signature work**.

Good uses: data tables with sorting and filtering, command palette, date-range picker, multi-select filters, toast system, modals and sheets, form controls, skeleton loaders.

Do **not** generate: the gnomon arc, the 3D twin, the congestion map, the alert rail, or anything carrying the design thesis. Generated components arrive with generic tokens and generic motion — they will quietly average your design back toward the template you are trying to escape.

Workflow: generate → immediately rewrite the styling against the tokens above → delete any inline colours → verify it renders correctly in Hindi and in both themes. Budget the rewrite; it is not optional.

---

## 8. Quality bar

Every screen, before it is called done:

- Responsive to 360px. Nothing clips or scrolls horizontally.
- Keyboard: visible brass focus ring, logical tab order, no traps, real `<button>`/`<a>`.
- `prefers-reduced-motion` honoured — parallax, particles and auto-orbit off, content fully usable.
- 60fps on scroll; only transform/opacity animating.
- No layout shift from loading or animation. Reserve space.
- Contrast ≥ 4.5:1 body, ≥ 3:1 large. Check brass on light — `#C9A227` on `#F2EDE4` fails for body text, so brass is for rules, focus rings and large numerals only, never small text.
- Screen-reader labels on every chart with a text summary alternative.
- **Renders correctly in Hindi.** This is a gate, not a nice-to-have.
- Every measurement displays its quality/confidence. No naked number ever.
