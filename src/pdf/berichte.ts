/**
 * Berichte erzeugen — aus Prüfungen werden ausgefüllte PDFs in R2.
 *
 * Zwei Dinge unterscheiden v2 von v1. Erstens ist der Lauf **versioniert**: erzeugt wird nur,
 * wo sich der Stand seit der letzten Version geändert hat (Abschnitt 4.1); bestehende Versionen
 * werden nie angefasst, damit ein Bericht, der beim Kunden liegt, genau so bleibt. Zweitens gibt
 * es den **Sammelbericht** je Begehung: Deckblatt plus die neuesten Einzelberichte.
 *
 * Der Lauf bleibt stückweise. Ein Worker hat begrenzte CPU-Zeit, ein Objekt kann sechzig Türen
 * haben — also wird bis zu einem Zeitbudget gearbeitet und zurückgemeldet, wie viele noch offen
 * sind. Aufrufer (Website wie MCP-Tool) rufen einfach erneut auf.
 */
import type { Env } from "../env";
import { Fueller, deckblatt } from "./fuellen";
import type { DeckblattZeile } from "./fuellen";
import { PDFDocument } from "pdf-lib";
import { zipBauen } from "./zip";
import { vorlage, vorlagePdf } from "../vorlagen";
import { monateSpaeter, slug, zugriffPruefen } from "../daten/basis";
import { objektLesen, rechtsgrundlagen } from "../daten/objekte";
import type { Objekt } from "../daten/objekte";
import {
  begehungLesen,
  pruefungenLesen,
  standHash,
  standHashesAuffrischen,
  vorherigePruefung,
} from "../daten/begehungen";
import type { Begehung, Pruefung, PruefungMitBauteil } from "../daten/begehungen";
import type { Bauteil } from "../daten/bauteile";
import {
  berichtAnlegen,
  berichteZuBegehung,
  neuesterBericht,
  sammelberichtAnlegen,
  sammelberichteLesen,
} from "../daten/berichte";
import type { Bericht } from "../daten/berichte";
import { personLesen } from "../daten/personen";

export interface Lauf {
  begehung: string;
  erzeugt: number;
  offen: number;
  fertig: boolean;
  berichte: { nr: number; version: number; name: string; schluessel: string }[];
  fehler: { nr: number; grund: string }[];
}

/** R2-Schlüssel einer Berichtsversion — der Pfad trägt Objekt, Bauteil, Begehung, Version. */
export function berichtSchluessel(
  objektId: string,
  bauteilId: string,
  begehungId: string,
  version: number,
): string {
  return `berichte/${objektId}/${bauteilId}/${begehungId}/v${version}.pdf`;
}

export function sammelSchluessel(objektId: string, begehungId: string, version: number): string {
  return `berichte/${objektId}/_sammel/${begehungId}/v${version}.pdf`;
}

/** Sprechender Dateiname fürs Herunterladen — der R2-Schlüssel ist technisch, dieser nicht. */
export function berichtName(
  objekt: Objekt,
  begehung: Begehung,
  bauteil: Bauteil,
  version: number,
): string {
  const teile = [
    "WAR",
    begehung.datum,
    slug(objekt.name, 28),
    `Tuer-${String(bauteil.nr).padStart(2, "0")}`,
    slug(bauteil.raum || bauteil.kennung || "", 20),
    `v${version}`,
  ].filter(Boolean);
  return `${slug(teile.join("_"), 120)}.pdf`;
}

/**
 * Die flachen Feldwerte fürs Formular. Stammdaten von Objekt und Begehung, Ortsangaben und
 * Felder vom Bauteil, Ergebnis und Hinweise von der Prüfung.
 */
