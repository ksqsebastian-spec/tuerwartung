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

/**
 * Die Bildmarke: das Türsymbol aus dem Grundriss — Wand, offen stehendes Blatt, Schwenkbogen.
 * Wer Baupläne liest, erkennt es sofort, und niemand sonst führt es als Zeichen. Aufgebaut wie
 * die Marken im Hub (mcpees/shared/src/marks.ts): Zeichen mittig auf abgerundeter Fläche.
 */
export const MARKE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#1B54D6"/>
<g transform="translate(9 13.3) scale(.72)"><g fill="none" stroke="#fff">
<path stroke-width="9" stroke-linecap="butt" d="M0 46h14M50 46h14"/>
<path stroke-width="9" stroke-linecap="round" d="M14 46V10"/>
<path stroke-width="5" stroke-linecap="round" opacity=".85" d="M14 10a36 36 0 0 1 36 36"/>
</g></g></svg>`;

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
.chip.bald { border-color: #a9761b; color: #a9761b; }
.chip.leise { border-color: var(--line); color: var(--ink-3); }

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

/* ── Reiter ───────────────────────────────────────────────────────────── */
.reiter { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin: 6px 0 22px; }
.reiter a, .reiter button {
  appearance: none; background: none; border: 0; cursor: pointer;
  font: inherit; font-size: .95rem; font-weight: 560; color: var(--ink-3);
  padding: 10px 14px; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.reiter a:hover, .reiter button:hover { color: var(--ink); }
.reiter a[aria-current], .reiter button[aria-selected="true"] {
  color: var(--ink); border-bottom-color: var(--ink);
}

/* ── Checkliste: eine Hand, ein Blick ─────────────────────────────────── */
.fortschritt { display: flex; align-items: baseline; gap: 12px; margin: 2px 0 18px; }
.fortschritt b { font-size: 1.7rem; font-weight: 660; letter-spacing: -.04em; }
.balken { height: 6px; border-radius: 999px; background: var(--wash); overflow: hidden; margin-bottom: 24px; }
.balken i { display: block; height: 100%; background: var(--ink); border-radius: 999px; }
.dran {
  border: 1px solid var(--ink); border-radius: var(--radius); padding: 20px 22px; margin-bottom: 22px;
}
.dran .was { font-size: .78rem; color: var(--ink-3); letter-spacing: .04em; }
.dran .wer { font-size: 1.6rem; font-weight: 660; letter-spacing: -.03em; margin-top: 6px; }
.dran .wo { color: var(--ink-2); margin-top: 4px; }
.haken { border-top: 1px solid var(--line); }
.haken .reihe {
  display: flex; align-items: center; gap: 16px; padding: 15px 4px;
  border-bottom: 1px solid var(--line); font-size: 1.05rem;
}
.haken .reihe .marke {
  flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%;
  border: 1.5px solid var(--line-strong); display: grid; place-items: center;
  font-size: .8rem; font-weight: 700; color: var(--ink-3);
}
.haken .reihe.fertig { color: var(--ink-3); }
.haken .reihe.fertig .marke { background: var(--ink); border-color: var(--ink); color: var(--bg); }
.haken .reihe.abweichung .marke { background: #c8382f; border-color: #c8382f; color: #fff; }
.haken .reihe .txt { flex: 1; min-width: 0; }
.haken .reihe .txt small { display: block; font-size: .82rem; color: var(--ink-3); margin-top: 2px; }
.punktliste .reihe { align-items: flex-start; }
.punktliste .reihe .marke { border-radius: 9px; }

/* ── Rundgang ─────────────────────────────────────────────────────────── */
.rundkopf {
  position: sticky; top: 0; z-index: 10; background: var(--bg);
  border-bottom: 1px solid var(--line); margin: 0 -18px 18px; padding: 12px 18px;
  display: flex; align-items: center; gap: 12px;
}
.rundkopf .name { font-weight: 640; letter-spacing: -.02em; flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.abgleich { font-size: .8rem; color: #12833f; white-space: nowrap;
  background: none; border: 0; font-family: inherit; padding: 4px 0; }
.abgleich.wartet { color: #a9761b; }
/*
 * Die Leiste steht am Ende der Liste, nicht schwebend darüber: ein Balken über dem Inhalt
 * verdeckt genau die Zeilen, die man antippen will — und „Unbekannte Tür" statt „Tür 7" ist
 * ein teurer Fehlgriff. Der Abgleichsstand steht dafür oben in der Kopfzeile und ist selbst
 * der Knopf zum Abgleichen.
 */
.fussleiste {
  border-top: 1px solid var(--line);
  margin: 26px -18px 0; padding: 18px; display: flex; gap: 10px; flex-wrap: wrap;
}
.abgleich { cursor: pointer; }
button.reihe { width: 100%; text-align: left; background: none; font: inherit; color: inherit; cursor: pointer; }

/* ── Tagestour ────────────────────────────────────────────────────────── */
.woche { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
.tag { border: 1px solid var(--line); border-radius: 14px; padding: 10px; min-height: 130px; }
.tag.heute { border-color: var(--ink); }
.tag.ziel { background: var(--wash); border-color: var(--ink); }
.tag header { font-size: .82rem; margin-bottom: 8px; }
.leerer-tag { color: var(--ink-3); font-size: .8rem; padding: 6px 0; }
.tourposten { border-top: 1px solid var(--line); padding: 8px 0; font-size: .84rem; }
.tourposten:first-of-type { border-top: 0; }
.tourposten .haupt small { display: block; color: var(--ink-3); font-size: .76rem; margin-top: 2px; }
.tourposten .knoepfchen { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.tourposten .knoepfchen button {
  appearance: none; background: none; cursor: pointer; font: inherit; font-size: .74rem;
  border: 1px solid var(--line-strong); border-radius: 7px; padding: 2px 7px; color: var(--ink-2);
}
.tourposten .knoepfchen button:hover { border-color: var(--ink); color: var(--ink); }
.tourposten .knoepfchen button.stark { border-color: var(--ink); color: var(--ink); }
.tag .route { margin-top: 10px; display: block; text-align: center; }
.offene-liste { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.offene-liste .tourposten { border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
@media (max-width: 900px) {
  .woche { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* ── Kennzahlen ───────────────────────────────────────────────────────── */
.zahlen { display: flex; gap: 34px; flex-wrap: wrap; margin: 4px 0 30px; }
.zahl .wert { font-size: 1.9rem; font-weight: 660; letter-spacing: -.04em; line-height: 1; }
.zahl .was { font-size: .8rem; color: var(--ink-3); margin-top: 6px; letter-spacing: .02em; }

.stand { font-size: .9rem; color: var(--ink-2); }
.stand.laeuft::after { content: ""; display: inline-block; width: 6px; height: 6px; margin-left: 8px; border-radius: 50%; background: var(--ink); animation: puls 1s infinite; }
@keyframes puls { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }

@media (max-width: 620px) {
  .wrap { padding: 0 18px; }
  /* Vier Ziele passen auf einem Telefon nicht neben die Marke — also darunter, ganze Breite. */
  .kopf .innen { padding: 12px 18px; gap: 12px; flex-wrap: wrap; }
  .kopf nav { gap: 18px; font-size: .9rem; width: 100%; margin-left: 0; }
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
  /** Attribute am `body` — der Rundgang hängt dort seine Begehungskennung hin. */
  koerper?: string;
  /** Ohne Kopfzeile: der Rundgang ist eine Arbeitsfläche, keine Website. */
  ohneKopf?: boolean;
}

export function seite(inhalt: string, opt: SeitenOptionen): Response {
  const logo = `data:image/svg+xml;base64,${btoa(MARKE)}`;
  const nav = opt.nutzer
    ? `<nav>
