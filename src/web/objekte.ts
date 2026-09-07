/**
 * Objektseiten: die Liste nach Fälligkeit und das einzelne Objekt mit seinem Bestand.
 *
 * Die Liste ist die Startseite — was zuerst dran ist, steht oben. Auf der Objektseite steht
 * der Bestand in Laufreihenfolge: so, wie man das Haus abgeht.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import {
  datum as datumAnzeige,
  esc,
  faelligChip,
  seite,
  textfeld,
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
import { begehungenListe } from "../daten/begehungen";
import { heute as heuteIso } from "../daten/basis";
import { maengelListe } from "../daten/maengel";

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
${o.offene_maengel ? `<span class="chip mangel">${o.offene_maengel} Mängel</span>` : ""}
${faelligChip(o.stand)}</a>`,
        )
        .join("")}</div>`
    : `<div class="leer">Noch kein Objekt angelegt.<br>Diktiere im Chat oder lege hier eines an.</div>`;

  const neu = `<h2 class="abschnitt">Neues Objekt</h2>
<form class="karte" method="post" action="/objekte">
<div class="felder">
  ${textfeld("name", "Name", "", 'required placeholder="Kita Heselstücken"')}
  ${textfeld("adresse", "Adresse", "", 'placeholder="Heselstücken 12, 22523 Hamburg"')}
  ${textfeld("betreiber", "Betreiber")}
  ${textfeld("intervall_monate", "Intervall (Monate)", "12")}
</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Objekt anlegen</button></div>
</form>`;

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
  const begehungen = await begehungenListe(env.DB, { objekt_id: o.id, limit: 10 });
  /* Läuft heute schon eine? Dann setzt der Knopf sie fort — und sagt das auch. */
  const laufende = begehungen.find(
    (b) => b.datum === heuteIso() && b.status !== "abgeschlossen" && b.status !== "abgebrochen",
  );
  const maengel = await maengelListe(env.DB, { objekt_id: o.id, status: "offen" });
  const geschossName = new Map(geschosse.map((g) => [g.id, g.name]));

  const kopf = `<div class="zeile oben">
<div><div class="eyebrow">Objekt</div>
<h1 class="seite" style="margin-top:8px">${esc(o.name)}</h1>
<p class="meta" style="margin-top:8px">${esc(o.adresse || "ohne Adresse")}${
    o.betreiber ? ` · ${esc(o.betreiber)}` : ""
  }</p></div></div>

<div class="zahlen">
<div class="zahl"><div class="wert">${alle.length}</div><div class="was">BAUTEILE</div></div>
<div class="zahl"><div class="wert">${faellige.length}</div><div class="was">FÄLLIG</div></div>
<div class="zahl"><div class="wert">${maengel.length}</div><div class="was">OFFENE MÄNGEL</div></div>
<div class="zahl"><div class="wert">${begehungen.length}</div><div class="was">BEGEHUNGEN</div></div>
</div>

<form method="post" action="/objekt/${esc(o.id)}/begehung" class="knopfleiste" style="margin-top:0">
<button class="btn schmal" type="submit">${
    laufende ? "Begehung fortsetzen" : "Begehung starten"
  }</button>
${laufende ? `<span class="meta">vom ${esc(datumAnzeige(laufende.datum))}, ${laufende.pruefungen} von ${alle.length} erfasst</span>` : ""}
<a class="btn schmal leise" href="/objekt/${esc(o.id)}/bauteil/neu">Bauteil hinzufügen</a>
<a class="btn schmal leise" href="/objekt/${esc(o.id)}/import">Import</a>
<a class="btn schmal leise" href="/objekt/${esc(o.id)}/geschosse">Geschosse</a>
</form>`;

  const bauteilListe = gezeigt.length
    ? `<div class="liste">${gezeigt
        .map((b) => bauteilZeile(o, b, geschossName.get(b.geschoss_id ?? "") ?? ""))
        .join("")}</div>`
    : `<div class="leer">${
        optionen.nurFaellige ? "Nichts fällig — das Objekt ist für dieses Jahr durch." : "Noch kein Bauteil im Bestand."
      }</div>`;

  const begehungListe = begehungen.length
    ? `<h2 class="abschnitt">Begehungen</h2><div class="liste">${begehungen
        .map(
          (b) => `<a class="posten" href="/begehung/${esc(b.id)}">
