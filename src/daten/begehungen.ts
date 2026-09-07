/**
 * Begehungen und Prüfungen — das Ereignis und was es am Bestand hinterlässt.
 *
 * Eine Begehung ist ein Termin an einem Objekt. Sie erzeugt Prüfungen an Bauteilen; jede
 * Prüfung schreibt die Felder auf das Bauteil zurück (Stammdaten bleiben fürs nächste Jahr)
 * und legt einen Schnappschuss für den Bericht ab. Aus einer Prüfung mit Abweichung entsteht
 * ein Mangel, der am Bauteil hängt, bis ihn jemand freimeldet.
 */
import { jetzt, lies, ulid } from "./basis";
import type { Bewertung } from "../vorlagen";
import { pruefeChecks } from "../vorlagen";
import { bauteilAendern, bauteilAnlegen, bauteilPerKennung, bauteilPerNr, naechsteNr } from "./bauteile";
import type { Bauteil } from "./bauteile";
import { fotosZuPruefung } from "./fotos";
import { mangelAnlegen, mangelAendern, mangelZuPruefung, maengelZuBauteil } from "./maengel";
import type { Mangel } from "./maengel";
import { personLesen } from "./personen";
import type { Objekt } from "./objekte";

export interface Begehung {
  id: string;
  objekt_id: string;
  datum: string;
  pruefer: string;
  befaehigung: string;
  ort: string;
  beteiligte: string;
  status: "geplant" | "laufend" | "abgeschlossen";
  betreiber_unterschrift: string | null;
  betreiber_name: string;
  unterschrieben_am: number | null;
  angelegt_von: string;
  angelegt_am: number;
  geaendert_am: number;
}

export interface Pruefung {
  id: string;
  begehung_id: string;
  bauteil_id: string;
  checks: Record<string, Bewertung>;
  ergebnis: string;
  hinweise: string;
  felder_snapshot: Record<string, string>;
  stand_hash: string;
  geprueft_am: number;
  geprueft_von: string;
  angelegt_am: number;
  geaendert_am: number;
}

function alsBegehung(zeile: Record<string, unknown>): Begehung {
  return zeile as unknown as Begehung;
}

function alsPruefung(zeile: Record<string, unknown>): Pruefung {
  return {
    ...(zeile as unknown as Pruefung),
    checks: lies<Record<string, Bewertung>>(zeile.checks_json, {}),
    felder_snapshot: lies<Record<string, string>>(zeile.felder_snapshot_json, {}),
  };
}

const BEGEHUNG_SPALTEN = [
  "datum", "pruefer", "befaehigung", "ort", "beteiligte", "status", "betreiber_name",
] as const;

export type BegehungPatch = Partial<Record<(typeof BEGEHUNG_SPALTEN)[number], string>>;

/* ── Begehung ──────────────────────────────────────────────────────────────── */

