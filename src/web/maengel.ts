/**
 * Mängelseiten: die Liste über alle Objekte und der einzelne Mangel.
 *
 * Ein Mangel bleibt offen, bis ihn jemand freimeldet — die Liste ist deshalb nach Frist
 * sortiert und nicht nach Entstehung.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import {
  auswahlfeld,
  datum as datumAnzeige,
  datumsfeld,
  esc,
  seite,
  textfeld,
  umleitung,
  zeitpunkt,
} from "./layout";
import { heute, tageBis } from "../daten/basis";
import { objektLesen, objekteListe } from "../daten/objekte";
import { bauteilLesen } from "../daten/bauteile";
import { mangelLesen, maengelListe } from "../daten/maengel";

export async function maengelSeite(
  env: Env,
  nutzer: Nutzer,
  filter: { objekt?: string; status?: string; faellig_bis?: string },
): Promise<Response> {
  const status = filter.status || "offen";
  const liste = await maengelListe(env.DB, {
    objekt_id: filter.objekt || undefined,
    status,
    faellig_bis: filter.faellig_bis || undefined,
  });
  const objekte = await objekteListe(env.DB, { limit: 500 });

  const zeilen = liste.length
    ? `<div class="liste">${liste
        .map((m) => {
          const ueberfaellig = m.frist ? tageBis(m.frist) < 0 : false;
          return `<a class="posten" href="/mangel/${esc(m.id)}">
<span class="nr">${m.bauteil_nr}</span>
<div class="haupt"><div class="name">${esc(m.beschreibung || "ohne Beschreibung")}</div>
<div class="unter">${esc(m.objekt_name)}${
            m.bauteil_raum ? ` · ${esc(m.bauteil_raum)}` : ""
          } · ${esc(m.zustaendig)}${m.punkte.length ? ` · Punkt ${esc(m.punkte.join(", "))}` : ""}</div></div>
${
  m.frist
    ? `<span class="chip${ueberfaellig ? " mangel" : ""}">Frist ${esc(datumAnzeige(m.frist))}</span>`
    : '<span class="chip leise">ohne Frist</span>'
}
<span class="chip${m.prioritaet === "hoch" ? " mangel" : " leise"}">${esc(m.prioritaet)}</span></a>`;
        })
        .join("")}</div>`
    : `<div class="leer">Nichts offen.</div>`;

  return seite(
    `<div class="zeile oben"><h1 class="seite">Mängel</h1></div>
<form method="get" class="karte" style="margin-bottom:26px">
<div class="felder">
${auswahlfeld(
  "objekt",
  "Objekt",
  [{ wert: "", text: "— alle —" }, ...objekte.map((o) => ({ wert: o.id, text: o.name }))],
  filter.objekt ?? "",
)}
${auswahlfeld(
  "status",
  "Status",
  ["offen", "in_arbeit", "behoben", "verworfen", "alle"].map((s) => ({ wert: s, text: s })),
  status,
)}
${datumsfeld("faellig_bis", "Frist bis", filter.faellig_bis ?? "")}
</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Filtern</button>
<a class="btn schmal leise" href="/maengel">Zurücksetzen</a></div>
</form>
${zeilen}`,
    { titel: "Mängel", nutzer, aktiv: "maengel" },
  );
}

export async function mangelSeite(
  env: Env,
  nutzer: Nutzer,
  id: string,
  meldung?: string,
): Promise<Response> {
  const m = await mangelLesen(env.DB, id);
  if (!m) return umleitung("/maengel");
  const objekt = await objektLesen(env.DB, m.objekt_id);
  const bauteil = await bauteilLesen(env.DB, m.bauteil_id);
  const offen = m.status === "offen" || m.status === "in_arbeit";

  return seite(
    `<div class="eyebrow">${
      objekt
        ? `<a href="/objekt/${esc(objekt.id)}">${esc(objekt.name)}</a>${
            bauteil ? ` · <a href="/objekt/${esc(objekt.id)}/bauteil/${bauteil.nr}">Tür ${bauteil.nr}</a>` : ""
          }`
        : "Mangel"
    }</div>
<h1 class="seite" style="margin-top:8px">${esc(m.beschreibung || "Mangel")}</h1>
<p class="meta" style="margin-top:8px">Seit ${esc(zeitpunkt(m.angelegt_am))}${
      m.punkte.length ? ` · Punkt ${esc(m.punkte.join(", "))}` : ""
    }${m.behoben_am ? ` · behoben ${esc(zeitpunkt(m.behoben_am))} von ${esc(m.behoben_von)}` : ""}</p>
${meldung ? `<div class="note" style="margin:22px 0">${esc(meldung)}</div>` : ""}

<form class="karte" method="post" action="/mangel/${esc(m.id)}" style="margin-top:22px">
<div class="feld"><label for="beschreibung">Beschreibung</label>
<textarea class="field" id="beschreibung" name="beschreibung">${esc(m.beschreibung)}</textarea></div>
<div class="felder" style="margin-top:16px">
${auswahlfeld(
  "prioritaet",
  "Priorität",
  ["hoch", "mittel", "niedrig"].map((p) => ({ wert: p, text: p })),
  m.prioritaet,
)}
${datumsfeld("frist", "Frist", m.frist ?? "")}
${textfeld("zustaendig", "Zuständig", m.zustaendig)}
${auswahlfeld(
  "status",
  "Status",
  ["offen", "in_arbeit", "behoben", "verworfen"].map((s) => ({ wert: s, text: s })),
  m.status,
)}
</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Speichern</button>
<a class="btn schmal leise" href="/maengel">Zur Liste</a></div>
</form>

${
  offen
    ? `<h2 class="abschnitt">Freimelden</h2>
<form class="karte" method="post" action="/mangel/${esc(m.id)}/schliessen">
<div class="feld"><label for="freimeldung">Was wurde gemacht?</label>
<input class="field" id="freimeldung" name="freimeldung" placeholder="Dichtung getauscht"></div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Als behoben melden</button></div>
</form>`
    : m.freimeldung
      ? `<h2 class="abschnitt">Freimeldung</h2><p class="body">${esc(m.freimeldung)}</p>`
      : ""
}`,
    { titel: "Mangel", nutzer, aktiv: "maengel" },
  );
}

export { heute };