<div class="haupt"><div class="name">${esc(datumAnzeige(b.datum))}</div>
<div class="unter">${esc(b.pruefer || "ohne Prüfer")} · ${b.pruefungen} ${
            b.pruefungen === 1 ? "Prüfung" : "Prüfungen"
          }</div></div>
${b.mit_abweichung ? `<span class="chip mangel">${b.mit_abweichung} mit Abweichung</span>` : ""}
<span class="chip${b.status === "abgeschlossen" ? " gut" : ""}">${esc(b.status)}</span>
${b.betreiber_unterschrift ? '<span class="chip voll">unterschrieben</span>' : ""}</a>`,
        )
        .join("")}</div>`
    : "";

  const mangelListe = maengel.length
    ? `<h2 class="abschnitt">Offene Mängel</h2><div class="liste">${maengel
        .map(
          (m) => `<a class="posten" href="/mangel/${esc(m.id)}">
<span class="nr">${m.bauteil_nr}</span>
<div class="haupt"><div class="name">${esc(m.beschreibung || "ohne Beschreibung")}</div>
<div class="unter">Tür ${m.bauteil_nr}${m.bauteil_raum ? ` · ${esc(m.bauteil_raum)}` : ""} · ${esc(
            m.zustaendig,
          )}${m.frist ? ` · Frist ${esc(datumAnzeige(m.frist))}` : ""}</div></div>
<span class="chip${m.prioritaet === "hoch" ? " mangel" : ""}">${esc(m.prioritaet)}</span></a>`,
        )
        .join("")}</div>`
    : "";

  return seite(
    `${kopf}
${optionen.meldung ? `<div class="note" style="margin:22px 0">${esc(optionen.meldung)}</div>` : ""}
<div class="zeile" style="justify-content:space-between;align-items:center;margin-top:36px">
<h2 class="abschnitt" style="margin:0">Bestand</h2>
<a class="btn schmal leise" href="/objekt/${esc(o.id)}${optionen.nurFaellige ? "" : "?faellig=1"}">
${optionen.nurFaellige ? "Alle zeigen" : "Nur fällige"}</a></div>
<div style="height:14px"></div>
${bauteilListe}
${mangelListe}
${begehungListe}
${stammdatenFormular(o)}`,
    { titel: o.name, nutzer, aktiv: "objekte" },
  );
}