export async function begehungAnlegen(
  db: D1Database,
  daten: BegehungPatch & { objekt_id: string; datum: string; angelegt_von?: string },
): Promise<Begehung> {
  const t = jetzt();
  const b: Begehung = {
    id: ulid(t),
    objekt_id: daten.objekt_id,
    datum: daten.datum,
    pruefer: daten.pruefer ?? "",
    befaehigung: daten.befaehigung || "Sachkundiger DGWZ",
    ort: daten.ort || "Hamburg",
    beteiligte: daten.beteiligte ?? "",
    status: (daten.status as Begehung["status"]) || "laufend",
    betreiber_unterschrift: null,
    betreiber_name: "",
    unterschrieben_am: null,
    angelegt_von: daten.angelegt_von ?? "",
    angelegt_am: t,
    geaendert_am: t,
  };
  await db
    .prepare(
      `INSERT INTO begehungen (id, objekt_id, datum, pruefer, befaehigung, ort, beteiligte, status,
         betreiber_unterschrift, betreiber_name, unterschrieben_am, angelegt_von, angelegt_am, geaendert_am)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      b.id, b.objekt_id, b.datum, b.pruefer, b.befaehigung, b.ort, b.beteiligte, b.status,
      null, "", null, b.angelegt_von, b.angelegt_am, b.geaendert_am,
    )
    .run();
  return b;
}

export async function begehungLesen(db: D1Database, id: string): Promise<Begehung | null> {
  const zeile = await db.prepare("SELECT * FROM begehungen WHERE id = ?").bind(id).first();
  return zeile ? alsBegehung(zeile as Record<string, unknown>) : null;
}

export async function begehungAendern(
  db: D1Database,
  id: string,
  patch: BegehungPatch,
): Promise<Begehung | null> {
  const felder = BEGEHUNG_SPALTEN.filter((s) => patch[s] !== undefined);
  if (felder.length) {
    await db
      .prepare(
        `UPDATE begehungen SET ${felder.map((f) => `${f} = ?`).join(", ")}, geaendert_am = ? WHERE id = ?`,
      )
      .bind(...felder.map((f) => patch[f]!), jetzt(), id)
      .run();
  }
  return begehungLesen(db, id);
}

/** Die Unterschrift des Betreibers festhalten — löst über den Stand-Hash neue Berichte aus. */
export async function betreiberUnterschrift(
  db: D1Database,
  id: string,
  schluessel: string,
  name: string,
): Promise<Begehung | null> {
  const t = jetzt();
  await db
    .prepare(
      `UPDATE begehungen SET betreiber_unterschrift = ?, betreiber_name = ?, unterschrieben_am = ?,
        geaendert_am = ? WHERE id = ?`,
    )
    .bind(schluessel, name, t, t, id)
    .run();
  return begehungLesen(db, id);
}

export interface BegehungMitZahlen extends Begehung {
  pruefungen: number;
  mit_abweichung: number;
  objekt_name: string;
}

export async function begehungenListe(
  db: D1Database,
  filter: { objekt_id?: string; limit?: number } = {},
): Promise<BegehungMitZahlen[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const { results } = await db
    .prepare(
      `SELECT b.*, o.name AS objekt_name,
              (SELECT COUNT(*) FROM pruefungen p WHERE p.begehung_id = b.id) AS pruefungen,
              (SELECT COUNT(*) FROM pruefungen p WHERE p.begehung_id = b.id
                 AND p.checks_json <> '{}') AS mit_abweichung
         FROM begehungen b JOIN objekte o ON o.id = b.objekt_id
        ${filter.objekt_id ? "WHERE b.objekt_id = ?" : ""}
        ORDER BY b.datum DESC, b.angelegt_am DESC LIMIT ?`,
    )
    .bind(...(filter.objekt_id ? [filter.objekt_id] : []), limit)
    .all();
  return (results ?? []) as unknown as BegehungMitZahlen[];
}

/* ── Prüfungen ─────────────────────────────────────────────────────────────── */

export interface PruefungMitBauteil extends Pruefung {
  bauteil: Bauteil;
}

export async function pruefungenLesen(
  db: D1Database,
  begehungId: string,
): Promise<PruefungMitBauteil[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, b.id AS b_id, b.objekt_id AS b_objekt_id, b.geschoss_id AS b_geschoss_id,
              b.nr AS b_nr, b.kennung AS b_kennung, b.art AS b_art, b.bezeichnung AS b_bezeichnung,
              b.raumnummer AS b_raumnummer, b.raum AS b_raum, b.flur AS b_flur,
              b.felder_json AS b_felder_json, b.x AS b_x, b.y AS b_y,
              b.wartungspflichtig AS b_wartungspflichtig, b.aktiv AS b_aktiv,
              b.intervall_monate AS b_intervall_monate
         FROM pruefungen p JOIN bauteile b ON b.id = p.bauteil_id
        WHERE p.begehung_id = ? ORDER BY b.nr`,
    )
    .bind(begehungId)
    .all();
  return (results ?? []).map((z) => {
    const zeile = z as Record<string, unknown>;
    const bauteil = {
      id: zeile.b_id,
      objekt_id: zeile.b_objekt_id,
      geschoss_id: zeile.b_geschoss_id,
      nr: zeile.b_nr,
      kennung: zeile.b_kennung,
      art: zeile.b_art,
      bezeichnung: zeile.b_bezeichnung,
      raumnummer: zeile.b_raumnummer,
      raum: zeile.b_raum,
      flur: zeile.b_flur,
      felder: lies<Record<string, string>>(zeile.b_felder_json, {}),
      x: zeile.b_x,
      y: zeile.b_y,
      wartungspflichtig: zeile.b_wartungspflichtig,
      aktiv: zeile.b_aktiv,
      intervall_monate: zeile.b_intervall_monate,
    } as unknown as Bauteil;
    return { ...alsPruefung(zeile), bauteil };
  });
}

