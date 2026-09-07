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

/** Die zwei Ansichten eines Termins: die Arbeitsfläche und die Checkliste fürs Diktat. */
function reiter(begehungId: string, aktiv: "uebersicht" | "checkliste"): string {
  const id = esc(begehungId);
  return `<nav class="reiter">
<a href="/begehung/${id}"${aktiv === "uebersicht" ? ' aria-current="page"' : ""}>Begehung</a>
<a href="/begehung/${id}/checkliste"${aktiv === "checkliste" ? ' aria-current="page"' : ""}>Checkliste</a>
</nav>`;
}

export async function begehungSeite(
  env: Env,
  nutzer: Nutzer,
  id: string,
  meldung?: string,
): Promise<Response> {
  const begehung = await begehungLesen(env.DB, id);
  if (!begehung) return umleitung("/objekte");
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) return umleitung("/objekte");

  const geschosse = await geschosseListe(env.DB, objekt.id);
  const bauteile = inLaufreihenfolge(await bauteileMitStand(env.DB, objekt), geschosse);
  const pruefungen = await pruefungenLesen(env.DB, begehung.id);
  const nachBauteil = new Map(pruefungen.map((p) => [p.bauteil_id, p]));
  const geprueft = bauteile.filter((b) => nachBauteil.has(b.id));
  const fehlend = bauteile.filter((b) => istFaellig(b) && !nachBauteil.has(b.id));
  const posten = await berichtsUebersicht(env, begehung, objekt);
  const sammel = await sammelberichteLesen(env.DB, begehung.id);
  const veraltet = posten.filter((p) => p.veraltet).length;
  const ohneBericht = pruefungen.length - posten.length;

  const kopf = `<div class="zeile oben">
<div><div class="eyebrow"><a href="/objekt/${esc(objekt.id)}">${esc(objekt.name)}</a></div>
<h1 class="seite" style="margin-top:8px">Begehung ${esc(datumAnzeige(begehung.datum))}</h1>
<p class="meta" style="margin-top:8px">${esc(begehung.pruefer || "ohne Prüfer")} · ${esc(begehung.status)}${
    begehung.betreiber_unterschrift
      ? ` · unterschrieben von ${esc(begehung.betreiber_name)}`
      : ""
  }</p></div></div>`;

  /*
   * Eine Begehung hat immer genau einen nächsten Schritt. Also steht hier ein Satz, der sagt
   * wo man ist, und ein Knopf, der weiterführt — der Rest leise darunter. Keine Kennzahlen:
   * was sie sagen, sagt der Satz schon, und darunter steht die Liste selbst. Der Regelweg ist
   * ohnehin das Diktat; die Website ist zum Nachsehen und für den einen Griff, der gerade dran
   * ist, nicht für eine zweite vollständige Bedienung.
   */
  const abgeschlossen = begehung.status === "abgeschlossen";
  const ohneBestand = bauteile.length === 0;
  const offen = ohneBericht + veraltet;

  let satz: string;
  let knopf: string;
  if (ohneBestand) {
    satz =
      "Dieses Objekt hat noch keinen Bestand — diese Begehung ist die Bestandsaufnahme. " +
      "Jede diktierte Tür legt sich selbst an.";
    knopf = `<a class="btn schmal" href="/begehung/${esc(begehung.id)}/pruefung/neu">Erste Tür erfassen</a>`;
  } else if (fehlend.length) {
    satz = pruefungen.length
      ? `${pruefungen.length} von ${pruefungen.length + fehlend.length} erfasst — ${fehlend.length} ${
          fehlend.length === 1 ? "fällige Tür fehlt" : "fällige Türen fehlen"
        } noch.`
      : `${fehlend.length} fällige ${fehlend.length === 1 ? "Tür" : "Türen"} stehen an, noch nichts erfasst.`;
    knopf = `<a class="btn schmal" href="/begehung/${esc(begehung.id)}/checkliste">Checkliste öffnen</a>`;
  } else if (!abgeschlossen) {
    satz = `Alle ${pruefungen.length} fälligen Bauteile sind erfasst.`;
    knopf = `<button class="btn schmal" type="submit">Begehung abschließen</button>`;
  } else if (offen) {
    satz = `Abgeschlossen. ${offen} ${offen === 1 ? "Bericht steht" : "Berichte stehen"} aus.`;
    knopf = `<button class="btn schmal" id="erzeugen">${offen} ${offen === 1 ? "Bericht" : "Berichte"} erzeugen</button>`;
  } else if (!sammel.length) {
    satz = `${posten.length} ${posten.length === 1 ? "Bericht" : "Berichte"} erzeugt.`;
    knopf = `<button class="btn schmal" id="sammel">Sammelbericht erzeugen</button>`;
  } else {
    satz = `Fertig: ${posten.length} ${
      posten.length === 1 ? "Bericht" : "Berichte"
    }, Sammelbericht v${sammel[0].version}.`;
    knopf = `<a class="btn schmal" href="/begehung/${esc(begehung.id)}/paket.zip">Alles als ZIP</a>`;
  }

  /* Was gerade nicht dran ist, bleibt trotzdem erreichbar — nur leise. */
  const weitere: string[] = [];
  if (!ohneBestand) {
    weitere.push(`<a href="/rundgang/${esc(begehung.id)}">Im Rundgang öffnen</a>`);
  }
  if (pruefungen.length && abgeschlossen && !offen) {
    weitere.push(`<button id="erzeugen" class="alsLink">Berichte neu erzeugen</button>`);
  }
  if (posten.length && sammel.length) {
    weitere.push(`<button id="sammel" class="alsLink">Sammelbericht neu erzeugen</button>`);
  }
  if (posten.length && !(sammel.length && !offen)) {
    weitere.push(`<a href="/begehung/${esc(begehung.id)}/paket.zip">Alles als ZIP</a>`);
  }
  weitere.push(
    `<a href="/begehung/${esc(begehung.id)}/unterschrift">${
      begehung.betreiber_unterschrift ? "Unterschrift ändern" : "Betreiber unterschreiben"
    }</a>`,
  );
  if (abgeschlossen) {
    weitere.push(
      `<button form="wiederOeffnen" class="alsLink" type="submit">Wieder öffnen</button>`,
    );
  }

  const werkzeuge = `<form method="post" action="/begehung/${esc(begehung.id)}/abschliessen"
  class="naechster">
<p class="satz">${esc(satz)}</p>
<div class="knopfleiste" style="margin:0">${knopf}<span class="stand" id="stand">${
    meldung ? esc(meldung) : ""
  }</span></div>
</form>
<form method="post" action="/begehung/${esc(begehung.id)}/oeffnen" id="wiederOeffnen"></form>
<div class="leiseleiste">${weitere.join("")}
<form method="post" action="/begehung/${esc(begehung.id)}/abbrechen" style="display:inline"
  onsubmit="return confirm(${
    pruefungen.length
      ? `'Begehung abbrechen? Die ${pruefungen.length} erfassten Prüfungen bleiben erhalten.'`
      : "'Begehung abbrechen? Sie ist leer und verschwindet dann ganz.'"
  })"><button class="alsLink gefaehrlich" type="submit">Begehung abbrechen</button></form>
</div>`;

  /*
   * Solange nichts erfasst ist, sagt der Satz oben schon alles — dann fällt der ganze
   * Abschnitt weg. Zwei Knöpfe für denselben Griff sind ein Knopf zu viel.
   */
  const pruefungListe = geprueft.length
    ? `<div class="zeile" style="justify-content:space-between;align-items:center;margin-top:36px">
<h2 class="abschnitt" style="margin:0">Prüfungen</h2>
<a class="btn schmal leise" href="/begehung/${esc(begehung.id)}/pruefung/neu">Prüfung erfassen</a></div>
<div style="height:14px"></div>
<div class="liste">${geprueft
        .map((b) => {
          const p = nachBauteil.get(b.id)!;
          const abweichungen = abweichungenKlartext(b.art, p.checks);
          const ort =
            [b.raumnummer, b.raum || b.bezeichnung, b.flur].filter(Boolean).join(" · ") ||
            "ohne Ortsangabe";
          return `<a class="posten" href="/begehung/${esc(begehung.id)}/pruefung/${b.nr}">