export function datensatz(
  objekt: Objekt,
  begehung: Begehung,
  bauteil: Bauteil,
  pruefung: Pruefung,
  letztePruefung: string,
): Record<string, string> {
  const intervall = bauteil.intervall_monate ?? objekt.intervall_monate;
  const rec: Record<string, string> = {
    IDENT: objekt.ident,
    BETREIBER: objekt.betreiber,
    OBJEKT: [objekt.name, objekt.adresse].filter(Boolean).join(", "),
    PRUEFER: begehung.pruefer,
    BEFAEHIGUNG: begehung.befaehigung,
    DATUM: begehung.datum,
    ORT: begehung.ort,
    RECHTSGRUNDLAGEN: rechtsgrundlagen(objekt, bauteil.art),
    LETZTE_PRUEFUNG: letztePruefung,
    NAECHSTE_PRUEFUNG: monateSpaeter(begehung.datum, intervall),
    BETEILIGTE: begehung.beteiligte,
    BETREIBER_NAME: begehung.betreiber_name,
    ERGEBNIS: pruefung.ergebnis,
    HINWEISE: pruefung.hinweise,
  };
  /* Ortsangaben aus den eigenen Spalten, falls sie nicht ohnehin in den Feldern stehen. */
  if (bauteil.raum) rec.RAUM = bauteil.raum;
  if (bauteil.flur) rec.FLUR = bauteil.flur;
  if (bauteil.bezeichnung) rec.RAUMBEZ = bauteil.bezeichnung;
  for (const [k, v] of Object.entries(bauteil.felder)) {
    if (v !== undefined && v !== null && v !== "") rec[k] = String(v);
  }
  return rec;
}

async function ausR2(env: Env, schluessel: string | null): Promise<Uint8Array | null> {
  if (!schluessel) return null;
  const obj = await env.R2.get(schluessel);
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}

/**
 * Erzeugt die Berichte einer Begehung, deren Stand sich seit der letzten Version geändert hat.
 * `alle` erzwingt eine neue Version für jede Prüfung.
 */
export async function berichteErzeugen(
  env: Env,
  begehungId: string,
  optionen: { zeitbudgetMs?: number; alle?: boolean; nutzer?: string } = {},
): Promise<Lauf> {
  const begehung = await begehungLesen(env.DB, begehungId);
  if (!begehung) throw new Error(`Begehung '${begehungId}' gibt es nicht.`);
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) throw new Error("Zu dieser Begehung gibt es kein Objekt.");
  zugriffPruefen(optionen.nutzer ?? "", objekt.id);

  const pruefungen = await pruefungenLesen(env.DB, begehung.id);
  if (!pruefungen.length) throw new Error("Diese Begehung hat noch keine Prüfung.");

  const person = begehung.angelegt_von ? await personLesen(env.DB, begehung.angelegt_von) : null;
  const unterschrift = await ausR2(env, person?.unterschrift ?? null);
  const unterschriftBetreiber = await ausR2(env, begehung.betreiber_unterschrift);

  /* Welche Prüfungen brauchen eine neue Version? Der Hash wird jetzt neu gerechnet, damit
     auch geänderte Stammdaten oder eine nachgereichte Unterschrift zählen. */
  const offene: { p: PruefungMitBauteil; hash: string; letzte: Bericht | null }[] = [];
  for (const p of pruefungen) {
    const hash = await standHash(env.DB, objekt, begehung, p.bauteil, p);
    if (hash !== p.stand_hash) {
      await env.DB.prepare("UPDATE pruefungen SET stand_hash = ?, geaendert_am = ? WHERE id = ?")
        .bind(hash, Date.now(), p.id)
        .run();
      p.stand_hash = hash;
    }
    const letzte = await neuesterBericht(env.DB, p.id);
    if (optionen.alle || !letzte || letzte.stand_hash !== hash) {
      offene.push({ p, hash, letzte });
    }
  }

  const lauf: Lauf = {
    begehung: begehung.id,
    erzeugt: 0,
    offen: offene.length,
    fertig: offene.length === 0,
    berichte: [],
    fehler: [],
  };
  if (!offene.length) return lauf;

  const fueller = new Map<string, Fueller>();
  const budget = optionen.zeitbudgetMs ?? 20_000;
  const start = Date.now();

  for (const { p, hash, letzte } of offene) {
    if (lauf.erzeugt > 0 && Date.now() - start > budget) break;
    try {
      const art = p.bauteil.art;
      if (!fueller.has(art)) {
        const v = vorlage(art);
        fueller.set(
          art,
          await Fueller.laden(vorlagePdf(v.id), v.profil, unterschrift, unterschriftBetreiber),
        );
      }
      const vorher = await vorherigePruefung(env.DB, p.bauteil_id, p.geprueft_am);
      const { bytes, seiten } = await fueller.get(art)!.erzeugen({
        felder: datensatz(objekt, begehung, p.bauteil, p, vorher?.datum ?? ""),
        checks: p.checks,
      });

      const version = (letzte?.version ?? 0) + 1;
      const schluessel = berichtSchluessel(objekt.id, p.bauteil_id, begehung.id, version);
      await env.R2.put(schluessel, bytes, { httpMetadata: { contentType: "application/pdf" } });
      await berichtAnlegen(env.DB, {
        pruefung_id: p.id,
        version,
        r2_schluessel: schluessel,
        stand_hash: hash,
        seiten,
        erzeugt_von: optionen.nutzer ?? "",
      });
      lauf.erzeugt++;
      lauf.berichte.push({
        nr: p.bauteil.nr,
        version,
        name: berichtName(objekt, begehung, p.bauteil, version),
        schluessel,
      });
    } catch (e) {
      lauf.fehler.push({ nr: p.bauteil.nr, grund: (e as Error).message });
    }
  }

  lauf.offen = offene.length - lauf.erzeugt - lauf.fehler.length;
  lauf.fertig = lauf.offen <= 0;
  return lauf;
}

