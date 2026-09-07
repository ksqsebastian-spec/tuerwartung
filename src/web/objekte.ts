/**
 * Objektseiten: die Liste nach Fälligkeit und das Objekt selbst.
 *
 * Die Liste ist die Startseite — was zuerst dran ist, steht oben. Das Objekt ist die eine
 * Arbeitsfläche mit vier Reitern: Bestand, Checkliste, Mängel, Berichte. Der Termin („Begehung")
 * kommt in der Oberfläche nicht vor: er entsteht, sobald etwas erfasst wird, und trägt intern
 * die Prüfungen und Berichte. Wer am Objekt steht, denkt „ich bin an der Kita", nicht „ich
 * setze eine Begehung fort".
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
} from "./layout";
import { VORLAGEN } from "../vorlagen";
import { heute } from "../daten/basis";
import {
  geschosseListe,
  objektLesen,
  objekteListe,
} from "../daten/objekte";
import type { Objekt } from "../daten/objekte";
import { bauteileMitStand, inLaufreihenfolge, istFaellig } from "../daten/bauteile";
import type { BauteilMitStand } from "../daten/bauteile";
import { begehungenListe, begehungLesen, pruefungenLesen } from "../daten/begehungen";
import type { Begehung } from "../daten/begehungen";
import { heute as heuteIso } from "../daten/basis";
import { maengelListe } from "../daten/maengel";
import { berichtsUebersicht } from "../pdf/berichte";
import { sammelberichteLesen } from "../daten/berichte";
import { zeitpunkt } from "./layout";

export async function objekteSeite(
  env: Env,
  nutzer: Nutzer,
  suche: string,
  meldung?: string,
): Promise<Response> {
  const liste = await objekteListe(env.DB, { suche: suche || undefined, limit: 200 });

  const zeilen = liste.length
    ? `<div class="liste">${liste
        .map(
          (o) => `<a class="posten" href="/objekt/${esc(o.id)}">
<div class="haupt">
  <div class="name">${esc(o.name)}</div>
  <div class="unter">${esc(o.adresse || "ohne Adresse")}${o.betreiber ? ` · ${esc(o.betreiber)}` : ""}</div>
</div>
<span class="chip leise">${o.bauteile} ${o.bauteile === 1 ? "Bauteil" : "Bauteile"}</span>
${o.faellige_bauteile ? `<span class="chip">${o.faellige_bauteile} fällig</span>` : ""}
${faelligChip(o.stand)}</a>`,
        )
        .join("")}</div>`
    : `<div class="leer">Noch kein Objekt. Sag Claude einfach, wo du bist — daraus entsteht das erste.</div>`;

  /*
   * Angelegt werden Objekte im Regelfall im Gespräch — `begehung_starten` mit einem unbekannten
   * Namen legt es an. Das Formular bleibt als Notweg, aber zugeklappt: sonst nimmt es die halbe
   * Liste weg für etwas, das ein paarmal im Jahr vorkommt.
   */
  const neu = `<details class="klapp" style="margin-top:30px">
<summary>Objekt anlegen <span class="meta">sonst legt der Chat es an</span></summary>
<form class="karte" method="post" action="/objekte" style="margin-top:8px">
<div class="felder">
  ${textfeld("name", "Name", "", 'required placeholder="Kita Heselstücken"')}
  ${textfeld("adresse", "Adresse", "", 'placeholder="Heselstücken 12, 22523 Hamburg"')}
  ${textfeld("betreiber", "Betreiber")}
  ${textfeld("intervall_monate", "Intervall (Monate)", "12")}
</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Objekt anlegen</button></div>
</form>
</details>`;

  return seite(
    `<div class="zeile oben"><h1 class="seite">Objekte</h1>
<form method="get" style="min-width:220px">
<input class="field" name="suche" value="${esc(suche)}" placeholder="Suchen …" aria-label="Suchen">
</form></div>
${meldung ? `<div class="note" style="margin-bottom:22px">${esc(meldung)}</div>` : ""}
${zeilen}
${neu}`,
    { titel: "Objekte", nutzer, aktiv: "objekte" },
  );
}

