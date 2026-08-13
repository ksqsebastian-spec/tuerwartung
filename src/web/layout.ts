/**
 * Seitengerüst und Gestaltung.
 *
 * Linie: viel Weiß, harte Kontraste, Haarlinien statt Schatten — dieselbe Sprache wie die
 * übrigen Werkzeuge des Hauses (mcpees/shared/src/style.ts), nur auf eine Arbeitsfläche statt
 * auf eine Anmeldeseite gezogen. Farbe trägt Bedeutung und sonst nichts: Schwarz für Handlung,
 * Rot für Mangel, Grün für fertig.
 *
 * Alles wird auf dem Server gerendert. Ein Monteur steht mit Handschuhen im Treppenhaus; eine
 * Seite, die erst nach dem Laden eines Frameworks etwas anzeigt, hilft ihm nicht.
 */
import { BASE_CSS } from "../shared/style";
import type { Nutzer } from "../auth/sitzung";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const MARKE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
<rect width="48" height="48" rx="13" fill="#131316"/>
<rect x="14" y="11" width="20" height="26" rx="2" fill="none" stroke="#fff" stroke-width="2.4"/>
<circle cx="29" cy="24" r="1.9" fill="#fff"/></svg>`;

const APP_CSS = `
body { padding-bottom: 80px; }
.kopf {
  position: sticky; top: 0; z-index: 10;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--line);
}
.kopf .innen { max-width: 1040px; margin: 0 auto; padding: 14px 28px; display: flex; align-items: center; gap: 16px; }
.kopf .logo { width: 30px; height: 30px; border-radius: 9px; }
.kopf .titel { font-weight: 660; letter-spacing: -.025em; font-size: 16px; }
.kopf nav { margin-left: auto; display: flex; align-items: center; gap: 22px; font-size: .93rem; }
.kopf nav a { color: var(--ink-2); font-weight: 520; }
.kopf nav a:hover, .kopf nav a[aria-current] { color: var(--ink); }
.kopf .wer { font-size: .84rem; color: var(--ink-3); }

