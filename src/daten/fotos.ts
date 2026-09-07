/**
 * Fotos zu Bauteilen, Prüfungen und Mängeln.
 *
 * In Stufe 1 werden noch keine Fotos aufgenommen (das kommt mit dem Rundgang, Abschnitt 6);
 * gelesen werden sie aber schon: die Bauteilseite zeigt die Galerie über alle Jahre, und der
 * Stand-Hash eines Berichts zählt die Foto-IDs mit, damit ein nachgereichtes Foto eine neue
 * Berichtsversion auslöst.
 */
import { lies } from "./basis";

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
