/**
 * Die Bauteilseite: ein Bauteil mit allem, was über die Jahre daran hängt.
 *
 * Das ist die Seite, die es in v1 nicht gab und die v2 ausmacht — Stammdaten oben,
 * darunter die Prüfungen aller Begehungen, die Mängel, die Fotos und jede Berichtsversion.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import {
  auswahlfeld,
  datum as datumAnzeige,
  esc,
  faelligChip,
  seite,
  textfeld,
  umleitung,
  zeitpunkt,
} from "./layout";
import { VORLAGEN, VORLAGEN_IDS, abweichungenKlartext, feldLabel, vorlage } from "../vorlagen";
import { geschosseListe, objektLesen } from "../daten/objekte";
import { bauteileMitStand } from "../daten/bauteile";
import { pruefungenHistorie } from "../daten/begehungen";
import { maengelZuBauteil } from "../daten/maengel";
import { fotosZuBauteil } from "../daten/fotos";
import { fotoBereich } from "./fotos";
import { berichteZuPruefung } from "../daten/berichte";

export async function bauteilSeite(
  env: Env,
  nutzer: Nutzer,
  objektId: string,
  nr: number | null,
  meldung?: string,
): Promise<Response> {
  const o = await objektLesen(env.DB, objektId);
  if (!o) return umleitung("/objekte");
  const geschosse = await geschosseListe(env.DB, o.id);
  const alle = await bauteileMitStand(env.DB, o, { auch_stillgelegte: true });
  const b = nr === null ? null : (alle.find((x) => x.nr === nr) ?? null);
  if (nr !== null && !b) return umleitung(`/objekt/${o.id}`);

  const naechste = alle.length ? Math.max(...alle.map((x) => x.nr)) + 1 : 1;
  const art = b?.art ?? alle[alle.length - 1]?.art ?? VORLAGEN_IDS[0];
  const v = vorlage(art);

  const geschossAuswahl = auswahlfeld(
    "geschoss_id",
    "Geschoss",
    [{ wert: "", text: "— ohne —" }, ...geschosse.map((g) => ({ wert: g.id, text: g.name }))],
    b?.geschoss_id ?? geschosse[0]?.id ?? "",
  );

  const stammdaten = `<form class="karte" method="post" action="/objekt/${esc(o.id)}/bauteil/${
    b ? b.nr : "neu"
  }">
<div class="felder">
${textfeld("nr", "Nummer", String(b?.nr ?? naechste), b ? 'aria-describedby="nrhinweis"' : "")}
${textfeld("kennung", "Kennung (Türliste/Plan)", b?.kennung ?? "")}
${auswahlfeld(
  "art",
  "Vorlage",
  VORLAGEN_IDS.map((id) => ({ wert: id, text: VORLAGEN[id].label })),
  art,
)}
${geschossAuswahl}
${textfeld("raumnummer", "Raumnummer", b?.raumnummer ?? "")}
${textfeld("raum", "Raum", b?.raum ?? "")}
${textfeld("flur", "Flur", b?.flur ?? "")}
${textfeld("bezeichnung", "Bezeichnung", b?.bezeichnung ?? "")}
${textfeld("intervall_monate", "Eigenes Intervall (Monate)", b?.intervall_monate ? String(b.intervall_monate) : "")}
</div>

${b ? '<p class="meta" id="nrhinweis" style="margin-top:-8px">Die Nummer ist die, die diktiert wird. Ändern verschiebt sie für alle Jahre — nur tun, wenn die Nummerierung wirklich falsch war.</p>' : ""}

<h2 class="abschnitt">Felder</h2>
<p class="meta">Stammdaten des Bauteils — sie gelten fürs nächste Jahr weiter.</p>
<div class="felder" style="margin-top:14px">
${v.bauteilfelder
  .filter((f) => !["RAUM", "FLUR", "RAUMBEZ"].includes(f))
  .map((f) => textfeld(`f_${f}`, feldLabel(f), b?.felder[f] ?? ""))
  .join("")}
</div>

<div style="margin-top:22px;display:grid;gap:10px">
<label style="display:flex;align-items:center;gap:10px;font-size:.9rem">
  <input type="checkbox" name="wartungspflichtig" value="1" style="width:18px;height:18px" ${
    !b || b.wartungspflichtig ? "checked" : ""
  }> wartungspflichtig
  <span class="meta">ohne Haken bleibt das Bauteil im Bestand, wird aber nie fällig</span></label>
<label style="display:flex;align-items:center;gap:10px;font-size:.9rem">
  <input type="checkbox" name="aktiv" value="1" style="width:18px;height:18px" ${
    !b || b.aktiv ? "checked" : ""
  }> in Betrieb
  <span class="meta">ohne Haken ausgebaut oder stillgelegt — die Historie bleibt</span></label>
</div>
<div class="knopfleiste">
<button class="btn schmal" type="submit">${b ? "Speichern" : "Bauteil anlegen"}</button>
<a class="btn schmal leise" href="/objekt/${esc(o.id)}">Zurück</a></div>
</form>`;

  if (!b) {
    return seite(
      `<div class="eyebrow">${esc(o.name)}</div>
<h1 class="seite" style="margin-top:8px">Neues Bauteil</h1>
<div style="height:22px"></div>
${stammdaten}`,
      { titel: "Neues Bauteil", nutzer, aktiv: "objekte" },
    );
  }

  const historie = await pruefungenHistorie(env.DB, b.id);
  const maengel = await maengelZuBauteil(env.DB, b.id);
  const fotos = await fotosZuBauteil(env.DB, b.id);

  const berichteJePruefung = new Map<string, { version: number; r2_schluessel: string }[]>();
  for (const p of historie) {
    berichteJePruefung.set(p.id, await berichteZuPruefung(env.DB, p.id));
  }

  const pruefungListe = historie.length
    ? `<div class="liste">${historie
        .map((p) => {
          const abweichungen = abweichungenKlartext(b.art, p.checks);
          const versionen = berichteJePruefung.get(p.id) ?? [];
          return `<div class="posten" style="align-items:flex-start">
<div class="haupt"><div class="name">${esc(datumAnzeige(p.datum))} · ${esc(p.ergebnis)}</div>
<div class="unter">${esc(p.pruefer || "ohne Prüfer")}${
            abweichungen.length ? ` · ${esc(abweichungen.join(" · "))}` : " · alles in Ordnung"
          }${p.hinweise ? ` · ${esc(p.hinweise)}` : ""}</div>
${
  versionen.length
    ? `<div class="unter" style="margin-top:6px">${versionen
        .map(
          (r) =>
            `<a href="/datei/${esc(r.r2_schluessel)}" style="text-decoration:underline">v${r.version}</a>`,
        )
        .join(" · ")}</div>`
    : ""
}</div>
${
  abweichungen.length
    ? `<span class="chip mangel">${abweichungen.length} ${
        abweichungen.length === 1 ? "Abweichung" : "Abweichungen"
      }</span>`
    : '<span class="chip gut">i.O.</span>'
}
<a class="chip" href="/begehung/${esc(p.begehung_id)}">Begehung ansehen ›</a></div>`;
        })
        .join("")}</div>`
    : `<div class="leer">Noch nie geprüft.</div>`;

  /*
   * Kein eigener Mängelbereich mehr: was nicht in Ordnung war, steht in der Historie an seiner
   * Prüfung. Hier bleibt nur, was aus früheren Jahren noch offen ist — das ist die Information,
   * nach der beim nächsten Mal gefragt wird.
   */
  const offen = maengel.filter((m) => m.status === "offen" || m.status === "in_arbeit");
  const mangelListe = offen.length
    ? `<h2 class="abschnitt">Aus früheren Prüfungen offen</h2><div class="liste">${offen
        .map(
          (m) => `<div class="posten">