/** Die vier Blicke aufs Objekt. Ein Termin taucht hier bewusst nicht auf. */
/**
 * Zwei Blicke aufs Objekt, mehr nicht: was da ist, und was daraus geworden ist.
 *
 * Die Checkliste hängt am Türtyp und steht deshalb oben in der Leiste — sie ist für alle
 * Objekte dieselbe. Mängel gibt es nicht mehr als eigene Ebene: eine Tür hat bestanden oder
 * nicht, und das steht im Bestand.
 */
export function objektReiter(objektId: string, aktiv: "bestand" | "berichte"): string {
  const id = esc(objektId);
  const eintrag = (pfad: string, name: string, schluessel: string) =>
    `<a href="/objekt/${id}${pfad}"${aktiv === schluessel ? ' aria-current="page"' : ""}>${name}</a>`;
  return `<nav class="reiter">
${eintrag("", "Bestand", "bestand")}
${eintrag("/berichte", "Berichte", "berichte")}
</nav>`;
}

/** Kopfzeile: Name, Adresse, Betreiber. Ohne Kennzahlenleiste — der Satz darunter sagt es. */
function objektKopf(o: Objekt): string {
  const kontakt = [o.betreiber_kontakt, o.telefon].filter(Boolean).join(" · ");
  return `<div class="eyebrow">${esc(o.objektart || "Objekt")}</div>
<h1 class="seite" style="margin-top:8px">${esc(o.name)}</h1>
<p class="meta" style="margin-top:8px">${esc(o.adresse || "ohne Adresse")}${
    o.betreiber ? ` · ${esc(o.betreiber)}` : ""
  }${kontakt ? ` · ${esc(kontakt)}` : ""}</p>
${o.zugang ? `<p class="zugang">${esc(o.zugang)}</p>` : ""}`;
}

/** Was an diesem Objekt gerade zu tun ist — für den Satz und den einen Knopf. */
interface Lage {
  bestand: number;
  faellig: number;
  heuteErfasst: number;
  offeneBerichte: number;
  laufende: Begehung | null;
  letzteMitPruefungen: Begehung | null;
  bisWann: string;
}

async function lageLesen(env: Env, o: Objekt, bestand: number, faellig: number): Promise<Lage> {
  const begehungen = await begehungenListe(env.DB, { objekt_id: o.id, limit: 20 });
  const laufendeZeile = begehungen.find(
    (b) => b.datum === heuteIso() && b.status !== "abgeschlossen" && b.status !== "abgebrochen",
  );
  const letzteZeile = begehungen.find((b) => b.pruefungen > 0 && b.status !== "abgebrochen");
  const laufende = laufendeZeile ? await begehungLesen(env.DB, laufendeZeile.id) : null;
  const letzte = letzteZeile ? await begehungLesen(env.DB, letzteZeile.id) : null;

  /* Offene Berichte zählen wir nur für den Termin, der gerade zur Debatte steht. */
  let offeneBerichte = 0;
  const bezug = laufende ?? letzte;
  if (bezug) {
    const posten = await berichtsUebersicht(env, bezug, o);
    const pruefungen = await pruefungenLesen(env.DB, bezug.id);
    offeneBerichte = pruefungen.length - posten.length + posten.filter((p) => p.veraltet).length;
  }
  return {
    bestand,
    faellig,
    heuteErfasst: laufendeZeile?.pruefungen ?? 0,
    offeneBerichte,
    laufende,
    letzteMitPruefungen: letzte,
    bisWann: "",
  };
}

/**
 * Ein Satz, ein Knopf — wie auf jeder Seite dieser App (Leitsatz 7). Kein „Begehung starten"
 * und kein „fortsetzen": der Termin entsteht beim Erfassen der ersten Tür von selbst.
 *
 * Darunter die Nebenwege als Knöpfe, nicht als Textlinks: es sind Griffe, keine Fußnoten, und
 * mit einem Daumen trifft man einen Knopf. Ist nichts fällig, gibt es oben keinen Knopf — dann
 * ist nichts zu tun, und ein Knopf, der nur „ansehen" sagt, ist keiner.
 */