export interface BerichtsPosten {
  pruefung_id: string;
  bauteil_id: string;
  nr: number;
  version: number;
  schluessel: string;
  name: string;
  erzeugt_am: number;
  seiten: number;
  /** Alle älteren Versionen, neueste zuerst. */
  aeltere: { version: number; schluessel: string; erzeugt_am: number }[];
  /** true, wenn sich der Stand seit dieser Version geändert hat. */
  veraltet: boolean;
  /** „bestanden" oder „Nachbesserung" — danach liegen die Berichte in zwei Ordnern. */
  ergebnis: string;
  /** Ort der Tür, für die Zeile in der Liste. */
  ort: string;
}

/** Die Berichtsliste einer Begehung: je Prüfung die neueste Version, ältere im Aufklapper. */
export async function berichtsUebersicht(
  env: Env,
  begehung: Begehung,
  objekt: Objekt,
): Promise<BerichtsPosten[]> {
  /*
   * Erst den Stand nachziehen, dann vergleichen.
   *
   * `pruefungen.stand_hash` wird nur beim Schreiben einer Prüfung gesetzt. Ändert sich danach
   * etwas, das im Bericht steht — Prüfer, Prüfort, Objektname, die Unterschrift des Betreibers —,
   * blieb der gespeicherte Hash stehen, und `veraltet` sagte „nein", obwohl beim Kunden ein PDF
   * liegt, das nicht mehr stimmt. `berichte_erzeugen` rechnet den Hash ohnehin neu und hätte eine
   * neue Version gemacht; nur wusste niemand, dass er das tun sollte.
   */
  await standHashesAuffrischen(env.DB, objekt, begehung);
  const alle = await berichteZuBegehung(env.DB, begehung.id);
  const pruefungen = await pruefungenLesen(env.DB, begehung.id);
  const nachPruefung = new Map<string, typeof alle>();
  for (const b of alle) {
    const liste = nachPruefung.get(b.pruefung_id) ?? [];
    liste.push(b);
    nachPruefung.set(b.pruefung_id, liste);
  }

  const out: BerichtsPosten[] = [];
  for (const p of pruefungen) {
    const versionen = (nachPruefung.get(p.id) ?? []).sort((a, b) => b.version - a.version);
    if (!versionen.length) continue;
    const neueste = versionen[0];
    out.push({
      pruefung_id: p.id,
      bauteil_id: p.bauteil_id,
      nr: p.bauteil.nr,
      version: neueste.version,
      schluessel: neueste.r2_schluessel,
      name: berichtName(objekt, begehung, p.bauteil, neueste.version),
      erzeugt_am: neueste.erzeugt_am,
      seiten: neueste.seiten,
      aeltere: versionen.slice(1).map((v) => ({
        version: v.version,
        schluessel: v.r2_schluessel,
        erzeugt_am: v.erzeugt_am,
      })),
      veraltet: neueste.stand_hash !== p.stand_hash,
      ergebnis: p.ergebnis,
      ort:
        [p.bauteil.raumnummer, p.bauteil.raum || p.bauteil.bezeichnung, p.bauteil.flur]
          .filter(Boolean)
          .join(" · "),
    });
  }
  out.sort((a, b) => a.nr - b.nr);
  return out;
}