<a href="/objekte"${opt.aktiv === "objekte" ? ' aria-current="page"' : ""}>Objekte</a>
<a href="/maengel"${opt.aktiv === "maengel" ? ' aria-current="page"' : ""}>Mängel</a>
<a href="/touren"${opt.aktiv === "touren" ? ' aria-current="page"' : ""}>Touren</a>
<a href="/verbinden"${opt.aktiv === "verbinden" ? ' aria-current="page"' : ""}>Claude</a>
<a href="/einstellungen"${opt.aktiv === "einstellungen" ? ' aria-current="page"' : ""}>Einstellungen</a>
<span class="wer">${esc(opt.nutzer.name)}</span>
<a href="/abmelden" class="wer">Abmelden</a></nav>`
    : "";

  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opt.titel)} · Türwerk</title>
<link rel="icon" href="${logo}">
<meta name="theme-color" content="#ffffff">
<style>${BASE_CSS}${APP_CSS}</style></head><body${opt.koerper ? ` ${opt.koerper}` : ""}>
${
  opt.ohneKopf
    ? ""
    : `<header class="kopf"><div class="innen">
<img class="logo" src="${logo}" alt="" width="30" height="30">
<a href="/" class="titel">Türwerk</a>${nav}
</div></header>`
}
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
     <div class="knopfleiste"><a class="btn schmal leise" href="/objekte">Zur Übersicht</a></div>`,
    { titel, status },
  );
}