export async function pruefungLesen(db: D1Database, id: string): Promise<Pruefung | null> {
  const zeile = await db.prepare("SELECT * FROM pruefungen WHERE id = ?").bind(id).first();
  return zeile ? alsPruefung(zeile as Record<string, unknown>) : null;
}

export async function pruefungZuBauteil(
  db: D1Database,
  begehungId: string,
  bauteilId: string,
): Promise<Pruefung | null> {
  const zeile = await db
    .prepare("SELECT * FROM pruefungen WHERE begehung_id = ? AND bauteil_id = ?")
    .bind(begehungId, bauteilId)
    .first();
  return zeile ? alsPruefung(zeile as Record<string, unknown>) : null;
}

export interface PruefungMitTermin extends Pruefung {
  datum: string;
  pruefer: string;
}

/** Die Historie eines Bauteils: alle Prüfungen aller Jahre, jüngste zuerst. */
export async function pruefungenHistorie(
  db: D1Database,
  bauteilId: string,
): Promise<PruefungMitTermin[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, g.datum AS datum, g.pruefer AS pruefer
         FROM pruefungen p JOIN begehungen g ON g.id = p.begehung_id
        WHERE p.bauteil_id = ? ORDER BY p.geprueft_am DESC`,
    )
    .bind(bauteilId)
    .all();
  return (results ?? []).map((z) => ({
    ...alsPruefung(z as Record<string, unknown>),
    datum: String((z as any).datum ?? ""),
    pruefer: String((z as any).pruefer ?? ""),
  }));
}

/** Das Prüfdatum der vorangegangenen Prüfung — „Letzte Prüfung" im Formular. */
export async function vorherigePruefung(
  db: D1Database,
  bauteilId: string,
  vorMs: number,
): Promise<{ datum: string; ergebnis: string } | null> {
  const zeile = await db
    .prepare(
      `SELECT g.datum AS datum, p.ergebnis AS ergebnis
         FROM pruefungen p JOIN begehungen g ON g.id = p.begehung_id
        WHERE p.bauteil_id = ? AND p.geprueft_am < ?
        ORDER BY p.geprueft_am DESC LIMIT 1`,
    )
    .bind(bauteilId, vorMs)
    .first<{ datum: string; ergebnis: string }>();
  return zeile ?? null;
}

/* ── Stand-Hash ────────────────────────────────────────────────────────────── */

/** Kanonisches JSON: Schlüssel sortiert, damit derselbe Stand immer denselben Hash ergibt. */
function kanonisch(wert: unknown): string {
  if (wert === null || wert === undefined) return "null";
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(",")}]`;
  if (typeof wert === "object") {
    const eintraege = Object.entries(wert as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${eintraege.map(([k, v]) => `${JSON.stringify(k)}:${kanonisch(v)}`).join(",")}}`;
  }
  return JSON.stringify(wert);
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Der Stand, aus dem ein Bericht entsteht (Abschnitt 4.1). Ändert er sich, entsteht beim
 * nächsten `berichte_erzeugen` eine neue Version — und nur dann. Keine Zeitstempel außer
 * `unterschrieben_am`, sonst wäre jeder Lauf eine neue Version.
 */
export async function standHash(
  db: D1Database,
  objekt: Objekt,
  begehung: Begehung,
  bauteil: Bauteil,
  pruefung: Pruefung,
): Promise<string> {
  const fotos = (await fotosZuPruefung(db, pruefung.id)).map((f) => f.id).sort();
  const person = begehung.angelegt_von ? await personLesen(db, begehung.angelegt_von) : null;
  return sha256(
    kanonisch({
      objekt: {
        name: objekt.name,
        adresse: objekt.adresse,
        betreiber: objekt.betreiber,
        ident: objekt.ident,
        rechtsgrundlagen: objekt.rechtsgrundlagen,
      },
      begehung: {
        datum: begehung.datum,
        pruefer: begehung.pruefer,
        befaehigung: begehung.befaehigung,
        ort: begehung.ort,
        beteiligte: begehung.beteiligte,
        betreiber_name: begehung.betreiber_name,
        unterschrieben_am: begehung.unterschrieben_am,
      },
      bauteil: {
        nr: bauteil.nr,
        kennung: bauteil.kennung,
        art: bauteil.art,
        raum: bauteil.raum,
        raumnummer: bauteil.raumnummer,
        flur: bauteil.flur,
        felder: bauteil.felder,
      },
      pruefung: {
        checks: pruefung.checks,
        ergebnis: pruefung.ergebnis,
        hinweise: pruefung.hinweise,
      },
      fotos,
      unterschrift_pruefer: person?.unterschrift ?? null,
    }),
  );
}

/** Alle Stand-Hashes einer Begehung neu rechnen — nach Stammdaten- oder Unterschrift-Änderung. */
export async function standHashesAuffrischen(
  db: D1Database,
  objekt: Objekt,
  begehung: Begehung,
): Promise<number> {
  const pruefungen = await pruefungenLesen(db, begehung.id);
  let geaendert = 0;
  for (const p of pruefungen) {
    const hash = await standHash(db, objekt, begehung, p.bauteil, p);
    if (hash !== p.stand_hash) {
      await db
        .prepare("UPDATE pruefungen SET stand_hash = ?, geaendert_am = ? WHERE id = ?")
        .bind(hash, jetzt(), p.id)
        .run();
      geaendert++;
    }
  }
  return geaendert;
}

/* ── Erfassen ──────────────────────────────────────────────────────────────── */

export interface PruefungEingabe {
  nr?: number;
  kennung?: string;
  art?: string;
  checks?: Record<string, unknown>;
  ergebnis?: string;
  hinweise?: string;
  felder?: Record<string, string>;
  raumnummer?: string;
  raum?: string;
  flur?: string;
  wie_davor?: boolean;
  neu?: boolean;
  geprueft_am?: number;
}

export interface Erfassung {
  pruefung: Pruefung;
  bauteil: Bauteil;
  neu_angelegt: boolean;
  offene_maengel_vorjahr: Mangel[];
  mangel: Mangel | null;
  naechste_nr: number;
}

/** Feldnamen aus dem Formular, die zusätzlich als eigene Spalte am Bauteil geführt werden. */
const FELD_ZU_SPALTE: Record<string, "raum" | "flur" | "raumnummer" | "bezeichnung"> = {
  RAUM: "raum",
  FLUR: "flur",
  RAUMNUMMER: "raumnummer",
  RAUMBEZ: "bezeichnung",
};

/** Die zuletzt in dieser Begehung erfasste Prüfung — Bezugspunkt für „wie davor". */
async function zuletztErfasst(
  db: D1Database,
  begehungId: string,
): Promise<{ pruefung: Pruefung; bauteil: Bauteil } | null> {
  const zeile = await db
    .prepare(
      "SELECT * FROM pruefungen WHERE begehung_id = ? ORDER BY angelegt_am DESC, id DESC LIMIT 1",
    )
    .bind(begehungId)
    .first();
  if (!zeile) return null;
  const p = alsPruefung(zeile as Record<string, unknown>);
  const b = await db.prepare("SELECT * FROM bauteile WHERE id = ?").bind(p.bauteil_id).first();
  if (!b) return null;
  return {
    pruefung: p,
    bauteil: {
      ...((b as unknown) as Bauteil),
      felder: lies<Record<string, string>>((b as any).felder_json, {}),
    },
  };
}

/**
 * Eine Prüfung erfassen — der Regelweg des Diktats (Abschnitt 2.2).
 *
 * Auflösung des Bauteils: `nr`, sonst `kennung`, sonst neu anlegen (das ist die
 * Bestandsaufnahme beim ersten Mal). Existiert für (Begehung, Bauteil) schon eine Prüfung,
 * wird sie überschrieben — das ist die Korrektur.
 */
export async function pruefungErfassen(
  db: D1Database,
  objekt: Objekt,
  begehung: Begehung,
  eingabe: PruefungEingabe,
  nutzer: string,
): Promise<Erfassung> {
  const vorige = eingabe.wie_davor ? await zuletztErfasst(db, begehung.id) : null;

  /* 1. Bauteil finden oder anlegen. */
  let bauteil: Bauteil | null = null;
  let neuAngelegt = false;

  if (eingabe.nr !== undefined && eingabe.nr !== null) {
    bauteil = await bauteilPerNr(db, objekt.id, Number(eingabe.nr));
  }
  if (!bauteil && eingabe.kennung) {
    const treffer = await bauteilPerKennung(db, objekt.id, eingabe.kennung);
    if (treffer.length > 1) {
      throw new Error(
        `Kennung '${eingabe.kennung}' passt auf mehrere Bauteile (Nr. ${treffer.map((t) => t.nr).join(", ")}).`,
      );
    }
    bauteil = treffer[0] ?? null;
  }

  if (!bauteil) {
    if (eingabe.neu === false) {
      throw new Error(
        `Bauteil ${eingabe.nr ?? eingabe.kennung} gibt es an diesem Objekt nicht (neu=false).`,
      );
    }
    const art = eingabe.art || vorige?.bauteil.art || (await haeufigsteArt(db, objekt.id));
    bauteil = await bauteilAnlegen(db, {
      objekt_id: objekt.id,
      art,
      nr: eingabe.nr !== undefined && eingabe.nr !== null ? Number(eingabe.nr) : undefined,
      kennung: eingabe.kennung ?? "",
      quelle: "rundgang",
      raumnummer: eingabe.raumnummer ?? "",
      raum: eingabe.raum ?? "",
      flur: eingabe.flur ?? "",
    });
    neuAngelegt = true;
  }

  /* 2. Felder zusammenführen: „wie davor" liefert die Grundlage, Eigenes sticht. */
  const felderEingabe: Record<string, string> = {
    ...(vorige ? vorige.bauteil.felder : {}),
    ...(eingabe.felder ?? {}),
  };
  const patch: Record<string, unknown> = { felder: felderEingabe };
  for (const [feld, spalte] of Object.entries(FELD_ZU_SPALTE)) {
    if (felderEingabe[feld]) patch[spalte] = felderEingabe[feld];
  }
  for (const feld of ["raumnummer", "raum", "flur"] as const) {
    if (eingabe[feld] !== undefined) patch[feld] = eingabe[feld];
  }
  if (eingabe.kennung && !bauteil.kennung) patch.kennung = eingabe.kennung;
  if (eingabe.art && eingabe.art !== bauteil.art) patch.art = eingabe.art;
  bauteil = (await bauteilAendern(db, bauteil.id, patch))!;

  /* 3. Prüfung schreiben. Bestehende (begehung, bauteil) wird überschrieben. */
  const bestehend = await pruefungZuBauteil(db, begehung.id, bauteil.id);
  const checks =
    eingabe.checks !== undefined
      ? pruefeChecks(bauteil.art, eingabe.checks)
      : eingabe.wie_davor
        ? (vorige?.pruefung.checks ?? {})
        : (bestehend?.checks ?? {});
  const ergebnis =
    eingabe.ergebnis ??
    (eingabe.wie_davor ? vorige?.pruefung.ergebnis : undefined) ??
    bestehend?.ergebnis ??
    "bestanden";
  const hinweise = eingabe.hinweise ?? bestehend?.hinweise ?? "";
  const t = jetzt();
  const geprueftAm = eingabe.geprueft_am ?? bestehend?.geprueft_am ?? t;

  const pruefung: Pruefung = {
    id: bestehend?.id ?? ulid(t),
    begehung_id: begehung.id,
    bauteil_id: bauteil.id,
    checks,
    ergebnis,
    hinweise,
    felder_snapshot: { ...bauteil.felder },
    stand_hash: "",
    geprueft_am: geprueftAm,
    geprueft_von: nutzer,
    angelegt_am: bestehend?.angelegt_am ?? t,
    geaendert_am: t,
  };
  pruefung.stand_hash = await standHash(db, objekt, begehung, bauteil, pruefung);

  await db
    .prepare(
      `INSERT INTO pruefungen (id, begehung_id, bauteil_id, checks_json, ergebnis, hinweise,
         felder_snapshot_json, stand_hash, geprueft_am, geprueft_von, angelegt_am, geaendert_am)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (begehung_id, bauteil_id) DO UPDATE SET
         checks_json = excluded.checks_json, ergebnis = excluded.ergebnis,
         hinweise = excluded.hinweise, felder_snapshot_json = excluded.felder_snapshot_json,
         stand_hash = excluded.stand_hash, geprueft_am = excluded.geprueft_am,
         geprueft_von = excluded.geprueft_von, geaendert_am = excluded.geaendert_am`,
    )
    .bind(
      pruefung.id, pruefung.begehung_id, pruefung.bauteil_id, JSON.stringify(pruefung.checks),
      pruefung.ergebnis, pruefung.hinweise, JSON.stringify(pruefung.felder_snapshot),
      pruefung.stand_hash, pruefung.geprueft_am, pruefung.geprueft_von, pruefung.angelegt_am,
      pruefung.geaendert_am,
    )
    .run();

  /* Eine laufende Begehung ist wieder laufend, sobald jemand daran arbeitet. */
  if (begehung.status === "geplant") {
    await begehungAendern(db, begehung.id, { status: "laufend" });
    begehung.status = "laufend";
  }

  /* 4. Mangel automatisch (Abschnitt 2.2). */
  const mangel = await mangelPflegen(db, objekt, begehung, bauteil, pruefung);

  /* 5. Was am Bauteil aus früheren Begehungen offen ist — Claude soll danach fragen. */
  const alle = await maengelZuBauteil(db, bauteil.id, true);
  const eigeneIds = new Set([pruefung.id]);
  const vorjahr = alle.filter((m) => !m.pruefung_id || !eigeneIds.has(m.pruefung_id));

  return {
    pruefung,
    bauteil,
    neu_angelegt: neuAngelegt,
    offene_maengel_vorjahr: vorjahr,
    mangel,
    naechste_nr: await naechsteNr(db, objekt.id),
  };
}

/** Die Art, die an diesem Objekt vorherrscht — Vorgabe für ein neu diktiertes Bauteil. */
async function haeufigsteArt(db: D1Database, objektId: string): Promise<string> {
  const zeile = await db
    .prepare(
      "SELECT art, COUNT(*) AS n FROM bauteile WHERE objekt_id = ? GROUP BY art ORDER BY n DESC LIMIT 1",
    )
    .bind(objektId)
    .first<{ art: string }>();
  return zeile?.art ?? "wartung_drehfluegel";
}

/**
 * Mangel aus einer Prüfung: einer je Prüfung, mit allen `nio`- und `sb`-Punkten. Bei bloßer
 * Bemerkung ohne `nio` und ohne Nachbesserung entsteht keiner. Existiert schon einer aus
 * derselben Prüfung, wird er aktualisiert statt verdoppelt.
 */
async function mangelPflegen(
  db: D1Database,
  objekt: Objekt,
  begehung: Begehung,
  bauteil: Bauteil,
  pruefung: Pruefung,
): Promise<Mangel | null> {
  const nio = Object.entries(pruefung.checks).filter(([, b]) => b === "nio").map(([nr]) => nr);
  const sb = Object.entries(pruefung.checks).filter(([, b]) => b === "sb").map(([nr]) => nr);
  const noetig = pruefung.ergebnis === "Nachbesserung" || nio.length > 0;
  const vorhanden = await mangelZuPruefung(db, pruefung.id);

  if (!noetig) return vorhanden;

  const punkte = [...nio, ...sb].sort((a, b) => Number(a) - Number(b));
  const beschreibung = pruefung.hinweise || beschreibungAusPunkten(punkte);
  const frist = tageSpaeter(begehung.datum, 28) || null;

  if (vorhanden) {
    return (await mangelAendern(db, vorhanden.id, { punkte, beschreibung })) ?? vorhanden;
  }
  return mangelAnlegen(db, {
    objekt_id: objekt.id,
    bauteil_id: bauteil.id,
    pruefung_id: pruefung.id,
    punkte,
    beschreibung,
    prioritaet: "mittel",
    frist,
    zustaendig: "Seehafer",
  });
}

function tageSpaeter(datum: string, tage: number): string {
  const d = new Date(`${datum}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

function beschreibungAusPunkten(punkte: string[]): string {
  if (!punkte.length) return "Nachbesserung erforderlich";
  return `Punkt ${punkte.join(", ")} nicht in Ordnung`;
}

export { alsPruefung, tageSpaeter };