<span class="nr">${b.nr}</span>
<div class="haupt"><div class="name">${esc(ort)}</div>
<div class="unter">${esc(p.ergebnis)}${p.hinweise ? ` · ${esc(p.hinweise.slice(0, 70))}` : ""}</div></div>
${
  abweichungen.length
    ? `<span class="chip mangel">${abweichungen.length} nicht i.O.</span>`
    : '<span class="chip gut">alles i.O.</span>'
}</a>`;
        })
        .join("")}</div>`
    : "";

  const fehlendListe = fehlend.length
    ? `<h2 class="abschnitt">Fällig, noch nicht geprüft</h2>
<p class="meta">Antippen öffnet das Prüfraster.</p><div class="liste">${fehlend
        .map(
          (b) => `<a class="posten" href="/begehung/${esc(begehung.id)}/pruefung/${b.nr}">
<span class="nr">${b.nr}</span>
<div class="haupt"><div class="name">${esc(
            [b.raumnummer, b.raum || b.bezeichnung, b.flur].filter(Boolean).join(" · ") ||
              "ohne Ortsangabe",
          )}</div>
<div class="unter">${esc(VORLAGEN[b.art]?.label ?? b.art)}</div></div>
${faelligChip(b.stand)}</a>`,
        )
        .join("")}</div>`
    : "";

  const berichtListe = posten.length
    ? `<h2 class="abschnitt">Berichte</h2><div class="liste">${posten
        .map(
          (p) => `<div class="posten">