<div class="haupt"><div class="name">${esc(m.beschreibung || "ohne Beschreibung")}</div>
<div class="unter">seit ${esc(datumAnzeige(new Date(m.angelegt_am).toISOString().slice(0, 10)))}${
            m.punkte.length ? ` · Punkt ${esc(m.punkte.join(", "))}` : ""
          }</div></div></div>`,
        )
        .join("")}</div>`
    : "";

  const fotoListe = fotos.length
    ? `<h2 class="abschnitt">Fotos</h2>
<p class="meta">Alle Jahre, jüngste zuerst.</p>
${fotoBereich(fotos, null)}`
    : "";

  const ort =
    [b.raumnummer, b.raum || b.bezeichnung, b.flur].filter(Boolean).join(" · ") || "ohne Ortsangabe";

  return seite(
    `<div class="zeile oben"><div>
<div class="eyebrow">${esc(o.name)}</div>
<h1 class="seite" style="margin-top:8px">Tür ${b.nr}</h1>
<p class="meta" style="margin-top:8px">${esc(ort)} · ${esc(VORLAGEN[b.art]?.label ?? b.art)}</p></div>
<div>${faelligChip(b.stand)}</div></div>
${meldung ? `<div class="note" style="margin-bottom:22px">${esc(meldung)}</div>` : ""}

<div class="naechster"><p class="satz">${esc(
      [
        historie.length
          ? `${historie.length} ${historie.length === 1 ? "Prüfung" : "Prüfungen"}, zuletzt ${
              datumAnzeige(b.letzte_pruefung) || "nie"
            }`
          : "Noch nie geprüft",
        b.letzte_pruefung
          ? b.letztes_ergebnis === "bestanden"
            ? "zuletzt bestanden"
            : `zuletzt ${b.letztes_ergebnis || "nicht bestanden"}`
          : "noch kein Ergebnis",
      ].join(" · "),
    )}.</p></div>

<h2 class="abschnitt">Historie</h2>
${pruefungListe}
${mangelListe}
${fotoListe}

<details class="klapp">
<summary>Stammdaten <span class="meta">${esc(
      [b.kennung && `Kennung ${b.kennung}`, VORLAGEN[b.art]?.label ?? b.art, b.felder.HERSTELLER]
        .filter(Boolean)
        .join(" · "),
    )}</span></summary>
${stammdaten}
<p class="meta" style="margin-top:14px">Angelegt ${esc(zeitpunkt(b.angelegt_am))} · Quelle ${esc(b.quelle)}</p>
</details>`,
    { titel: `Tür ${b.nr}`, nutzer, aktiv: "objekte" },
  );
}
