/**
 * Runs before first paint. Sets both theme axes on <html> so there is no FOUC
 * and no flash of the wrong direction (docs/06 §6).
 *
 * Order of precedence for theme: stored user choice > prefers-color-scheme.
 * Dark is the control-room native mode, but we still respect the OS on a
 * first visit and let the user's explicit choice win thereafter.
 */
const script = `(function(){try{
var d=document.documentElement;
var t=localStorage.getItem('pravaah-theme');
if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
d.setAttribute('data-theme',t);
var v=localStorage.getItem('pravaah-direction');
if(v!=='instrument'&&v!=='control'&&v!=='editorial'){v='instrument';}
d.setAttribute('data-direction',v);
}catch(e){
document.documentElement.setAttribute('data-theme','light');
document.documentElement.setAttribute('data-direction','instrument');
}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} suppressHydrationWarning />;
}