<span class="nr">${p.nr}</span>
<div class="haupt"><div class="name"><a href="/datei/${esc(p.schluessel)}">${esc(p.name)}</a></div>
<div class="unter">Version ${p.version} · ${esc(zeitpunkt(p.erzeugt_am))}${
            p.seiten > 1 ? ` · ${p.seiten} Seiten` : ""
          }${
            p.aeltere.length
              ? ` · ältere: ${p.aeltere
                  .map(
                    (a) =>
                      `<a href="/datei/${esc(a.schluessel)}" style="text-decoration:underline">v${a.version}</a>`,
                  )
                  .join(" ")}`
              : ""
          }</div></div>
${p.veraltet ? '<span class="chip mangel">Stand geändert</span>' : '<span class="chip gut">aktuell</span>'}</div>`,
        )
        .join("")}</div>`
    : "";

  const sammelListe = sammel.length
    ? `<h2 class="abschnitt">Sammelbericht</h2><div class="liste">${sammel
        .map(
          (s) => `<a class="posten" href="/datei/${esc(s.r2_schluessel)}">
<div class="haupt"><div class="name">Sammelbericht v${s.version}</div>
<div class="unter">${esc(zeitpunkt(s.erzeugt_am))}</div></div>
<span class="chip">PDF</span></a>`,
        )
        .join("")}</div>`
    : "";

  const skript = `
const stand = document.getElementById('stand');
async function lauf(pfad, knopf, name) {
  knopf.disabled = true;
  stand.classList.add('laeuft');
  let gesamt = 0;
  for (let runde = 0; runde < 40; runde++) {
    stand.textContent = name + ' …' + (gesamt ? ' ' + gesamt + ' fertig' : '');
    const r = await fetch(location.pathname + pfad, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) {
      stand.classList.remove('laeuft');
      stand.textContent = d.fehler || 'Fehlgeschlagen.';
      knopf.disabled = false;
      return;
    }
    gesamt += d.erzeugt || 0;
    if (d.fertig !== false) break;
  }
  stand.classList.remove('laeuft');
  location.reload();
}
document.getElementById('erzeugen')?.addEventListener('click', function () {
  lauf('/erzeugen', this, 'Erzeuge Berichte');
});
document.getElementById('sammel')?.addEventListener('click', function () {
  lauf('/sammelbericht', this, 'Erzeuge Sammelbericht');
});`;

  return seite(
    `${reiter(begehung.id, "uebersicht")}
${kopf}
${werkzeuge}
${meldung ? `<div class="note" style="margin:22px 0">${esc(meldung)}</div>` : ""}
${pruefungListe}
${fehlendListe}
${berichtListe}
${sammelListe}
${stammdatenFormular(begehung)}`,
    { titel: `Begehung ${objekt.name}`, nutzer, aktiv: "objekte", skript },
  );
}