main.wrap { padding-top: 42px; }
.zeile { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.zeile.oben { justify-content: space-between; margin-bottom: 26px; }
h1.seite { font-size: clamp(1.9rem, 4vw, 2.5rem); letter-spacing: -.038em; }
h2.abschnitt { font-size: 1.06rem; letter-spacing: -.02em; margin: 40px 0 14px; }
.leer { border: 1px dashed var(--line-strong); border-radius: var(--radius); padding: 46px 28px; text-align: center; color: var(--ink-2); }

/* ── Liste ────────────────────────────────────────────────────────────── */
.liste { border-top: 1px solid var(--line); }
.posten {
  display: flex; align-items: center; gap: 18px;
  padding: 17px 4px; border-bottom: 1px solid var(--line);
  transition: background .18s var(--ease);
}
a.posten:hover { background: var(--wash); }
.posten .haupt { min-width: 0; flex: 1; }
.posten .name { font-weight: 600; letter-spacing: -.015em; }
.posten .unter { font-size: .86rem; color: var(--ink-2); margin-top: 2px; }
.posten .nr {
  flex: 0 0 auto; width: 38px; height: 38px; border-radius: 10px; background: var(--wash);
  display: grid; place-items: center; font-weight: 660; font-size: .95rem;
}

/* ── Merkmale ─────────────────────────────────────────────────────────── */
.chip {
  display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
  border: 1px solid var(--line-strong); border-radius: 999px;
  padding: 3px 11px; font-size: .78rem; font-weight: 580; letter-spacing: -.005em;
  white-space: nowrap;
}
.chip.voll { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.chip.mangel { border-color: #c8382f; color: #c8382f; }
.chip.gut { border-color: #12833f; color: #12833f; }

/* ── Formular ─────────────────────────────────────────────────────────── */
form.karte { border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; }
.felder { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px 20px; }
.feld label { display: block; font-weight: 600; font-size: .82rem; margin-bottom: 6px; letter-spacing: -.005em; }
.feld .hinweis { font-size: .78rem; color: var(--ink-3); margin-top: 5px; }
textarea.field { min-height: 92px; resize: vertical; font: inherit; }
select.field { appearance: none; background-image: none; }
.knopfleiste { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 26px; }
.btn { width: auto; }
.btn.schmal { padding: 11px 18px; font-size: 14.5px; }
.btn.leise { background: transparent; color: var(--ink); border: 1px solid var(--line-strong); }
.btn.gefahr { background: transparent; color: #c8382f; border: 1px solid color-mix(in srgb, #c8382f 40%, transparent); }
.btn:disabled { opacity: .45; cursor: default; }

/* ── Prüfpunkt-Raster ─────────────────────────────────────────────────── */
.punkte { border-top: 1px solid var(--line); margin-top: 8px; }
.punkt { display: flex; align-items: center; gap: 14px; padding: 10px 2px; border-bottom: 1px solid var(--line); }
.punkt .txt { flex: 1; min-width: 0; font-size: .93rem; line-height: 1.4; }
.punkt .txt b { font-weight: 640; margin-right: 8px; }
.wahl { display: flex; gap: 4px; flex: 0 0 auto; }
.wahl label {
  cursor: pointer; border: 1px solid var(--line-strong); border-radius: 8px;
  padding: 5px 9px; font-size: .74rem; font-weight: 620; letter-spacing: .02em;
  color: var(--ink-3); user-select: none; transition: all .16s var(--ease);
}
.wahl input { position: absolute; opacity: 0; pointer-events: none; }
.wahl input:checked + span { }
.wahl label:has(input:checked) { background: var(--ink); border-color: var(--ink); color: var(--bg); }
.wahl label:has(input[value="nio"]:checked) { background: #c8382f; border-color: #c8382f; }
.wahl label:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }

/* ── Kennzahlen ───────────────────────────────────────────────────────── */
.zahlen { display: flex; gap: 34px; flex-wrap: wrap; margin: 4px 0 30px; }
.zahl .wert { font-size: 1.9rem; font-weight: 660; letter-spacing: -.04em; line-height: 1; }
.zahl .was { font-size: .8rem; color: var(--ink-3); margin-top: 6px; letter-spacing: .02em; }

.stand { font-size: .9rem; color: var(--ink-2); }
.stand.laeuft::after { content: ""; display: inline-block; width: 6px; height: 6px; margin-left: 8px; border-radius: 50%; background: var(--ink); animation: puls 1s infinite; }
@keyframes puls { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }

@media (max-width: 620px) {
  .wrap { padding: 0 18px; }
  .kopf .innen { padding: 12px 18px; gap: 12px; }
  .kopf nav { gap: 14px; font-size: .88rem; }
  .kopf .wer { display: none; }
  .punkt { flex-wrap: wrap; }
  .wahl { width: 100%; }
  .wahl label { flex: 1; text-align: center; }
}
`;

export interface SeitenOptionen {
  titel: string;
  nutzer?: Nutzer | null;
  aktiv?: string;
  /** Zusätzliches Skript am Seitenende. */
  skript?: string;
  status?: number;
}

export function seite(inhalt: string, opt: SeitenOptionen): Response {
  const logo = `data:image/svg+xml;base64,${btoa(MARKE)}`;
  const nav = opt.nutzer
    ? `<nav>
<a href="/wartungen"${opt.aktiv === "wartungen" ? ' aria-current="page"' : ""}>Wartungen</a>
<a href="/verbinden"${opt.aktiv === "verbinden" ? ' aria-current="page"' : ""}>Claude</a>
<a href="/einstellungen"${opt.aktiv === "einstellungen" ? ' aria-current="page"' : ""}>Einstellungen</a>
<span class="wer">${esc(opt.nutzer.name)}</span>
<a href="/abmelden" class="wer">Abmelden</a></nav>`
    : "";

  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opt.titel)} · Türenwartung</title>
<link rel="icon" href="${logo}">
<meta name="theme-color" content="#ffffff">
<style>${BASE_CSS}${APP_CSS}</style></head><body>
<header class="kopf"><div class="innen">
<img class="logo" src="${logo}" alt="" width="30" height="30">
<a href="/" class="titel">Türenwartung</a>${nav}
</div></header>
<main class="wrap rise">${inhalt}</main>
${opt.skript ? `<script>${opt.skript}</script>` : ""}
</body></html>`;

  return new Response(html, {
    status: opt.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export function fehlerSeite(titel: string, text: string, status = 400): Response {
  return seite(
    `<h1 class="seite">${esc(titel)}</h1>
     <div class="err" style="margin-top:18px;max-width:520px">${esc(text)}</div>
     <div class="knopfleiste"><a class="btn schmal leise" href="/wartungen">Zur Übersicht</a></div>`,
    { titel, status },
  );
}

export function umleitung(nach: string, cookie?: string): Response {
  const headers: Record<string, string> = { location: nach, "cache-control": "no-store" };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(null, { status: 302, headers });
}