/** Die neuesten Berichte einer Begehung als ZIP. */
export async function berichtePaket(
  env: Env,
  begehungId: string,
): Promise<{ name: string; daten: Uint8Array }> {
  const begehung = await begehungLesen(env.DB, begehungId);
  if (!begehung) throw new Error("Diese Begehung gibt es nicht.");
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) throw new Error("Zu dieser Begehung gibt es kein Objekt.");

  const posten = await berichtsUebersicht(env, begehung, objekt);
  if (!posten.length) throw new Error("Für diese Begehung gibt es noch keine Berichte.");

  /*
   * Zwei Ordner im Paket, sonst nichts: was bestanden hat, und was nachgebessert werden muss.
   * Das ist die Trennung, nach der die Berichte am Ende ohnehin sortiert werden — dann soll sie
   * schon im ZIP stehen und nicht von Hand nachgezogen werden müssen.
   */
  const eintraege = [];
  for (const p of posten) {
    const daten = await ausR2(env, p.schluessel);
    const ordner = p.ergebnis === "Nachbesserung" ? "nachbesserung" : "bestanden";
    if (daten) eintraege.push({ name: `${ordner}/${p.name}`, daten });
  }
  /* Der Sammelbericht gehört mit ins Paket, wenn es einen gibt. */
  const sammel = (await sammelberichteLesen(env.DB, begehungId))[0];
  if (sammel) {
    const daten = await ausR2(env, sammel.r2_schluessel);
    if (daten) {
      eintraege.push({
        name: `${slug(`WAR_${begehung.datum}_${objekt.name}_Sammelbericht_v${sammel.version}`, 120)}.pdf`,
        daten,
      });
    }
  }
  return {
    name: `${slug(`WAR-${begehung.datum}-${objekt.name}`, 80)}.zip`,
    daten: zipBauen(eintraege),
  };
}

/**
 * Sammelbericht: Deckblatt plus die neuesten Einzelberichte in Laufreihenfolge, versioniert
 * wie die Einzelberichte. Das ist das Dokument, das der Betreiber bekommt (Abschnitt 4.4).
 */
export async function sammelberichtErzeugen(
  env: Env,
  begehungId: string,
  nutzer = "",
): Promise<{ version: number; schluessel: string; seiten: number; berichte: number }> {
  const begehung = await begehungLesen(env.DB, begehungId);
  if (!begehung) throw new Error(`Begehung '${begehungId}' gibt es nicht.`);
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) throw new Error("Zu dieser Begehung gibt es kein Objekt.");
  zugriffPruefen(nutzer, objekt.id);

  const posten = await berichtsUebersicht(env, begehung, objekt);
  if (!posten.length) {
    throw new Error("Erst die Einzelberichte erzeugen, dann den Sammelbericht.");
  }
  const pruefungen = await pruefungenLesen(env.DB, begehung.id);
  const nachId = new Map(pruefungen.map((p) => [p.id, p]));

  const zeilen: DeckblattZeile[] = posten.map((p) => {
    const pr = nachId.get(p.pruefung_id);
    const bauteil = pr?.bauteil;
    return {
      nr: p.nr,
      ort: [bauteil?.raumnummer, bauteil?.raum || bauteil?.bezeichnung, bauteil?.flur]
        .filter(Boolean)
        .join(" · "),
      ergebnis: pr?.ergebnis ?? "",
      abweichungen: Object.keys(pr?.checks ?? {}).length,
    };
  });

  const unterschriftBetreiber = await ausR2(env, begehung.betreiber_unterschrift);
  const deckblattBytes = await deckblatt(
    {
      objekt: objekt.name,
      adresse: objekt.adresse,
      betreiber: objekt.betreiber,
      ident: objekt.ident,
      datum: begehung.datum,
      pruefer: begehung.pruefer,
      befaehigung: begehung.befaehigung,
      ort: begehung.ort,
      betreiber_name: begehung.betreiber_name,
      zeilen,
    },
    unterschriftBetreiber,
  );

  const doc = await PDFDocument.load(deckblattBytes);
  for (const p of posten) {
    const daten = await ausR2(env, p.schluessel);
    if (!daten) continue;
    const quelle = await PDFDocument.load(daten);
    const seiten = await doc.copyPages(quelle, quelle.getPageIndices());
    for (const s of seiten) doc.addPage(s);
  }
  const bytes = await doc.save();

  const bisher = await sammelberichteLesen(env.DB, begehung.id);
  const version = (bisher[0]?.version ?? 0) + 1;
  const schluessel = sammelSchluessel(objekt.id, begehung.id, version);
  await env.R2.put(schluessel, bytes, { httpMetadata: { contentType: "application/pdf" } });
  await sammelberichtAnlegen(env.DB, begehung.id, version, schluessel);

  return { version, schluessel, seiten: doc.getPageCount(), berichte: posten.length };
}
