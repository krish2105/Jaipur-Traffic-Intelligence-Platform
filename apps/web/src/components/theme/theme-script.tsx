import Script from "next/script";

/**
 * Runs before first paint. Sets both theme axes on <html> so there is no FOUC
 * and no flash of the wrong direction (docs/06 §6).
 *
 * Jaipur Night is the product palette (ADR-016) and dark is the control-room
 * native mode (docs/06 §6), so that is the default rather than the OS
 * preference — an officer opening this on a bright laptop should still get the
 * interface the product was designed in. Their explicit choice wins after that.
 *
 * The old `data-direction` attribute is gone: those were evaluation presets and
 * the evaluation is over. Leaving its default in place meant every page fell
 * back to tokens that no longer existed.
 */
const script = `(function(){try{
var d=document.documentElement;
var t=localStorage.getItem('pravaah-theme');
if(t!=='light'&&t!=='dark'){t='dark';}
d.setAttribute('data-theme',t);
d.setAttribute('data-palette','night');
d.setAttribute('data-scene',t==='light'?'day':'night');
}catch(e){
document.documentElement.setAttribute('data-theme','dark');
document.documentElement.setAttribute('data-palette','night');
document.documentElement.setAttribute('data-scene','night');
}})();`;

/**
 * Delivered through `next/script` with `strategy="beforeInteractive"`.
 *
 * A bare `<script>` rendered by a component makes React 19 warn — "scripts
 * inside React components are never executed when rendering on the client" —
 * and the warning is accurate: it runs on the server-rendered HTML but not
 * after a client navigation. That was the dev-overlay issue on every page.
 *
 * `beforeInteractive` is the supported App Router route for a pre-paint script
 * and must live in the root layout, which `[locale]/layout.tsx` is (it renders
 * <html>). An `id` is required for Next to track an inline script.
 *
 * The palette itself no longer depends on this at all (ADR-036) — Jaipur Night
 * is the CSS default at :root. This only applies a stored light/dark
 * preference, so the worst case if it never runs is that someone who chose
 * light mode gets dark until they toggle, rather than a page with no colours.
 */
export function ThemeScript() {
  return (
    <Script
      id="pravaah-theme"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