function naechsterSchritt(o: Objekt, lage: Lage, bisWann: string): string {
  const id = esc(o.id);
  let satz: string;
  let knopf = "";
  /* Was oben als Hauptknopf steht, kommt unten nicht noch einmal. */
  let hauptweg = "";

  if (lage.bestand === 0) {
    satz = "Noch kein Bestand. Die erste erfasste Tür legt ihn an — diktiert im Chat oder hier.";
    knopf = `<a class="btn schmal" href="/objekt/${id}/erfassen">Erste Tür erfassen</a>`;
    hauptweg = "erfassen";
  } else if (lage.faellig > 0) {
    satz = lage.heuteErfasst
      ? `Heute ${lage.heuteErfasst} erfasst — ${lage.faellig} ${
          lage.faellig === 1 ? "fällige Tür fehlt" : "fällige Türen fehlen"
        } noch.`
      : `${lage.faellig} von ${lage.bestand} ${
          lage.faellig === 1 ? "Tür ist fällig" : "Türen sind fällig"
        }.`;
    knopf = `<a class="btn schmal" href="/objekt/${id}/erfassen">Tür erfassen</a>`;
    hauptweg = "erfassen";
  } else if (lage.offeneBerichte > 0) {
    satz = `Alles erfasst. ${lage.offeneBerichte} ${
      lage.offeneBerichte === 1 ? "Bericht steht" : "Berichte stehen"
    } aus.`;
    knopf = `<a class="btn schmal" href="/objekt/${id}/berichte">Berichte erstellen</a>`;
  } else {
    satz = bisWann
      ? `Nichts fällig — das Objekt ist bis ${esc(bisWann)} durch.`
      : "Nichts fällig.";
  }

  const weitere: string[] = [];
  if (hauptweg !== "erfassen") {
    weitere.push(`<a class="btn schmal leise" href="/objekt/${id}/erfassen">Tür erfassen</a>`);
  }
  if (lage.laufende) {
    weitere.push(
      `<a class="btn schmal leise" href="/begehung/${esc(
        lage.laufende.id,
      )}/unterschrift">Unterschrift</a>`,
    );
  }
  weitere.push(`<a class="btn schmal leise" href="/objekt/${id}/import">Bauplan einlesen</a>`);

  return `<div class="naechster">
<p class="satz">${esc(satz).replace("&amp;", "&")}</p>
<div class="knopfleiste" style="margin:0">${knopf}${weitere.join("")}</div>
</div>`;
}

export async function objektSeite(
  env: Env,
  nutzer: Nutzer,
  id: string,
  optionen: { meldung?: string; nurFaellige?: boolean } = {},
): Promise<Response> {
  const o = await objektLesen(env.DB, id);
  if (!o) return umleitung("/objekte");
  const geschosse = await geschosseListe(env.DB, o.id);
  const alle = inLaufreihenfolge(await bauteileMitStand(env.DB, o), geschosse);
  const faellige = alle.filter(istFaellig);
  const gezeigt = optionen.nurFaellige ? faellige : alle;
  const lage = await lageLesen(env, o, alle.length, faellige.length);
  const geschossName = new Map(geschosse.map((g) => [g.id, g.name]));

  /* „Bis wann ist Ruhe?" — der früheste Termin unter den Bauteilen, die es noch gibt. */
  const naechste = alle
    .filter((b) => b.aktiv && b.stand.faellig_am)
    .map((b) => b.stand.faellig_am)
    .sort()[0];

  const bauteilListe = gezeigt.length
    ? `<div class="liste">${gezeigt
        .map((b) => bauteilZeile(o, b, geschossName.get(b.geschoss_id ?? "") ?? ""))
        .join("")}</div>`
    : `<div class="leer">${
        optionen.nurFaellige
          ? "Nichts fällig — das Objekt ist für dieses Jahr durch."
          : "Noch keine Tür im Bestand."
      }</div>`;

  const filter = alle.length
    ? `<div class="zeile" style="justify-content:space-between;align-items:center;margin-top:30px">
<h2 class="abschnitt" style="margin:0">${
        optionen.nurFaellige ? `Fällig (${faellige.length})` : `Bestand (${alle.length})`
      }</h2>
<a class="btn schmal leise" href="/objekt/${esc(o.id)}${optionen.nurFaellige ? "" : "?faellig=1"}">
${optionen.nurFaellige ? "Alle zeigen" : "Nur fällige"}</a></div>
<div style="height:14px"></div>`
    : "";

  return seite(
    `${objektReiter(o.id, "bestand")}
${objektKopf(o)}
${naechsterSchritt(o, lage, naechste ? datumAnzeige(naechste) : "")}
${optionen.meldung ? `<div class="note" style="margin:22px 0">${esc(optionen.meldung)}</div>` : ""}
${filter}
${bauteilListe}
${stammdatenFormular(o)}`,
    { titel: o.name, nutzer, aktiv: "objekte" },
  );
}