function stammdatenFormular(b: Begehung): string {
  return `<details class="klapp">
<summary>Stammdaten <span class="meta">${esc(
    [b.pruefer, b.befaehigung, b.ort].filter(Boolean).join(" · "),
  )}</span></summary>
<form class="karte" method="post" action="/begehung/${esc(b.id)}" style="margin-top:8px">
<div class="felder">
${datumsfeld("datum", "Prüfdatum", b.datum)}
${textfeld("pruefer", "Prüfer", b.pruefer)}
${textfeld("befaehigung", "Befähigungsnachweis", b.befaehigung)}
${textfeld("ort", "Prüfort", b.ort)}
${textfeld("beteiligte", "Beteiligte / Messgeräte", b.beteiligte)}
<div class="feld"><label for="status">Status</label>
<select class="field" id="status" name="status">
${["geplant", "laufend", "abgeschlossen"]
  .map((s) => `<option value="${s}"${b.status === s ? " selected" : ""}>${s}</option>`)
  .join("")}
</select></div>
</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Speichern</button>
<span class="meta">Ändert sich etwas davon, entsteht beim nächsten Erzeugen eine neue Berichtsversion.</span></div>
</form>
</details>`;
}

/* ── Prüfraster ────────────────────────────────────────────────────────────── */

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

/* ── Checkliste fürs Diktat ────────────────────────────────────────────────── */

/**
 * Eine Hand hält das Telefon, die andere die Tür. Diese Seite schreibt nichts — sie zeigt,
 * wo man gerade ist, während Claude über den Connector mitschreibt: oben die nächste
 * ungeprüfte Tür groß, darunter die Liste in Laufreihenfolge zum Abhaken, im zweiten Reiter
 * die Prüfpunkte zum verbalen Abgehen.
 *
 * Sie frischt sich alle zehn Sekunden selbst auf (`stand.json`), damit ein diktiertes „Tür 7
 * fertig" ohne Zutun als Haken erscheint. Kein Neuladen: Reiter und Scrollstand bleiben.
 */
