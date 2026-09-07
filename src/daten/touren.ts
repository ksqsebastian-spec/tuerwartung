/**
 * Tagestouren: welche Objekte an welchem Tag in welcher Reihenfolge.
 *
 * Bewusst schlicht — eine Zeile je Tag und Person, die Objekte als geordnete Liste von IDs.
 * Kein Routing, keine Fahrzeiten: die Navigation macht das Handy, wir liefern nur die
 * Adressen in der Reihenfolge, die der Monteur gewählt hat.
 */
import { jetzt, lies, ulid } from "./basis";
import type { Objekt } from "./objekte";

export interface Tour {
  id: string;
  datum: string;
  person: string;
  objekte: string[];
  notiz: string;
  angelegt_am: number;
  geaendert_am: number;
}

function alsTour(zeile: Record<string, unknown>): Tour {
  return {
    ...(zeile as unknown as Tour),
    objekte: lies<string[]>(zeile.objekte_json, []),
  };
}

export async function tourLesen(
  db: D1Database,
  datum: string,
  person: string,
): Promise<Tour | null> {
  const zeile = await db
    .prepare("SELECT * FROM touren WHERE datum = ? AND person = ?")
    .bind(datum, person)
    .first();
  return zeile ? alsTour(zeile as Record<string, unknown>) : null;
}

export async function tourenZeitraum(
  db: D1Database,
  person: string,
  von: string,
  bis: string,
): Promise<Tour[]> {
  const { results } = await db
    .prepare("SELECT * FROM touren WHERE person = ? AND datum >= ? AND datum <= ? ORDER BY datum")
    .bind(person, von, bis)
    .all();
  return (results ?? []).map((z) => alsTour(z as Record<string, unknown>));
}

/** Setzt die Objekte eines Tages. Leere Liste heißt: der Tag ist wieder frei. */
export async function tourSpeichern(
  db: D1Database,
  datum: string,
  person: string,
  objekte: string[],
  notiz?: string,
): Promise<Tour> {
  const t = jetzt();
  const vorher = await tourLesen(db, datum, person);
  if (!objekte.length && !notiz) {
    if (vorher) {
      await db
        .prepare("DELETE FROM touren WHERE datum = ? AND person = ?")
        .bind(datum, person)
        .run();
    }
    return {
      id: vorher?.id ?? "",
      datum,
      person,
      objekte: [],
      notiz: "",
      angelegt_am: vorher?.angelegt_am ?? t,
      geaendert_am: t,
    };
  }
  await db
    .prepare(
      `INSERT INTO touren (id, datum, person, objekte_json, notiz, angelegt_am, geaendert_am)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (datum, person) DO UPDATE SET objekte_json = excluded.objekte_json,
         notiz = excluded.notiz, geaendert_am = excluded.geaendert_am`,
    )
    .bind(
      vorher?.id ?? ulid(t),
      datum,
      person,
      JSON.stringify(objekte),
      notiz ?? vorher?.notiz ?? "",
      vorher?.angelegt_am ?? t,
      t,
    )
    .run();
  return (await tourLesen(db, datum, person))!;
}

/**
 * Der Maps-Link eines Tages: die Adressen in Reihenfolge, der erste Halt ist der Start.
 * Objekte ohne Adresse fallen heraus — mit „" navigiert niemand.
 */
export function mapsLink(objekte: Objekt[]): string {
  const halte = objekte
    .map((o) => (o.adresse || o.name).trim())
    .filter(Boolean)
    .map((a) => encodeURIComponent(a));
  if (!halte.length) return "";
  return `https://www.google.com/maps/dir/${halte.join("/")}`;
}

/** Montag der Woche, in der `datum` liegt. */
export function wochenStart(datum: string): string {
  const d = new Date(`${datum}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return datum;
  const tag = (d.getUTCDay() + 6) % 7; // Montag = 0
  d.setUTCDate(d.getUTCDate() - tag);
  return d.toISOString().slice(0, 10);
}

export function tagePlus(datum: string, tage: number): string {
  const d = new Date(`${datum}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return datum;
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

export const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