/**
 * Die Stammdaten eines Termins — Prüfdatum, Prüfer, Befähigung, Ort. Sie stehen im Bericht,
 * also stehen sie beim Bericht. Der Status ist kein Feld mehr: abgeschlossen wird ein Termin
 * dadurch, dass Berichte daraus entstehen.
 */
function berichtStammdaten(b: Begehung): string {
  return `<details class="klapp">
<summary>Stammdaten des Berichts <span class="meta">${esc(
    [b.pruefer, b.befaehigung, b.ort].filter(Boolean).join(" · "),
  )}</span></summary>
<form class="karte" method="post" action="/begehung/${esc(b.id)}" style="margin-top:8px">
<div class="felder">
${datumsfeld("datum", "Prüfdatum", b.datum)}
${textfeld("pruefer", "Prüfer", b.pruefer)}
${textfeld("befaehigung", "Befähigungsnachweis", b.befaehigung)}
${textfeld("ort", "Prüfort", b.ort)}
${textfeld("beteiligte", "Beteiligte / Messgeräte", b.beteiligte)}
</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Speichern</button>
<span class="meta">Ändert sich etwas davon, entsteht beim nächsten Erzeugen eine neue Berichtsversion.</span></div>
</form>
</details>`;
}

/* ── Reiter „Berichte" ─────────────────────────────────────────────────────── */