function bauteilZeile(o: Objekt, b: BauteilBeschreibung, geschoss: string): string {
  const ort =
    [geschoss, b.raumnummer, b.raum || b.bezeichnung, b.flur].filter(Boolean).join(" · ") ||
    "ohne Ortsangabe";
  return `<a class="posten" href="/objekt/${esc(o.id)}/bauteil/${b.nr}">
<span class="nr">${b.nr}</span>
<div class="haupt"><div class="name">${esc(ort)}</div>
<div class="unter">${esc(VORLAGEN[b.art]?.label ?? b.art)}${
    b.kennung ? ` · ${esc(b.kennung)}` : ""
  }${b.letzte_pruefung ? ` · zuletzt ${esc(datumAnzeige(b.letzte_pruefung))}` : ""}</div></div>
${b.offene_maengel ? `<span class="chip mangel">${b.offene_maengel} Mängel</span>` : ""}
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
${textfeld("betreiber", "Betreiber", o.betreiber)}
${textfeld("betreiber_kontakt", "Ansprechpartner vor Ort", o.betreiber_kontakt)}
${textfeld("ident", "Ident-Nummer", o.ident)}
${textfeld("intervall_monate", "Intervall (Monate)", String(o.intervall_monate))}
</div>
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

/* ── Geschosse ─────────────────────────────────────────────────────────────── */

export async function geschosseSeite(
  env: Env,
  nutzer: Nutzer,
  id: string,
  meldung?: string,
): Promise<Response> {
  const o = await objektLesen(env.DB, id);
  if (!o) return umleitung("/objekte");
  const geschosse = await geschosseListe(env.DB, o.id);
  const bauteile = await bauteileMitStand(env.DB, o, { auch_stillgelegte: true });
  const zahl = new Map<string, number>();
  for (const b of bauteile) {
    const k = b.geschoss_id ?? "";
    zahl.set(k, (zahl.get(k) ?? 0) + 1);
  }

  const zeilen = geschosse
    .map(
      (g) => `<div class="posten" style="align-items:flex-end">
<div class="feld" style="flex:1 1 200px;margin:0">
  <label for="name_${esc(g.id)}">Name</label>
  <input class="field" id="name_${esc(g.id)}" name="name_${esc(g.id)}" value="${esc(g.name)}">
</div>
<div class="feld" style="flex:0 0 110px;margin:0">
  <label for="reihenfolge_${esc(g.id)}">Reihenfolge</label>
  <input class="field" id="reihenfolge_${esc(g.id)}" name="reihenfolge_${esc(g.id)}"
    value="${g.reihenfolge}" inputmode="numeric">
</div>
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-bottom:9px">
<span class="chip leise">${zahl.get(g.id) ?? 0} Bauteile</span>
<a class="chip" href="/objekt/${esc(o.id)}/plan/${esc(g.id)}">${
        g.plan_schluessel ? "Plan ansehen" : "Plan hinterlegen"
      }</a>
${
  (zahl.get(g.id) ?? 0) === 0 && geschosse.length > 1
    ? `<button class="chip mangel" name="loeschen" value="${esc(g.id)}"
        style="background:none;cursor:pointer;font:inherit;font-size:.78rem"
        onclick="return confirm('Geschoss ${esc(g.name)} entfernen?')">entfernen</button>`
    : ""
}
</div></div>`,
    )
    .join("");

  return seite(
    `<div class="eyebrow"><a href="/objekt/${esc(o.id)}">${esc(o.name)}</a></div>
<h1 class="seite" style="margin-top:8px">Geschosse</h1>
<p class="lede" style="margin-top:12px;max-width:52ch">Die Reihenfolge bestimmt, wie das Haus
abgegangen wird: Untergeschoss −1, Erdgeschoss 0, erstes Obergeschoss 1 und so fort. Sie kommt
beim Anlegen aus dem Namen und lässt sich hier nachziehen.</p>
${meldung ? `<div class="note" style="margin:22px 0">${esc(meldung)}</div>` : ""}

<form method="post" action="/objekt/${esc(o.id)}/geschosse" style="margin-top:24px">
<div class="liste">${zeilen}</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Änderungen speichern</button>
<a class="btn schmal leise" href="/objekt/${esc(o.id)}">Zurück zum Objekt</a></div>
</form>

<h2 class="abschnitt">Geschoss hinzufügen</h2>
<form class="karte" method="post" action="/objekt/${esc(o.id)}/geschosse">
<div class="felder">
${textfeld("neu", "Name", "", 'placeholder="z. B. UG, 2. OG, Anbau" required')}
</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Hinzufügen</button>
<span class="meta">Aus „UG", „EG", „2. OG" liest Türwerk die Reihenfolge selbst.</span></div>
</form>
${
  zahl.get("")
    ? `<p class="meta" style="margin-top:22px">${zahl.get("")} Bauteile hängen an keinem
Geschoss — sie laufen in der Reihenfolge hinten mit. Auf der Bauteilseite lässt sich das
nachtragen.</p>`
    : ""
}`,
    { titel: "Geschosse", nutzer, aktiv: "objekte" },
  );
}

export { heute };