export async function checklisteSeite(
  env: Env,
  nutzer: Nutzer,
  id: string,
): Promise<Response> {
  const begehung = await begehungLesen(env.DB, id);
  if (!begehung) return umleitung("/objekte");
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) return umleitung("/objekte");

  const geschosse = await geschosseListe(env.DB, objekt.id);
  const alle = inLaufreihenfolge(await bauteileMitStand(env.DB, objekt), geschosse);
  const bauteile = alle.filter((b) => b.wartungspflichtig === 1);
  const pruefungen = await pruefungenLesen(env.DB, begehung.id);
  const nachBauteil = new Map(pruefungen.map((p) => [p.bauteil_id, p]));
  const geschossName = new Map(geschosse.map((g) => [g.id, g.name]));

  const ort = (b: BauteilMitStand) =>
    [geschossName.get(b.geschoss_id ?? ""), b.raumnummer, b.raum || b.bezeichnung, b.flur]
      .filter(Boolean)
      .join(" · ");

  const zeilen = bauteile
    .map((b) => {
      const p = nachBauteil.get(b.id);
      const abweichungen = p ? Object.keys(p.checks).length : 0;
      const klasse = p ? (abweichungen ? "reihe fertig abweichung" : "reihe fertig") : "reihe";
      const marke = p ? (abweichungen ? String(abweichungen) : "✓") : String(b.nr);
      const unten = p
        ? `${p.ergebnis}${abweichungen ? ` · Punkt ${esc(Object.keys(p.checks).join(", "))}` : ""}`
        : ort(b) || "ohne Ortsangabe";
      return `<a class="${klasse}" id="reihe-${b.nr}" href="/begehung/${esc(begehung.id)}/pruefung/${b.nr}">
<span class="marke">${esc(marke)}</span>
<span class="txt">Tür ${b.nr}${p ? "" : ""}<small>${esc(unten)}</small></span></a>`;
    })
    .join("");

  /* Die Prüfpunkte der Vorlagen, die an diesem Objekt wirklich vorkommen. */
  const arten = [...new Set(bauteile.map((b) => b.art))];
  const gezeigteArten = arten.length ? arten : ["wartung_drehfluegel"];
  const punkte = gezeigteArten
    .map((art) => {
      const v = vorlage(art);
      return `<h2 class="abschnitt" style="margin-top:26px">${esc(v.label)}</h2>
<div class="haken punktliste">${v.punkte
        .map(
          (p) => `<div class="reihe"><span class="marke">${esc(p.nr)}</span>
<span class="txt">${esc(p.text)}</span></div>`,
        )
        .join("")}</div>`;
    })
    .join("");

  const offen = bauteile.filter((b) => !nachBauteil.has(b.id));
  const dran = offen[0];
  const anteil = bauteile.length
    ? Math.round(((bauteile.length - offen.length) / bauteile.length) * 100)
    : 0;
  /* Ohne Bestand ist nichts „fertig" — dann ist diese Begehung die Bestandsaufnahme. */
  const leer = bauteile.length === 0;

  const skript = `
/* Alle zehn Sekunden nachsehen, was Claude inzwischen geschrieben hat. */
async function auffrischen() {
  try {
    const r = await fetch(location.pathname.replace(/\\/checkliste$/, '') + '/stand.json',
      { headers: { accept: 'application/json' } });
    if (!r.ok) return;
    const d = await r.json();
    for (const b of d.bauteile) {
      const reihe = document.getElementById('reihe-' + b.nr);
      if (!reihe) continue;
      reihe.className = 'reihe' + (b.geprueft ? ' fertig' : '') + (b.abweichungen ? ' abweichung' : '');
      reihe.querySelector('.marke').textContent =
        b.geprueft ? (b.abweichungen ? String(b.abweichungen) : '✓') : String(b.nr);
      if (b.geprueft) reihe.querySelector('small').textContent = b.zeile;
    }
    const zahl = document.getElementById('zahl');
    if (zahl) zahl.textContent = d.geprueft + ' von ' + d.gesamt;
    const fuellung = document.getElementById('fuellung');
    if (fuellung) fuellung.style.width = d.anteil + '%';
    const dran = document.getElementById('dran');
    if (dran) {
      if (d.naechste) {
        dran.querySelector('.was').textContent = 'JETZT DRAN';
        dran.querySelector('.wer').textContent = 'Tür ' + d.naechste.nr;
        dran.querySelector('.wo').textContent = d.naechste.ort;
      } else if (!d.gesamt) {
        dran.querySelector('.was').textContent = 'BESTANDSAUFNAHME';
        dran.querySelector('.wer').textContent = 'Noch keine Tür';
        dran.querySelector('.wo').textContent = 'Diktier einfach los — jede Tuer legt sich selbst an.';
      } else {
        dran.querySelector('.was').textContent = 'FERTIG';
        dran.querySelector('.wer').textContent = 'Alle Türen geprüft';
        dran.querySelector('.wo').textContent = 'Sag Fertig, dann liest Claude zurueck.';
      }
    }
  } catch (e) { /* kein Netz im Treppenhaus: beim nächsten Mal wieder */ }
}
setInterval(auffrischen, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) auffrischen(); });

/* Reiter ohne Neuladen. */
document.querySelectorAll('.reiter button').forEach((k) => {
  k.addEventListener('click', () => {
    document.querySelectorAll('.reiter button').forEach((x) => x.setAttribute('aria-selected', 'false'));
    k.setAttribute('aria-selected', 'true');
    document.getElementById('tab-tueren').hidden = k.dataset.ziel !== 'tueren';
    document.getElementById('tab-punkte').hidden = k.dataset.ziel !== 'punkte';
  });
});`;

  return seite(
    `${reiter(begehung.id, "checkliste")}
<div class="eyebrow">${esc(objekt.name)} · ${esc(datumAnzeige(begehung.datum))}</div>
<h1 class="seite" style="margin-top:8px">Checkliste</h1>

${
      bauteile.length
        ? `<div class="fortschritt"><b id="zahl">${bauteile.length - offen.length} von ${
            bauteile.length
          }</b>
<span class="meta">geprüft</span></div>
<div class="balken"><i id="fuellung" style="width:${anteil}%"></i></div>`
        : ""
    }

<div class="dran" id="dran">
<div class="was">${leer ? "BESTANDSAUFNAHME" : dran ? "JETZT DRAN" : "FERTIG"}</div>
<div class="wer">${
      leer ? "Noch keine Tür" : dran ? `Tür ${dran.nr}` : "Alle Türen geprüft"
    }</div>
<div class="wo">${
      leer
        ? "Diktier einfach los — jede Tür legt sich selbst an."
        : dran
          ? esc(ort(dran) || "ohne Ortsangabe")
          : "Sag Fertig, dann liest Claude zurück."
    }</div>
</div>

<nav class="reiter" role="tablist">
<button type="button" data-ziel="tueren" aria-selected="true">Türen</button>
<button type="button" data-ziel="punkte" aria-selected="false">Punkte</button>
</nav>

<div id="tab-tueren">
${
  bauteile.length
    ? `<div class="haken">${zeilen}</div>`
    : `<div class="leer">Sobald die erste Tür erfasst ist, steht sie hier.</div>`
}
</div>

<div id="tab-punkte" hidden>
<p class="meta">Zum Abgehen. Genannt wird nur, was abweicht — alles andere gilt als in Ordnung.</p>
${punkte}
</div>`,
    { titel: "Checkliste", nutzer, aktiv: "objekte", skript },
  );
}

