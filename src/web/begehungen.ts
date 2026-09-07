/**
 * Die Begehungsseiten: der Termin mit seinen Prüfungen, das Prüfraster je Bauteil und die
 * Unterschrift des Betreibers.
 *
 * Die Begehungsseite ist die Arbeitsfläche eines Termins — was geprüft ist, was noch fehlt,
 * welche Berichte in welcher Version daraus entstanden sind.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import {
  datum as datumAnzeige,
  esc,
  faelligChip,
  seite,
  textfeld,
  datumsfeld,
  umleitung,
  zeitpunkt,
} from "./layout";
import {
  BEWERTUNGEN,
  BEWERTUNGEN_KURZ,
  VORLAGEN,
  abweichungenKlartext,
  feldLabel,
  vorlage,
} from "../vorlagen";
import type { Bewertung } from "../vorlagen";
import { geschosseListe, objektLesen } from "../daten/objekte";
import { bauteileMitStand, inLaufreihenfolge, istFaellig } from "../daten/bauteile";
import type { BauteilMitStand } from "../daten/bauteile";
import { begehungLesen, pruefungenLesen } from "../daten/begehungen";
import type { Begehung } from "../daten/begehungen";
import { berichtsUebersicht } from "../pdf/berichte";
import { FOTO_SKRIPT, fotoBereich } from "./fotos";
import { fotosZuPruefung } from "../daten/fotos";
import { sammelberichteLesen } from "../daten/berichte";

export async function pruefungSeite(
  env: Env,
  nutzer: Nutzer,
  begehungId: string,
  nr: number | null,
): Promise<Response> {
  const begehung = await begehungLesen(env.DB, begehungId);
  if (!begehung) return umleitung("/objekte");
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) return umleitung("/objekte");

  const bauteile = await bauteileMitStand(env.DB, objekt, { auch_stillgelegte: true });
  const bauteil = nr === null ? null : (bauteile.find((b) => b.nr === nr) ?? null);
  const pruefungen = await pruefungenLesen(env.DB, begehung.id);
  const pruefung = bauteil ? pruefungen.find((p) => p.bauteil_id === bauteil.id) : undefined;

  /* Neue Prüfung ohne Bauteil: die nächste freie Nummer, Vorlage der zuletzt erfassten. */
  const nummer = bauteil?.nr ?? (bauteile.length ? Math.max(...bauteile.map((b) => b.nr)) + 1 : 1);
  const vorige = pruefungen[pruefungen.length - 1];
  const art = bauteil?.art ?? vorige?.bauteil.art ?? "wartung_drehfluegel";
  const v = vorlage(art);
  const felder = bauteil?.felder ?? {};
  const checks = pruefung?.checks ?? {};

  const punkte = v.punkte
    .map((p) => {
      const gewaehlt = (checks[p.nr] as string) ?? "io";
      const knoepfe = (["io", "nio", "nz", "sb"] as const)
        .map(
          (bw) => `<label title="${esc(BEWERTUNGEN[bw])}">
<input type="radio" name="p_${esc(p.nr)}" value="${bw}"${gewaehlt === bw ? " checked" : ""}>
<span>${esc(BEWERTUNGEN_KURZ[bw])}</span></label>`,
        )
        .join("");
      return `<div class="punkt"><div class="txt"><b>${esc(p.nr)}</b>${esc(p.text)}</div>
<div class="wahl">${knoepfe}</div></div>`;
    })
    .join("");

  const ziel = `/begehung/${encodeURIComponent(begehung.id)}/pruefung/${bauteil ? bauteil.nr : "neu"}`;
  const fotos = pruefung ? await fotosZuPruefung(env.DB, pruefung.id) : [];
  const ort =
    bauteil && [bauteil.raumnummer, bauteil.raum, bauteil.flur].filter(Boolean).join(" · ");

  return seite(
    `<div class="zeile oben"><div>
<div class="eyebrow"><a href="/begehung/${esc(begehung.id)}">${esc(objekt.name)} · ${esc(
      datumAnzeige(begehung.datum),
    )}</a></div>
<h1 class="seite" style="margin-top:8px">Tür ${nummer}</h1>
${ort ? `<p class="meta" style="margin-top:8px">${esc(ort)}</p>` : ""}</div></div>

<form class="karte" method="post" action="${esc(ziel)}">
<div class="felder">
${bauteil ? "" : textfeld("nr", "Nummer", String(nummer))}
${
  bauteil
    ? ""
    : `<div class="feld"><label for="art">Vorlage</label>
<select class="field" id="art" name="art">
${Object.keys(VORLAGEN)
  .map((id) => `<option value="${id}"${id === art ? " selected" : ""}>${esc(VORLAGEN[id].label)}</option>`)
  .join("")}
</select></div>`
}
${textfeld("raumnummer", "Raumnummer", bauteil?.raumnummer ?? "")}
${textfeld("raum", "Raum", bauteil?.raum ?? "")}
${textfeld("flur", "Flur", bauteil?.flur ?? "")}
${v.bauteilfelder
  .filter((f) => !["RAUM", "FLUR", "RAUMBEZ"].includes(f))
  .map((f) => textfeld(`f_${f}`, feldLabel(f), felder[f] ?? ""))
  .join("")}
<div class="feld"><label for="ergebnis">Ergebnis</label>
<select class="field" id="ergebnis" name="ergebnis">
${["bestanden", "Nachbesserung"]
  .map(
    (e) =>
      `<option value="${esc(e)}"${(pruefung?.ergebnis || "bestanden") === e ? " selected" : ""}>${esc(e)}</option>`,
  )
  .join("")}
</select></div>
</div>

<h2 class="abschnitt">Prüfpunkte</h2>
<p class="meta">Standard ist „in Ordnung". Nur ändern, was abweicht.</p>
<div class="punkte">${punkte}</div>

<div class="feld" style="margin-top:22px"><label for="hinweise">Hinweise / Bemerkungen</label>
<textarea class="field" id="hinweise" name="hinweise">${esc(pruefung?.hinweise ?? "")}</textarea>
<div class="hinweis">Wird bei einer Abweichung zur Beschreibung des Mangels.</div></div>

<div class="knopfleiste">
<button class="btn schmal" type="submit">Prüfung speichern</button>
<a class="btn schmal leise" href="/begehung/${esc(begehung.id)}">Zurück</a>
${bauteil ? `<a class="btn schmal leise" href="/objekt/${esc(objekt.id)}/bauteil/${bauteil.nr}">Bauteil</a>` : ""}
</div></form>

${
  bauteil
    ? `<h2 class="abschnitt">Fotos</h2>
<p class="meta">Landen im Bericht als Anhangseite, zwei Fotos je Seite.</p>
${fotoBereich(fotos, { begehung_id: begehung.id, bauteil_id: bauteil.id, bauteil_nr: bauteil.nr })}`
    : ""
}`,
    { titel: `Tür ${nummer}`, nutzer, aktiv: "objekte", skript: bauteil ? FOTO_SKRIPT : undefined },
  );
}