export async function objektBerichteSeite(
  env: Env,
  nutzer: Nutzer,
  id: string,
  meldung?: string,
): Promise<Response> {
  const o = await objektLesen(env.DB, id);
  if (!o) return umleitung("/objekte");
  const termine = (await begehungenListe(env.DB, { objekt_id: o.id, limit: 20 })).filter(
    (b) => b.pruefungen > 0,
  );

  /* Der Dateiname eines Berichts ist unlesbar lang. In der Liste steht die Tür, die er meint. */
  const geschosse = await geschosseListe(env.DB, o.id);
  const geschossName = new Map(geschosse.map((g) => [g.id, g.name]));
  const orte = new Map(
    (await bauteileMitStand(env.DB, o, { auch_stillgelegte: true })).map((b) => [
      b.id,
      ortText(geschossName.get(b.geschoss_id ?? "") ?? "", b),
    ]),
  );

  const bloecke: string[] = [];
  let offenGesamt = 0;
  for (const zeile of termine) {
    const begehung = await begehungLesen(env.DB, zeile.id);
    if (!begehung) continue;
    const posten = await berichtsUebersicht(env, begehung, o);
    const sammel = await sammelberichteLesen(env.DB, begehung.id);
    const offen = zeile.pruefungen - posten.length + posten.filter((p) => p.veraltet).length;
    offenGesamt += Math.max(offen, 0);

    const dateien = posten
      .map(
        (p) => `<div class="posten">
<span class="nr">${p.nr}</span>
<div class="haupt"><div class="name"><a href="/datei/${esc(p.schluessel)}">Tür ${p.nr}${
          orte.get(p.bauteil_id) ? ` · ${esc(orte.get(p.bauteil_id)!)}` : ""
        }</a></div>
<div class="unter">Version ${p.version} · ${esc(zeitpunkt(p.erzeugt_am))}${
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
      .join("");

    const werkzeuge: string[] = [];
    if (offen > 0) {
      werkzeuge.push(
        `<button class="btn schmal" data-erzeugen="${esc(begehung.id)}">${offen} ${
          offen === 1 ? "Bericht" : "Berichte"
        } erstellen</button>`,
      );
    } else if (posten.length && !sammel.length) {
      werkzeuge.push(
        `<button class="btn schmal" data-sammel="${esc(begehung.id)}">Sammelbericht erstellen</button>`,
      );
    }
    if (posten.length) {
      werkzeuge.push(
        `<a class="btn schmal leise" href="/begehung/${esc(begehung.id)}/paket.zip">Alles als ZIP</a>`,
      );
    }

    bloecke.push(`<h2 class="abschnitt" style="margin-top:30px">${esc(
      datumAnzeige(begehung.datum),
    )} <span class="meta" style="font-weight:400">· ${zeile.pruefungen} ${
      zeile.pruefungen === 1 ? "Prüfung" : "Prüfungen"
    }${begehung.betreiber_unterschrift ? " · unterschrieben" : ""}</span></h2>
<div class="knopfleiste" style="margin:0 0 14px">${werkzeuge.join("")}</div>
${dateien ? `<div class="liste">${dateien}</div>` : '<div class="leer">Noch nichts erzeugt.</div>'}
${berichtStammdaten(begehung)}
${
  sammel.length
    ? `<div class="liste">${sammel
        .map(
          (sb) => `<a class="posten" href="/datei/${esc(sb.r2_schluessel)}">
<div class="haupt"><div class="name">Sammelbericht v${sb.version}</div>
<div class="unter">${esc(zeitpunkt(sb.erzeugt_am))}</div></div>
<span class="chip">PDF</span></a>`,
        )
        .join("")}</div>`
    : ""
}`);
  }

  const skript = `
const stand = document.getElementById('stand');
async function lauf(id, pfad, knopf, name) {
  knopf.disabled = true;
  let gesamt = 0;
  for (let runde = 0; runde < 40; runde++) {
    stand.textContent = name + ' …' + (gesamt ? ' ' + gesamt + ' fertig' : '');
    const r = await fetch('/begehung/' + id + pfad, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) { stand.textContent = d.fehler || 'Fehlgeschlagen.'; knopf.disabled = false; return; }
    gesamt += d.erzeugt || 0;
    if (d.fertig !== false) break;
  }
  location.reload();
}
document.querySelectorAll('[data-erzeugen]').forEach((k) => {
  k.addEventListener('click', () => lauf(k.dataset.erzeugen, '/erzeugen', k, 'Erstelle Berichte'));
});
document.querySelectorAll('[data-sammel]').forEach((k) => {
  k.addEventListener('click', () => lauf(k.dataset.sammel, '/sammelbericht', k, 'Erstelle Sammelbericht'));
});`;

  return seite(
    `${objektReiter(o.id, "berichte")}
${objektKopf(o)}
<div class="naechster"><p class="satz">${
      termine.length === 0
        ? "Noch nichts erfasst — Berichte entstehen aus den Prüfungen."
        : offenGesamt > 0
          ? `${offenGesamt} ${offenGesamt === 1 ? "Bericht steht" : "Berichte stehen"} aus.`
          : "Alle Berichte sind auf dem aktuellen Stand."
    }</p><span class="stand" id="stand">${meldung ? esc(meldung) : ""}</span></div>
${bloecke.join("") || ""}`,
    { titel: `Berichte ${o.name}`, nutzer, aktiv: "objekte", skript },
  );
}

/**
 * Die Ortsangabe einer Tür in einer Zeile. Seit die Etage eigenständig geführt wird, stand sie
 * oft zweimal da („EG · 0.01 · Haupteingang · EG"), weil der Monteur sie auch in `flur` diktiert
 * hat. Doppeltes fliegt raus — verglichen wird ohne Rücksicht auf Schreibweise.
 */
function ortText(
  geschoss: string,
  b: { raumnummer: string; raum: string; bezeichnung: string; flur: string },
): string {
  const teile: string[] = [];
  const gesehen = new Set<string>();
  for (const t of [geschoss, b.raumnummer, b.raum || b.bezeichnung, b.flur]) {
    const schluessel = t.trim().toLowerCase().replace(/[\s.]/g, "");
    if (!schluessel || gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    teile.push(t.trim());
  }
  return teile.join(" · ") || "ohne Ortsangabe";
}

/**
 * Eine Zeile im Bestand. Sie beantwortet die eine Frage, die der Bestand stellt: hat diese Tür
 * bestanden oder nicht? Mängel gibt es nicht mehr als eigene Ebene — was nicht in Ordnung war,
 * steht am Ergebnis und im Detail der Tür.
 */
function bauteilZeile(o: Objekt, b: BauteilBeschreibung, geschoss: string): string {
  const ort = ortText(geschoss, b);
  const geprueft = Boolean(b.letzte_pruefung);
  const bestanden = b.letztes_ergebnis === "bestanden";
  return `<a class="posten" href="/objekt/${esc(o.id)}/bauteil/${b.nr}">
<span class="nr">${b.nr}</span>
<div class="haupt"><div class="name">${esc(ort)}</div>
<div class="unter">${esc(VORLAGEN[b.art]?.label ?? b.art)}${
    b.kennung ? ` · ${esc(b.kennung)}` : ""
  }${b.letzte_pruefung ? ` · zuletzt ${esc(datumAnzeige(b.letzte_pruefung))}` : ""}${
    geprueft && !bestanden && b.letztes_ergebnis ? ` · ${esc(b.letztes_ergebnis)}` : ""
  }</div></div>
${
  geprueft
    ? bestanden
      ? '<span class="chip gut">bestanden</span>'
      : '<span class="chip mangel">nicht bestanden</span>'
    : '<span class="chip leise">noch nicht geprüft</span>'
}
${b.aktiv ? faelligChip(b.stand) : '<span class="chip leise">stillgelegt</span>'}</a>`;
}

type BauteilBeschreibung = BauteilMitStand;

function stammdatenFormular(o: Objekt): string {
  return `<details class="klapp">
<summary>Stammdaten <span class="meta">${esc(
    [o.betreiber, o.ident && `Ident ${o.ident}`, `alle ${o.intervall_monate} Monate`]
      .filter(Boolean)
      .join(" · "),
  )}</span></summary>
<form class="karte" method="post" action="/objekt/${esc(o.id)}" style="margin-top:8px">
<div class="felder">
${textfeld("name", "Name", o.name)}
${textfeld("adresse", "Adresse", o.adresse)}
${textfeld("plz", "PLZ", o.plz)}
${textfeld("objektart", "Objektart", o.objektart, 'placeholder="Kita, Schule, Bürogebäude"')}
${textfeld("betreiber", "Betreiber", o.betreiber)}
${textfeld("betreiber_kontakt", "Ansprechpartner vor Ort", o.betreiber_kontakt)}
${textfeld("telefon", "Telefon", o.telefon)}
${textfeld("email", "E-Mail", o.email)}
${textfeld("vertrag", "Wartungsvertrag / Auftrag", o.vertrag)}
${textfeld("ident", "Ident-Nummer", o.ident)}
${textfeld("intervall_monate", "Intervall (Monate)", String(o.intervall_monate))}
</div>
<div class="feld" style="margin-top:16px"><label for="zugang">Zugang</label>
<textarea class="field" id="zugang" name="zugang"
  placeholder="Schlüssel beim Hausmeister · Anmeldung im Sekretariat · Codeschloss">${esc(o.zugang)}</textarea>
<p class="meta" style="margin-top:6px">Steht in der Tour und beim Objekt — das Feld, das die
vergebliche Anfahrt verhindert.</p></div>
<div class="feld" style="margin-top:16px"><label for="rechtsgrundlagen">Rechtsgrundlagen</label>
<textarea class="field" id="rechtsgrundlagen" name="rechtsgrundlagen" placeholder="leer = Standard je Vorlage">${esc(o.rechtsgrundlagen)}</textarea></div>
<div class="feld" style="margin-top:16px"><label for="notizen">Notizen</label>
<textarea class="field" id="notizen" name="notizen">${esc(o.notizen)}</textarea></div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Stammdaten speichern</button>
<span class="meta">Wirkt auf künftige Berichte; erzeugte Versionen bleiben.</span></div>
</form>
<form method="post" action="/objekt/${esc(o.id)}/loeschen" class="knopfleiste"
  onsubmit="return confirm('${esc(o.name)} mit allen Begehungen, Prüfungen, Mängeln und Berichten löschen?')">
<button class="btn schmal gefahr" type="submit">Objekt löschen</button>
<span class="meta">Endgültig. Im Alltag lieber stilllegen — die Historie ist der Wert.</span>
</form>
</details>`;
}
