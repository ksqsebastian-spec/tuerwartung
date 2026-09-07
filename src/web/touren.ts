/**
 * Touren — was als Nächstes dran ist, als eine Liste statt als Kalender.
 *
 * Vorher stand hier ein Wochenraster: sieben Karten, von denen sechs „frei" sagten, dazu
 * Glyphen-Knöpfe ohne Beschriftung. Auf dem Telefon war das anderthalb Bildschirme leere
 * Kästen für eine Frage, die eine Zeile braucht: was fahre ich als Nächstes?
 *
 * Also eine Liste, nach Dringlichkeit sortiert. Was auf einen Tag gelegt wurde, steht oben
 * unter seinem Datum mit einem fertigen Maps-Link; alles andere steht darunter nach
 * Fälligkeit. Geplant wird im Gespräch (`tour_planen`) oder mit dem Knopf „Für heute
 * einplanen" — ein Termin ist kein Kalender.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import { datum as datumAnzeige, esc, faelligChip, seite } from "./layout";
import { heute } from "../daten/basis";
import { objektLesen, objekteListe } from "../daten/objekte";
import type { Objekt, ObjektMitStand } from "../daten/objekte";
import { mapsLink, tagePlus, tourenZeitraum } from "../daten/touren";

/** Ein Objekt ohne Stand — für Einträge, die nur über die Tour hereinkommen. */
function ohneStand(o: Objekt): ObjektMitStand {
  return {
    ...o,
    bauteile: 0,
    faellige_bauteile: 0,
    offene_maengel: 0,
    letzte_begehung: null,
    stand: { faellig_am: "", zustand: "ok" as const, tage: null, nie_geprueft: false },
  };
}

export async function tourenSeite(
  env: Env,
  nutzer: Nutzer,
  optionen: { woche?: string; meldung?: string } = {},
): Promise<Response> {
  const heuteIso = heute();
  /* Vier Wochen nach vorn genügen: weiter plant ohnehin niemand im Voraus. */
  const touren = (
    await tourenZeitraum(env.DB, nutzer.benutzer, tagePlus(heuteIso, -1), tagePlus(heuteIso, 28))
  ).filter((t) => t.objekte.length);

  const alle = await objekteListe(env.DB, { limit: 500 });
  const nachId = new Map(alle.map((o) => [o.id, o]));
  for (const t of touren) {
    for (const id of t.objekte) {
      if (!nachId.has(id)) {
        const o = await objektLesen(env.DB, id);
        if (o) nachId.set(id, ohneStand(o));
      }
    }
  }

  const geplant = new Set(touren.flatMap((t) => t.objekte));
  const offen = alle
    .filter((o) => o.faellige_bauteile > 0 && !geplant.has(o.id))
    .sort((a, b) => (a.stand.tage ?? 0) - (b.stand.tage ?? 0) || a.plz.localeCompare(b.plz));

  /* ── Geplante Tage ─────────────────────────────────────────────────────── */
  const tage = touren
    .map((t) => {
      const objekte = t.objekte.map((id) => nachId.get(id)).filter(Boolean) as Objekt[];
      const link = mapsLink(objekte);
      const wann =
        t.datum === heuteIso
          ? "Heute"
          : t.datum === tagePlus(heuteIso, 1)
            ? "Morgen"
            : datumAnzeige(t.datum);
      return `<h2 class="abschnitt" style="margin-top:26px">${esc(wann)} <span class="meta"
  style="font-weight:400">· ${objekte.length} ${objekte.length === 1 ? "Objekt" : "Objekte"}</span></h2>
${
  link
    ? `<div class="leiseleiste"><a href="${esc(link)}" target="_blank" rel="noopener">Route in Google Maps</a></div>`
    : ""
}
<div class="liste">${objekte
        .map(
          (o, pos) => `<div class="posten">
<span class="nr">${pos + 1}</span>
<div class="haupt"><div class="name"><a href="/objekt/${esc(o.id)}">${esc(o.name)}</a></div>
<div class="unter">${esc(o.adresse || "ohne Adresse")}</div></div>
<form method="post" action="/touren" style="display:inline">
<input type="hidden" name="datum" value="${esc(t.datum)}">
<input type="hidden" name="objekt" value="${esc(o.id)}">
<button class="alsLink" name="tun" value="weg" type="submit">absagen</button>
</form></div>`,
        )
        .join("")}</div>`;
    })
    .join("");

  /* ── Was sonst ansteht ─────────────────────────────────────────────────── */
  const offeneListe = offen.length
    ? `<div class="liste">${offen
        .slice(0, 40)
        .map(
          (o) => `<div class="posten">
<div class="haupt"><div class="name"><a href="/objekt/${esc(o.id)}">${esc(o.name)}</a></div>
<div class="unter">${esc(o.adresse || "ohne Adresse")} · ${o.faellige_bauteile} fällig${
            o.offene_maengel ? ` · ${o.offene_maengel} offene Mängel` : ""
          }</div></div>
${faelligChip(o.stand)}
<form method="post" action="/touren" style="display:inline">
<input type="hidden" name="objekt" value="${esc(o.id)}">
<input type="hidden" name="tun" value="dazu">
<button class="alsLink" name="datum" value="${esc(heuteIso)}" type="submit">für heute</button>
</form></div>`,
        )
        .join("")}</div>`
    : `<div class="leer">Nichts fällig. Das ist der Normalzustand, wenn alles läuft.</div>`;

  const satz = touren.length
    ? offen.length
      ? `${touren.length} ${touren.length === 1 ? "geplanter Tag" : "geplante Tage"}, ${
          offen.length
        } ${offen.length === 1 ? "Objekt wartet" : "Objekte warten"} noch.`
      : `${touren.length} ${
          touren.length === 1 ? "geplanter Tag" : "geplante Tage"
        } — sonst ist nichts fällig.`
    : offen.length
      ? `${offen.length} ${
          offen.length === 1 ? "Objekt ist fällig" : "Objekte sind fällig"
        } — nichts davon ist auf einen Tag gelegt.`
      : "Nichts fällig und nichts geplant.";

  return seite(
    `<h1 class="seite">Touren</h1>
<div class="naechster"><p class="satz">${esc(satz)}</p></div>
${optionen.meldung ? `<div class="note" style="margin-bottom:22px">${esc(optionen.meldung)}</div>` : ""}
${tage}
<h2 class="abschnitt" style="margin-top:${touren.length ? 34 : 26}px">Fällig</h2>
<p class="meta" style="margin-bottom:14px">Nach Dringlichkeit, dann nach Postleitzahl.</p>
${offeneListe}`,
    { titel: "Touren", nutzer, aktiv: "touren" },
  );
}

export { heute };
