/**
 * Fotos zu Bauteilen, Prüfungen und Mängeln.
 *
 * In Stufe 1 werden noch keine Fotos aufgenommen (das kommt mit dem Rundgang, Abschnitt 6);
 * gelesen werden sie aber schon: die Bauteilseite zeigt die Galerie über alle Jahre, und der
 * Stand-Hash eines Berichts zählt die Foto-IDs mit, damit ein nachgereichtes Foto eine neue
 * Berichtsversion auslöst.
 */
import { jetzt, lies, ulid } from "./basis";

export interface Foto {
  id: string;
  objekt_id: string;
  bauteil_id: string;
  pruefung_id: string | null;
  mangel_id: string | null;
  r2_schluessel: string;
  breite: number;
  hoehe: number;
  notiz: string;
  aufgenommen_am: number;
  von: string;
  aktiv: number;
}

export async function fotosZuPruefung(db: D1Database, pruefungId: string): Promise<Foto[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM fotos WHERE pruefung_id = ? AND aktiv = 1 ORDER BY aufgenommen_am",
    )
    .bind(pruefungId)
    .all();
  return (results ?? []) as unknown as Foto[];
}

export async function fotosZuBauteil(db: D1Database, bauteilId: string): Promise<Foto[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM fotos WHERE bauteil_id = ? AND aktiv = 1 ORDER BY aufgenommen_am DESC",
    )
    .bind(bauteilId)
    .all();
  return (results ?? []) as unknown as Foto[];
}

export { lies };

/**
 * Ein Foto festhalten. Der Aufrufer hat es schon nach R2 geschrieben — hier entsteht nur die
 * Zeile, damit Bauteil, Prüfung und Mangel es wiederfinden.
 */
export async function fotoAnlegen(
  db: D1Database,
  daten: {
    objekt_id: string;
    bauteil_id: string;
    pruefung_id?: string | null;
    mangel_id?: string | null;
    r2_schluessel: string;
    breite?: number;
    hoehe?: number;
    notiz?: string;
    von?: string;
    aufgenommen_am?: number;
  },
): Promise<Foto> {
  const t = jetzt();
  const f: Foto = {
    id: ulid(t),
    objekt_id: daten.objekt_id,
    bauteil_id: daten.bauteil_id,
    pruefung_id: daten.pruefung_id ?? null,
    mangel_id: daten.mangel_id ?? null,
    r2_schluessel: daten.r2_schluessel,
    breite: daten.breite ?? 0,
    hoehe: daten.hoehe ?? 0,
    notiz: daten.notiz ?? "",
    aufgenommen_am: daten.aufgenommen_am ?? t,
    von: daten.von ?? "",
    aktiv: 1,
  };
  await db
    .prepare(
      `INSERT INTO fotos (id, objekt_id, bauteil_id, pruefung_id, mangel_id, r2_schluessel,
         breite, hoehe, notiz, aufgenommen_am, von, aktiv)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
    )
    .bind(
      f.id, f.objekt_id, f.bauteil_id, f.pruefung_id, f.mangel_id, f.r2_schluessel,
      f.breite, f.hoehe, f.notiz, f.aufgenommen_am, f.von,
    )
    .run();
  return f;
}

export async function fotoLesen(db: D1Database, id: string): Promise<Foto | null> {
  const zeile = await db.prepare("SELECT * FROM fotos WHERE id = ?").bind(id).first();
  return (zeile as unknown as Foto) ?? null;
}

/**
 * Ein Foto entfernen. Steckt es schon in einem erzeugten Bericht, wird es nur **ausgeblendet**
 * (`aktiv = 0`): der Bericht, der beim Kunden liegt, zeigt es weiter, künftige zeigen es nicht
 * mehr. Sonst verschwindet es ganz, auch aus R2. Löschen darf, wer es aufgenommen hat, und das
 * Büro (Abschnitt 6).
 */
export async function fotoEntfernen(
  db: D1Database,
  foto: Foto,
): Promise<{ ausgeblendet: boolean; r2_schluessel: string }> {
  const inBericht = foto.pruefung_id
    ? await db
        .prepare("SELECT COUNT(*) AS n FROM berichte WHERE pruefung_id = ?")
        .bind(foto.pruefung_id)
        .first<{ n: number }>()
    : { n: 0 };
  if (Number(inBericht?.n ?? 0) > 0) {
    await db.prepare("UPDATE fotos SET aktiv = 0 WHERE id = ?").bind(foto.id).run();
    return { ausgeblendet: true, r2_schluessel: foto.r2_schluessel };
  }
  await db.prepare("DELETE FROM fotos WHERE id = ?").bind(foto.id).run();
  return { ausgeblendet: false, r2_schluessel: foto.r2_schluessel };
}

export function darfFotoLoeschen(foto: Foto, benutzer: string, rolle: string): boolean {
  return foto.von === benutzer || rolle === "buero";
}

/** Fotos, die zu einer Begehung gehören — für die Übersicht und den Rundgang. */
export async function fotosZuBegehung(db: D1Database, begehungId: string): Promise<Foto[]> {
  const { results } = await db
    .prepare(
      `SELECT f.* FROM fotos f JOIN pruefungen p ON p.id = f.pruefung_id
        WHERE p.begehung_id = ? AND f.aktiv = 1 ORDER BY f.aufgenommen_am`,
    )
    .bind(begehungId)
    .all();
  return (results ?? []) as unknown as Foto[];
}
