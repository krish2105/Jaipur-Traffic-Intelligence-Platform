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
 * Delivered through next/script, not a raw <script> element.
 *
 * React 19 refuses to render a script tag inside a component — it never
 * executes it on the client — and the result was a hydration failure on every
 * page, which in turn blanked the 3D scene. `beforeInteractive` is the
 * supported way to run something ahead of paint, which is what a no-FOUC theme
 * script needs.
 */
export function ThemeScript() {
  return (
    // Rendered as the first child of <body> by the layout. See the comment
    // there: <head> placement loses the attributes to hydration.
    //
    // The palette itself no longer depends on this script at all (ADR-036) —
    // Jaipur Night is the CSS default at :root. This only applies a stored
    // light/dark preference, so the worst case if it never runs is that an
    // officer who chose light mode gets dark until they toggle, rather than a
    // page with no colours.
    <script
      id="pravaah-theme"
      dangerouslySetInnerHTML={{ __html: script }}
      suppressHydrationWarning
    />
  );
}