/* ── Unterschrift des Betreibers ───────────────────────────────────────────── */

export async function unterschriftSeite(
  env: Env,
  nutzer: Nutzer,
  begehungId: string,
  meldung?: string,
): Promise<Response> {
  const begehung = await begehungLesen(env.DB, begehungId);
  if (!begehung) return umleitung("/objekte");
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) return umleitung("/objekte");

  /* Das Feld ist bewusst groß und ohne Rahmenwerk: ein Finger auf einem Handy, mehr nicht. */
  const skript = `
const feld = document.getElementById('feld');
const ctx = feld.getContext('2d');
const knopf = document.getElementById('senden');
let malt = false, leer = true;

function groesse() {
  const breite = feld.parentElement.clientWidth;
  const dpr = window.devicePixelRatio || 1;
  const daten = leer ? null : feld.toDataURL('image/png');
  feld.width = Math.round(breite * dpr);
  feld.height = Math.round(220 * dpr);
  feld.style.height = '220px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111';
  if (daten) { const bild = new Image(); bild.onload = () => ctx.drawImage(bild, 0, 0, breite, 220); bild.src = daten; }
}
groesse();
window.addEventListener('resize', groesse);

function punkt(e) {
  const r = feld.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
feld.addEventListener('pointerdown', (e) => {
  feld.setPointerCapture(e.pointerId);
  malt = true; leer = false; knopf.disabled = false;
  const p = punkt(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
});
feld.addEventListener('pointermove', (e) => {
  if (!malt) return;
  e.preventDefault();
  const p = punkt(e); ctx.lineTo(p.x, p.y); ctx.stroke();
});
for (const art of ['pointerup', 'pointercancel', 'pointerleave']) {
  feld.addEventListener(art, () => { malt = false; });
}
document.getElementById('leeren').addEventListener('click', () => {
  ctx.clearRect(0, 0, feld.width, feld.height);
  leer = true; knopf.disabled = true;
});

document.getElementById('form').addEventListener('submit', (e) => {
  if (leer) { e.preventDefault(); return; }
  /* Auf höchstens 800 × 300 verkleinern — mehr braucht das PDF nicht. */
  const ziel = document.createElement('canvas');
  const faktor = Math.min(800 / feld.width, 300 / feld.height, 1);
  ziel.width = Math.round(feld.width * faktor);
  ziel.height = Math.round(feld.height * faktor);
  ziel.getContext('2d').drawImage(feld, 0, 0, ziel.width, ziel.height);
  document.getElementById('bild').value = ziel.toDataURL('image/png');
});`;

  return seite(
    `<div class="eyebrow"><a href="/begehung/${esc(begehung.id)}">${esc(objekt.name)} · ${esc(
      datumAnzeige(begehung.datum),
    )}</a></div>
<h1 class="seite" style="margin-top:8px">Betreiber unterschreibt</h1>
<p class="lede" style="margin-top:12px;max-width:46ch">Mit dem Finger unterschreiben. Danach
entstehen die Berichte neu — mit der Unterschrift an ihrer Stelle im Formular.</p>
${meldung ? `<div class="note" style="margin:22px 0">${esc(meldung)}</div>` : ""}
${
  begehung.betreiber_unterschrift
    ? `<p class="meta" style="margin-top:18px">Bisher unterschrieben von <b>${esc(
        begehung.betreiber_name,
      )}</b> am ${esc(zeitpunkt(begehung.unterschrieben_am))}.</p>
<img src="/datei/${esc(begehung.betreiber_unterschrift)}" alt="Unterschrift"
  style="max-height:90px;margin:14px 0;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px">`
    : ""
}

<form class="karte" id="form" method="post" action="/begehung/${esc(begehung.id)}/unterschrift"
  style="margin-top:22px">
<input type="hidden" name="bild" id="bild">
<div class="felder">
${textfeld("name", "Name des Unterzeichnenden", begehung.betreiber_name, "required")}
</div>
<div style="margin-top:18px">
<canvas id="feld" style="width:100%;background:#fff;border:1px dashed var(--line-strong);
  border-radius:14px;touch-action:none"></canvas>
</div>
<div class="knopfleiste">
<button class="btn schmal" type="submit" id="senden" disabled>Unterschreiben</button>
<button class="btn schmal leise" type="button" id="leeren">Leeren</button>
<a class="btn schmal leise" href="/begehung/${esc(begehung.id)}">Zurück</a></div>
</form>`,
    { titel: "Unterschrift", nutzer, aktiv: "objekte", skript },
  );
}

export type { BauteilMitStand, Bewertung };