/** Der Stand einer Begehung als JSON — die Checkliste frischt sich damit auf. */
export async function checklisteStand(env: Env, id: string): Promise<unknown> {
  const begehung = await begehungLesen(env.DB, id);
  if (!begehung) throw new Error("Diese Begehung gibt es nicht.");
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) throw new Error("Zu dieser Begehung gibt es kein Objekt.");

  const geschosse = await geschosseListe(env.DB, objekt.id);
  const bauteile = inLaufreihenfolge(await bauteileMitStand(env.DB, objekt), geschosse).filter(
    (b) => b.wartungspflichtig === 1,
  );
  const pruefungen = await pruefungenLesen(env.DB, begehung.id);
  const nachBauteil = new Map(pruefungen.map((p) => [p.bauteil_id, p]));
  const geschossName = new Map(geschosse.map((g) => [g.id, g.name]));
  const ort = (b: BauteilMitStand) =>
    [geschossName.get(b.geschoss_id ?? ""), b.raumnummer, b.raum || b.bezeichnung, b.flur]
      .filter(Boolean)
      .join(" · ");

  const zeilen = bauteile.map((b) => {
    const p = nachBauteil.get(b.id);
    const abweichungen = p ? Object.keys(p.checks).length : 0;
    return {
      nr: b.nr,
      geprueft: Boolean(p),
      abweichungen,
      zeile: p
        ? `${p.ergebnis}${abweichungen ? ` · Punkt ${Object.keys(p.checks).join(", ")}` : ""}`
        : ort(b) || "ohne Ortsangabe",
    };
  });
  const offen = bauteile.filter((b) => !nachBauteil.has(b.id));
  const dran = offen[0];

  return {
    status: begehung.status,
    gesamt: bauteile.length,
    geprueft: bauteile.length - offen.length,
    anteil: bauteile.length
      ? Math.round(((bauteile.length - offen.length) / bauteile.length) * 100)
      : 0,
    naechste: dran ? { nr: dran.nr, ort: ort(dran) || "ohne Ortsangabe" } : null,
    bauteile: zeilen,
  };
}
