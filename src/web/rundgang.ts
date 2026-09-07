/**
 * Der Rundgang — die eine Seite, die ohne Netz funktioniert (Abschnitt 5).
 *
 * Hier steht nur das Gerüst: eine leere Seite mit dem eingebetteten Client-Skript. Die Daten
 * holt der Browser über `/api/rundgang/:begehung` und legt sie in IndexedDB ab; ab dann läuft
 * alles lokal, und was erfasst wird, wandert in eine Warteschlange, die der Client hochschiebt,
 * sobald wieder Netz da ist.
 *
 * Absichtlich serverseitig leer: nur so kann der Service Worker die Seite selbst zwischenspeichern
 * und im Treppenhaus ohne Verbindung ausliefern.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import { esc, seite, umleitung } from "./layout";
import rundgangClient from "./rundgang.client.js.txt";
import serviceWorker from "./sw.js.txt";
import { BEWERTUNGEN_KURZ, VORLAGEN, feldLabel, vorlage } from "../vorlagen";
import { geschosseListe, objektLesen } from "../daten/objekte";
import { bauteileMitStand, inLaufreihenfolge, naechsteNr } from "../daten/bauteile";
import { begehungLesen, pruefungenHistorie, pruefungenLesen } from "../daten/begehungen";
import { maengelZuBauteil } from "../daten/maengel";

/** Der Service Worker, mit der Version des Deployments im Cache-Namen. */
export function serviceWorkerText(version: string): string {
  return serviceWorker.replace("__VERSION__", version);
}

export async function rundgangSeite(
  env: Env,
  nutzer: Nutzer,
  begehungId: string,
): Promise<Response> {
  const begehung = await begehungLesen(env.DB, begehungId);
  if (!begehung) return umleitung("/objekte");
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) return umleitung("/objekte");

  return seite(
    `<div class="rundkopf">
<span class="name">${esc(objekt.name)}</span>
<button class="abgleich" id="stand" type="button" title="Jetzt abgleichen">lädt …</button>
</div>

<div id="liste">
<div class="fortschritt"><b id="zahl">…</b><span class="meta">erfasst</span></div>
<div class="balken"><i id="fuellung" style="width:0%"></i></div>
<div class="dran" id="dran"></div>
<div class="haken" id="haken"></div>
</div>

<div id="detail" hidden></div>

<div class="fussleiste">
<button class="btn schmal" id="neu" type="button">Unbekannte Tür</button>
<a class="btn schmal leise" href="/begehung/${esc(begehung.id)}">Fertig</a>
</div>`,
    {
      titel: `Rundgang ${objekt.name}`,
      nutzer,
      ohneKopf: true,
      koerper: `data-begehung="${esc(begehung.id)}"`,
      skript: rundgangClient,
    },
  );
}

/**
 * Alles, was der Rundgang offline braucht — in einem Zug, damit ein einziger Ladevorgang mit
 * Netz reicht: Bauteile in Laufreihenfolge, letzte Prüfung, offene Mängel, was in dieser
 * Begehung schon erfasst ist, und die Prüfpunkte der vorkommenden Vorlagen.
 */
export async function rundgangDaten(env: Env, begehungId: string): Promise<unknown> {
  const begehung = await begehungLesen(env.DB, begehungId);
  if (!begehung) throw new Error("Diese Begehung gibt es nicht.");
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) throw new Error("Zu dieser Begehung gibt es kein Objekt.");

  const geschosse = await geschosseListe(env.DB, objekt.id);
  const geschossName = new Map(geschosse.map((g) => [g.id, g.name]));
  const alle = await bauteileMitStand(env.DB, objekt);
  const bauteile = inLaufreihenfolge(alle, geschosse).filter((b) => b.wartungspflichtig === 1);
  const pruefungen = await pruefungenLesen(env.DB, begehung.id);
  const nachBauteil = new Map(pruefungen.map((p) => [p.bauteil_id, p]));

  const zeilen = [];
  for (const b of bauteile) {
    const p = nachBauteil.get(b.id);
    const maengel = (await maengelZuBauteil(env.DB, b.id, true)).map((m) => ({
      id: m.id,
      beschreibung: m.beschreibung,
      punkte: m.punkte,
    }));
    const historie = b.letzte_pruefung ? await pruefungenHistorie(env.DB, b.id) : [];
    const letzte = historie.find((h) => h.begehung_id !== begehung.id);
    zeilen.push({
      id: b.id,
      nr: b.nr,
      kennung: b.kennung,
      art: b.art,
      raumnummer: b.raumnummer,
      raum: b.raum,
      flur: b.flur,
      bezeichnung: b.bezeichnung,
      geschoss: geschossName.get(b.geschoss_id ?? "") ?? "",
      felder: b.felder,
      letzte: letzte
        ? { datum: letzte.datum, ergebnis: letzte.ergebnis, checks: letzte.checks }
        : null,
      maengel,
      pruefung: p
        ? { checks: p.checks, ergebnis: p.ergebnis, hinweise: p.hinweise }
        : null,
    });
  }

  /* Nur die Vorlagen mitschicken, die an diesem Objekt vorkommen — der Rest wäre Ballast. */
  const arten = [...new Set(bauteile.map((b) => b.art))];
  if (!arten.length) arten.push("wartung_drehfluegel");
  const vorlagen: Record<string, unknown> = {};
  for (const art of arten) {
    const v = vorlage(art);
    vorlagen[art] = {
      label: v.label,
      punkte: v.punkte,
      bauteilfelder: v.bauteilfelder.filter((f) => !["RAUM", "FLUR", "RAUMBEZ"].includes(f)),
      labels: Object.fromEntries(v.bauteilfelder.map((f) => [f, feldLabel(f)])),
      kurz: BEWERTUNGEN_KURZ,
    };
  }

  return {
    begehung: {
      id: begehung.id,
      datum: begehung.datum,
      status: begehung.status,
      objekt_id: objekt.id,
    },
    objekt: { id: objekt.id, name: objekt.name, adresse: objekt.adresse },
    vorlagen,
    bauteile: zeilen,
    naechste_nr: await naechsteNr(env.DB, objekt.id),
    stand: Date.now(),
  };
}

export { VORLAGEN };
