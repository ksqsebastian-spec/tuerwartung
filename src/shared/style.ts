/**
 * Ein Stylesheet für alles: Übersichtsseite und Anmeldeseiten der Server.
 *
 * Gestalterische Linie: viel Weiß, wenige Farben, harte Kontraste bei der Schrift,
 * Haarlinien statt Schatten für Struktur. Bewegung gibt es nur dort, wo sie etwas
 * bedeutet — Eintreten von Inhalt, Anheben bei Hover, Quittung beim Kopieren.
 * Nichts blinkt, nichts pulsiert, nichts bewegt sich von allein weiter.
 *
 * Die Akzentfarbe gehört dem jeweiligen System (HERO gelb, sevdesk rot) und kommt
 * ausschließlich in kleinen Flächen vor. Die Seite selbst bleibt schwarzweiß.
 */

/** Helligkeit einer Hex-Farbe → passende Textfarbe darauf. */
export function inkOn(hex: string): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? "#16161a" : "#ffffff";
}

export const BASE_CSS = `
:root {
  --ink: #131316;
  --ink-2: #6e6e78;
  --ink-3: #9b9ba4;
  --bg: #ffffff;
  --surface: #ffffff;
  --line: #e7e7ea;
  --line-strong: #d2d2d8;
  --wash: #f7f7f8;
  --focus: #131316;
  --radius: 18px;
  --ease: cubic-bezier(.22,.61,.25,1);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #f4f4f6;
    --ink-2: #a0a0aa;
    --ink-3: #70707a;
    --bg: #0b0b0d;
    --surface: #131316;
    --line: #26262c;
    --line-strong: #3a3a42;
    --wash: #17171b;
    --focus: #f4f4f6;
  }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 400 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

a { color: inherit; text-decoration: none; }
h1, h2, h3 { margin: 0; font-weight: 640; letter-spacing: -.028em; line-height: 1.12; }
p { margin: 0; }

/* ── Typografische Stufen ─────────────────────────────────────────────── */
.display { font-size: clamp(2.3rem, 6.2vw, 3.65rem); letter-spacing: -.042em; line-height: 1.03; font-weight: 660; }
.lede { font-size: clamp(1.05rem, 1.9vw, 1.28rem); color: var(--ink-2); line-height: 1.5; max-width: 34ch; }
.eyebrow {
  font-size: .74rem; font-weight: 620; letter-spacing: .13em; text-transform: uppercase;
  color: var(--ink-3);
}
.meta { font-size: .9rem; color: var(--ink-2); }
.mono, code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }

/* ── Raster ───────────────────────────────────────────────────────────── */
.wrap { max-width: 1040px; margin: 0 auto; padding: 0 28px; }
.narrow { max-width: 720px; }

/* ── Bewegung: nur beim Eintreten und bei Interaktion ─────────────────── */
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.rise { animation: rise .62s var(--ease) both; }
.d1 { animation-delay: .04s } .d2 { animation-delay: .09s } .d3 { animation-delay: .14s }
.d4 { animation-delay: .19s } .d5 { animation-delay: .24s } .d6 { animation-delay: .29s }

/* ── Kachel mit dem Systemkürzel ──────────────────────────────────────── */
.tile {
  width: 44px; height: 44px; border-radius: 13px; flex: 0 0 auto;
  display: grid; place-items: center;
  font-weight: 700; font-size: 19px; letter-spacing: -.03em;
}

/* ── Karten ───────────────────────────────────────────────────────────── */
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 26px;
  transition: transform .28s var(--ease), box-shadow .28s var(--ease), border-color .28s var(--ease);
}
a.card:hover, .card.hoverable:hover {
  transform: translateY(-3px);
  border-color: var(--line-strong);
  box-shadow: 0 14px 34px -14px rgba(0,0,0,.18);
}

/* ── Links mit Pfeil ──────────────────────────────────────────────────── */
.go { display: inline-flex; align-items: center; gap: .42em; font-weight: 560; font-size: .96rem; }
.go .arrow { transition: transform .28s var(--ease); }
.go:hover .arrow { transform: translateX(4px); }

/* ── URL-Feld mit Kopierknopf ─────────────────────────────────────────── */
.urlbar {
  display: flex; align-items: stretch; gap: 8px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--wash);
  padding: 5px 5px 5px 14px; transition: border-color .28s var(--ease);
}
.urlbar:focus-within { border-color: var(--line-strong); }
.urlbar input {
  flex: 1; min-width: 0; border: 0; background: transparent; color: var(--ink);
  font: 500 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 7px 0; outline: none;
}
.copy {
  border: 0; border-radius: 9px; padding: 7px 14px; cursor: pointer;
  background: var(--ink); color: var(--bg);
  font: 620 13px/1.4 inherit; letter-spacing: -.01em;
  transition: opacity .2s var(--ease), transform .2s var(--ease);
}
.copy:hover { opacity: .84; }
.copy:active { transform: scale(.96); }
.copy.done { background: #12833f; color: #fff; }

/* ── Eingabefelder ────────────────────────────────────────────────────── */
.field {
  width: 100%; padding: 13px 15px; font: 400 16px/1.5 inherit;
  border: 1px solid var(--line); border-radius: 12px;
  background: var(--surface); color: var(--ink);
  transition: border-color .2s var(--ease), box-shadow .2s var(--ease);
}
.field::placeholder { color: var(--ink-3); }
.field:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 14%, transparent); }

/* ── Knopf ────────────────────────────────────────────────────────────── */
.btn {
  display: block; width: 100%; padding: 14px 18px; border: 0; border-radius: 12px;
  background: var(--ink); color: var(--bg); cursor: pointer;
  font: 620 15.5px/1.4 inherit; letter-spacing: -.011em;
  transition: opacity .2s var(--ease), transform .2s var(--ease);
}
.btn:hover { opacity: .86; }
.btn:active { transform: scale(.988); }

/* ── Hinweise und Fehler ──────────────────────────────────────────────── */
.note { background: var(--wash); border-radius: 14px; padding: 18px 20px; font-size: .94rem; color: var(--ink-2); }
.note strong, .note b { color: var(--ink); font-weight: 600; }
.err {
  border-left: 2px solid #c8382f; background: color-mix(in srgb, #c8382f 7%, transparent);
  border-radius: 0 10px 10px 0; padding: 12px 16px; font-size: .93rem; color: var(--ink);
}

/* ── Trennlinien ──────────────────────────────────────────────────────── */
.rule { height: 1px; background: var(--line); border: 0; margin: 0; }

:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; border-radius: 4px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

/** Kopieren mit Quittung — die einzige Interaktion, die eine Rückmeldung braucht. */
export const COPY_JS = `
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () {
    var old = b.textContent;
    b.textContent = 'Kopiert';
    b.classList.add('done');
    setTimeout(function () { b.textContent = old; b.classList.remove('done'); }, 1500);
  });
});`;
