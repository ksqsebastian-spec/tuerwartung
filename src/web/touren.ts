/**
 * Die Tagestour: sieben Spalten, rechts die Liste dessen, was demnächst fällig ist.
 *
 * Bedient wird sie mit Knöpfen, nicht mit Ziehen — auf einem Telefon im Auto ist ein
 * Sieben-Tage-Raster mit Drag & Drop eine Zumutung. Wer am Rechner sitzt, kann trotzdem
 * ziehen: dieselbe Formularaktion hängt an den Ablegepunkten.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import { datum as datumAnzeige, esc, faelligChip, seite } from "./layout";
import { heute } from "../daten/basis";
import { objektLesen, objekteListe } from "../daten/objekte";
import type { Objekt } from "../daten/objekte";
import { WOCHENTAGE, mapsLink, tagePlus, tourenZeitraum, wochenStart } from "../daten/touren";

export async function tourenSeite(
  env: Env,
  nutzer: Nutzer,
  optionen: { woche?: string; meldung?: string } = {},
): Promise<Response> {
  const montag = wochenStart(optionen.woche || heute());
  const tage = Array.from({ length: 7 }, (_, i) => tagePlus(montag, i));
  const touren = await tourenZeitraum(env.DB, nutzer.benutzer, tage[0], tage[6]);
  const nachTag = new Map(touren.map((t) => [t.datum, t]));

  /* Alle Objekte, die irgendwo in der Woche stehen, plus die fälligen für die Seitenspalte. */
  const alle = await objekteListe(env.DB, { limit: 500 });
  const nachId = new Map(alle.map((o) => [o.id, o]));
  for (const t of touren) {
    for (const id of t.objekte) {
      if (!nachId.has(id)) {
        const o = await objektLesen(env.DB, id);
        if (o) nachId.set(id, { ...o, bauteile: 0, faellige_bauteile: 0, offene_maengel: 0, letzte_begehung: null, stand: { faellig_am: "", zustand: "ok", tage: null, nie_geprueft: false } });
      }
    }
  }
  const geplant = new Set(touren.flatMap((t) => t.objekte));
  const faellig = alle
    .filter((o) => o.faellige_bauteile > 0 && !geplant.has(o.id))
    .sort((a, b) => (a.stand.tage ?? 0) - (b.stand.tage ?? 0) || a.plz.localeCompare(b.plz));

  const heuteIso = heute();

  const spalten = tage
    .map((tag, i) => {
      const tour = nachTag.get(tag);
      const objekte = (tour?.objekte ?? [])
        .map((id) => nachId.get(id))
        .filter(Boolean) as Objekt[];
      const link = mapsLink(objekte);
      const eintraege = objekte.length
        ? objekte
            .map(
              (o, pos) => `<div class="tourposten">
<div class="haupt"><a href="/objekt/${esc(o.id)}"><b>${esc(o.name)}</b></a>
<small>${esc(o.adresse || "ohne Adresse")}</small></div>
<form method="post" action="/touren" class="knoepfchen">
<input type="hidden" name="woche" value="${esc(montag)}">
<input type="hidden" name="datum" value="${esc(tag)}">
<input type="hidden" name="objekt" value="${esc(o.id)}">
${pos > 0 ? '<button name="tun" value="hoch" title="nach oben">↑</button>' : ""}
${pos < objekte.length - 1 ? '<button name="tun" value="runter" title="nach unten">↓</button>' : ""}
<button name="tun" value="weg" title="entfernen">✕</button>
<button name="tun" value="rundgang" title="Im Rundgang öffnen" class="stark">▶</button>
</form></div>`,
            )
            .join("")
        : `<div class="leerer-tag">frei</div>`;
      return `<section class="tag${tag === heuteIso ? " heute" : ""}" data-datum="${esc(tag)}">
<header><b>${WOCHENTAGE[i]}</b> <span class="meta">${esc(datumAnzeige(tag).slice(0, 6))}</span></header>
${eintraege}
${
  link
    ? `<a class="btn schmal leise route" href="${esc(link)}" target="_blank" rel="noopener">Route öffnen</a>`
    : ""
}
</section>`;
    })
    .join("");

  const seitenspalte = faellig.length
    ? faellig
        .slice(0, 40)
        .map(
          (o) => `<div class="tourposten offen" draggable="true" data-objekt="${esc(o.id)}">
<div class="haupt"><b>${esc(o.name)}</b>
<small>${esc(o.adresse || "ohne Adresse")} · ${o.faellige_bauteile} fällig</small></div>
<form method="post" action="/touren" class="knoepfchen">
<input type="hidden" name="woche" value="${esc(montag)}">
<input type="hidden" name="objekt" value="${esc(o.id)}">
<input type="hidden" name="tun" value="dazu">
${tage
  .map(
    (tag, i) =>
      `<button name="datum" value="${esc(tag)}" title="${esc(datumAnzeige(tag))}">${WOCHENTAGE[i]}</button>`,
  )
  .join("")}
</form>
${faelligChip(o.stand)}</div>`,
        )
        .join("")
    : `<div class="leer">In den nächsten 30 Tagen ist nichts fällig, was noch nicht eingeplant wäre.</div>`;

  /* Ziehen ist die Zugabe für den Rechner: dieselbe Aktion, nur ohne Knopfdruck. */
  const skript = `
let getragen = null;
document.querySelectorAll('[draggable=true]').forEach((el) => {
  el.addEventListener('dragstart', () => { getragen = el.dataset.objekt; el.style.opacity = '.4'; });
  el.addEventListener('dragend', () => { el.style.opacity = ''; });
});
document.querySelectorAll('.tag').forEach((tag) => {
  tag.addEventListener('dragover', (e) => { e.preventDefault(); tag.classList.add('ziel'); });
  tag.addEventListener('dragleave', () => tag.classList.remove('ziel'));
  tag.addEventListener('drop', (e) => {
    e.preventDefault();
    tag.classList.remove('ziel');
    if (!getragen) return;
    const f = document.createElement('form');
    f.method = 'post';
    f.action = '/touren';
    f.innerHTML = '<input name="woche" value="${esc(montag)}">' +
      '<input name="datum" value="' + tag.dataset.datum + '">' +
      '<input name="objekt" value="' + getragen + '"><input name="tun" value="dazu">';
    document.body.appendChild(f);
    f.submit();
  });
});`;

  return seite(
    `<div class="zeile oben"><h1 class="seite">Touren</h1>
<div class="knopfleiste" style="margin:0">
<a class="btn schmal leise" href="/touren?woche=${esc(tagePlus(montag, -7))}">‹ Woche</a>
<a class="btn schmal leise" href="/touren">Diese Woche</a>
<a class="btn schmal leise" href="/touren?woche=${esc(tagePlus(montag, 7))}">Woche ›</a>
</div></div>
${optionen.meldung ? `<div class="note" style="margin-bottom:22px">${esc(optionen.meldung)}</div>` : ""}

<div class="woche">${spalten}</div>

<h2 class="abschnitt">Fällig in den nächsten 30 Tagen</h2>
<p class="meta">Nach Dringlichkeit, dann nach Postleitzahl. Tag antippen oder auf einen Tag ziehen.</p>
<div class="offene-liste">${seitenspalte}</div>`,
    { titel: "Touren", nutzer, aktiv: "touren", skript },
  );
}

export { heute };
