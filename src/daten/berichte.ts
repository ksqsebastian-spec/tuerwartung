/**
 * Berichtsversionen in der Datenbank.
 *
 * Ein Bericht wird nie überschrieben und nie gelöscht: was einmal beim Kunden liegt, bleibt
 * unter seinem R2-Schlüssel abrufbar. Ändert sich der Stand einer Prüfung, entsteht daneben
 * eine neue Version. Diese Datei kennt nur die Zeilen — das Erzeugen der PDFs steht in
 * `src/pdf/berichte.ts`.
 */
import { jetzt, ulid } from "./basis";

export interface Bericht {
  id: string;
  pruefung_id: string;
  version: number;
  r2_schluessel: string;
  stand_hash: string;
  seiten: number;
  erzeugt_am: number;
  erzeugt_von: string;
}

export interface Sammelbericht {
  id: string;
  begehung_id: string;
  version: number;
  r2_schluessel: string;
  erzeugt_am: number;
}

export async function berichteZuPruefung(
  db: D1Database,
  pruefungId: string,
): Promise<Bericht[]> {
  const { results } = await db
    .prepare("SELECT * FROM berichte WHERE pruefung_id = ? ORDER BY version DESC")
    .bind(pruefungId)
    .all();
  return (results ?? []) as unknown as Bericht[];
}

export async function neuesterBericht(
  db: D1Database,
  pruefungId: string,
): Promise<Bericht | null> {
  const zeile = await db
    .prepare("SELECT * FROM berichte WHERE pruefung_id = ? ORDER BY version DESC LIMIT 1")
    .bind(pruefungId)
    .first();
  return (zeile as unknown as Bericht) ?? null;
}

/** Alle Berichtszeilen einer Begehung — für Liste, ZIP und Sammelbericht. */
export async function berichteZuBegehung(
  db: D1Database,
  begehungId: string,
): Promise<(Bericht & { bauteil_nr: number; bauteil_id: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, b.nr AS bauteil_nr, b.id AS bauteil_id
         FROM berichte r
         JOIN pruefungen p ON p.id = r.pruefung_id
         JOIN bauteile b ON b.id = p.bauteil_id
        WHERE p.begehung_id = ?
        ORDER BY b.nr, r.version`,
    )
    .bind(begehungId)
    .all();
  return (results ?? []) as unknown as (Bericht & { bauteil_nr: number; bauteil_id: string })[];
}

export async function berichtAnlegen(
  db: D1Database,
  daten: Omit<Bericht, "id" | "erzeugt_am">,
): Promise<Bericht> {
  const b: Bericht = { ...daten, id: ulid(), erzeugt_am: jetzt() };
  await db
    .prepare(
      `INSERT INTO berichte (id, pruefung_id, version, r2_schluessel, stand_hash, seiten,
         erzeugt_am, erzeugt_von) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(
      b.id, b.pruefung_id, b.version, b.r2_schluessel, b.stand_hash, b.seiten, b.erzeugt_am,
      b.erzeugt_von,
    )
    .run();
  return b;
}

export async function sammelberichteLesen(
  db: D1Database,
  begehungId: string,
): Promise<Sammelbericht[]> {
  const { results } = await db
    .prepare("SELECT * FROM sammelberichte WHERE begehung_id = ? ORDER BY version DESC")
    .bind(begehungId)
    .all();
  return (results ?? []) as unknown as Sammelbericht[];
}

export async function sammelberichtAnlegen(
  db: D1Database,
  begehungId: string,
  version: number,
  schluessel: string,
): Promise<Sammelbericht> {
  const s: Sammelbericht = {
    id: ulid(),
    begehung_id: begehungId,
    version,
    r2_schluessel: schluessel,
    erzeugt_am: jetzt(),
  };
  await db
    .prepare(
      "INSERT INTO sammelberichte (id, begehung_id, version, r2_schluessel, erzeugt_am) VALUES (?,?,?,?,?)",
    )
    .bind(s.id, s.begehung_id, s.version, s.r2_schluessel, s.erzeugt_am)
    .run();
  return s;
}
