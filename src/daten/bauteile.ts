/**
 * Bauteile — die dauerhaften Türen, Fenster und Feststellanlagen eines Objekts.
 *
 * Ein Bauteil entsteht einmal und lebt weiter: es trägt seine Stammdaten (Hersteller, Zulassung,
 * Ort), seine Prüfungen aller Jahre und seine Mängel. Die Nummer `nr` ist die, die der Monteur
 * diktiert („Tür 12"), je Objekt eindeutig und über die Jahre stabil.
 */
import { jetzt, lies, ulid } from "./basis";
import { faelligkeit } from "./objekte";
import type { Faelligkeit, Geschoss, Objekt } from "./objekte";
import { laufreihenfolge } from "../reihenfolge";

export interface Bauteil {
  id: string;
  objekt_id: string;
  geschoss_id: string | null;
  nr: number;
  kennung: string;
  art: string;
  bezeichnung: string;
  raumnummer: string;
  raum: string;
  flur: string;
  felder: Record<string, string>;
  x: number | null;
  y: number | null;
  richtung_grad: number | null;
  breite_m: number | null;
  intervall_monate: number | null;
  wartungspflichtig: number;
  aktiv: number;
  quelle: string;
  angelegt_am: number;
  geaendert_am: number;
}

export interface BauteilMitStand extends Bauteil {
  /** Prüfdatum der letzten Prüfung, leer wenn nie geprüft. */
  letzte_pruefung: string;
  letztes_ergebnis: string;
  offene_maengel: number;
  stand: Faelligkeit;
}

function alsBauteil(zeile: Record<string, unknown>): Bauteil {
  return {
    ...(zeile as unknown as Bauteil),
    felder: lies<Record<string, string>>(zeile.felder_json, {}),
  };
}

const BAUTEIL_SPALTEN = [
  "geschoss_id", "nr", "kennung", "art", "bezeichnung", "raumnummer", "raum", "flur",
  "x", "y", "richtung_grad", "breite_m", "intervall_monate", "wartungspflichtig", "aktiv", "quelle",
] as const;

export interface BauteilPatch {
  geschoss_id?: string | null;
  nr?: number;
  kennung?: string;
  art?: string;
  bezeichnung?: string;
  raumnummer?: string;
  raum?: string;
  flur?: string;
  felder?: Record<string, string>;
  x?: number | null;
  y?: number | null;
  richtung_grad?: number | null;
  breite_m?: number | null;
  intervall_monate?: number | null;
  wartungspflichtig?: number;
  aktiv?: number;
  quelle?: string;
}

export async function naechsteNr(db: D1Database, objektId: string): Promise<number> {
  const zeile = await db
    .prepare("SELECT COALESCE(MAX(nr), 0) AS m FROM bauteile WHERE objekt_id = ?")
    .bind(objektId)
    .first<{ m: number }>();
  return (zeile?.m ?? 0) + 1;
}