export function umleitung(nach: string, cookie?: string): Response {
  const headers: Record<string, string> = { location: nach, "cache-control": "no-store" };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(null, { status: 302, headers });
}

/* ── Bausteine ────────────────────────────────────────────────────────────── */

export function textfeld(name: string, beschriftung: string, wert = "", extra = ""): string {
  return `<div class="feld"><label for="${esc(name)}">${esc(beschriftung)}</label>
<input class="field" id="${esc(name)}" name="${esc(name)}" value="${esc(wert)}" ${extra}></div>`;
}

export function datumsfeld(name: string, beschriftung: string, wert = ""): string {
  return `<div class="feld"><label for="${esc(name)}">${esc(beschriftung)}</label>
<input class="field" type="date" id="${esc(name)}" name="${esc(name)}" value="${esc(wert)}"></div>`;
}

export function auswahlfeld(
  name: string,
  beschriftung: string,
  optionen: { wert: string; text: string }[],
  gewaehlt: string,
): string {
  return `<div class="feld"><label for="${esc(name)}">${esc(beschriftung)}</label>
<select class="field" id="${esc(name)}" name="${esc(name)}">
${optionen
  .map(
    (o) =>
      `<option value="${esc(o.wert)}"${o.wert === gewaehlt ? " selected" : ""}>${esc(o.text)}</option>`,
  )
  .join("")}
</select></div>`;
}

export function zeitpunkt(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Aus „2026-09-07" wird „07.09.2026" — im Formular bleibt ISO, in der Anzeige nicht. */
export function datum(text: string | null | undefined): string {
  if (!text) return "";
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return t ? `${t[3]}.${t[2]}.${t[1]}` : text;
}

/** Fälligkeit als Merkmal: rot überfällig, gelb in 30 Tagen, grün sonst. */
export function faelligChip(stand: {
  faellig_am: string;
  zustand: string;
  tage: number | null;
  nie_geprueft: boolean;
}): string {
  if (stand.nie_geprueft) return '<span class="chip mangel">nie geprüft</span>';
  if (stand.zustand === "ueberfaellig") {
    return `<span class="chip mangel">überfällig seit ${esc(datum(stand.faellig_am))}</span>`;
  }
  if (stand.zustand === "bald") {
    return `<span class="chip bald">fällig ${esc(datum(stand.faellig_am))}</span>`;
  }
  return `<span class="chip gut">bis ${esc(datum(stand.faellig_am))}</span>`;
}

/** Das Kopier-Skript der Anmelde- und Verbinden-Seite. */
export const KOPIER_SKRIPT = `document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');
if(!b)return;navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){
var o=b.textContent;b.textContent='Kopiert';b.classList.add('done');
setTimeout(function(){b.textContent=o;b.classList.remove('done')},1500)})});`;