export async function bauteilAnlegen(
  db: D1Database,
  daten: BauteilPatch & { objekt_id: string; art: string },
): Promise<Bauteil> {
  const t = jetzt();
  const nr = daten.nr ?? (await naechsteNr(db, daten.objekt_id));
  const b: Bauteil = {
    id: ulid(t),
    objekt_id: daten.objekt_id,
    geschoss_id: daten.geschoss_id ?? null,
    nr,
    kennung: daten.kennung ?? "",
    art: daten.art,
    bezeichnung: daten.bezeichnung ?? "",
    raumnummer: daten.raumnummer ?? "",
    raum: daten.raum ?? "",
    flur: daten.flur ?? "",
    felder: daten.felder ?? {},
    x: daten.x ?? null,
    y: daten.y ?? null,
    richtung_grad: daten.richtung_grad ?? null,
    breite_m: daten.breite_m ?? null,
    intervall_monate: daten.intervall_monate ?? null,
    wartungspflichtig: daten.wartungspflichtig ?? 1,
    aktiv: 1,
    quelle: daten.quelle ?? "manuell",
    angelegt_am: t,
    geaendert_am: t,
  };
  await db
    .prepare(
      `INSERT INTO bauteile (id, objekt_id, geschoss_id, nr, kennung, art, bezeichnung, raumnummer,
         raum, flur, felder_json, x, y, richtung_grad, breite_m, intervall_monate,
         wartungspflichtig, aktiv, quelle, angelegt_am, geaendert_am)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      b.id, b.objekt_id, b.geschoss_id, b.nr, b.kennung, b.art, b.bezeichnung, b.raumnummer,
      b.raum, b.flur, JSON.stringify(b.felder), b.x, b.y, b.richtung_grad, b.breite_m,
      b.intervall_monate, b.wartungspflichtig, b.aktiv, b.quelle, b.angelegt_am, b.geaendert_am,
    )
    .run();
  return b;
}

export async function bauteilLesen(db: D1Database, id: string): Promise<Bauteil | null> {
  const zeile = await db.prepare("SELECT * FROM bauteile WHERE id = ?").bind(id).first();
  return zeile ? alsBauteil(zeile as Record<string, unknown>) : null;
}

export async function bauteilPerNr(
  db: D1Database,
  objektId: string,
  nr: number,
): Promise<Bauteil | null> {
  const zeile = await db
    .prepare("SELECT * FROM bauteile WHERE objekt_id = ? AND nr = ?")
    .bind(objektId, nr)
    .first();
  return zeile ? alsBauteil(zeile as Record<string, unknown>) : null;
}

/** Kennung ohne Leer- und Bindestriche, groß — „t 2.14" und „T-2.14" sind dasselbe. */
export function kennungNormal(k: string): string {
  return String(k ?? "").toUpperCase().replace(/[\s\-_.]/g, "");
}

export async function bauteilPerKennung(
  db: D1Database,
  objektId: string,
  kennung: string,
): Promise<Bauteil[]> {
  const { results } = await db
    .prepare("SELECT * FROM bauteile WHERE objekt_id = ? AND kennung <> '' ORDER BY nr")
    .bind(objektId)
    .all();
  const gesucht = kennungNormal(kennung);
  return (results ?? [])
    .map((z) => alsBauteil(z as Record<string, unknown>))
    .filter((b) => kennungNormal(b.kennung) === gesucht);
}

export async function bauteilAendern(
  db: D1Database,
  id: string,
  patch: BauteilPatch,
): Promise<Bauteil | null> {
  const vorher = await bauteilLesen(db, id);
  if (!vorher) return null;
  const felder = BAUTEIL_SPALTEN.filter((s) => patch[s] !== undefined);
  const sätze = felder.map((f) => `${f} = ?`);
  const werte: unknown[] = felder.map((f) => patch[f] as unknown);
  if (patch.felder !== undefined) {
    /* Felder werden gemischt, nicht ersetzt: „nur den Hersteller nachtragen" darf den Rest
       nicht löschen. Ein leerer Wert entfernt den Schlüssel. */
    const gemischt: Record<string, string> = { ...vorher.felder };
    for (const [k, v] of Object.entries(patch.felder)) {
      if (v === "" || v === null || v === undefined) delete gemischt[k];
      else gemischt[k] = String(v);
    }
    sätze.push("felder_json = ?");
    werte.push(JSON.stringify(gemischt));
  }
  if (!sätze.length) return vorher;
  await db
    .prepare(`UPDATE bauteile SET ${sätze.join(", ")}, geaendert_am = ? WHERE id = ?`)
    .bind(...werte, jetzt(), id)
    .run();
  return bauteilLesen(db, id);
}

/**
 * Alle Bauteile eines Objekts mit ihrem Stand: letzte Prüfung, Ergebnis, offene Mängel,
 * Fälligkeit. Eine Abfrage — die Unterabfragen laufen je Zeile, aber ein Objekt hat Dutzende
 * Bauteile, keine Millionen.
 */
export async function bauteileMitStand(
  db: D1Database,
  objekt: Objekt,
  optionen: { auch_stillgelegte?: boolean } = {},
): Promise<BauteilMitStand[]> {
  const { results } = await db
    .prepare(
      `SELECT b.*,
              (SELECT g.datum FROM pruefungen p JOIN begehungen g ON g.id = p.begehung_id
                 WHERE p.bauteil_id = b.id ORDER BY p.geprueft_am DESC LIMIT 1) AS letztes_datum,
              (SELECT p.ergebnis FROM pruefungen p
                 WHERE p.bauteil_id = b.id ORDER BY p.geprueft_am DESC LIMIT 1) AS letztes_ergebnis,
              (SELECT COUNT(*) FROM maengel m
                 WHERE m.bauteil_id = b.id AND m.status IN ('offen','in_arbeit')) AS offene_maengel
         FROM bauteile b
        WHERE b.objekt_id = ? ${optionen.auch_stillgelegte ? "" : "AND b.aktiv = 1"}
        ORDER BY b.nr`,
    )
    .bind(objekt.id)
    .all();

  return (results ?? []).map((z) => {
    const zeile = z as Record<string, unknown>;
    const b = alsBauteil(zeile);
    const letztes = (zeile.letztes_datum as string) ?? "";
    return {
      ...b,
      letzte_pruefung: letztes,
      letztes_ergebnis: (zeile.letztes_ergebnis as string) ?? "",
      offene_maengel: Number(zeile.offene_maengel ?? 0),
      stand: faelligkeit(letztes || null, b.intervall_monate ?? objekt.intervall_monate),
    };
  });
}

/** Dieselbe Liste, aber in Laufreihenfolge (Abschnitt 7.9). */
export function inLaufreihenfolge<T extends BauteilMitStand>(
  bauteile: T[],
  geschosse: Geschoss[],
): T[] {
  return laufreihenfolge(bauteile, geschosse);
}

/** Ist ein Bauteil fällig? Stillgelegte und nicht wartungspflichtige nie. */
export function istFaellig(b: BauteilMitStand): boolean {
  if (!b.aktiv || !b.wartungspflichtig) return false;
  return b.stand.nie_geprueft || (b.stand.tage ?? 0) <= 0;
}
