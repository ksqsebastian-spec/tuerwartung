/**
 * Objekte, Gebäude, Geschosse — die Liegenschaft, an der Bauteile hängen.
 *
 * Ein Objekt bringt immer ein Gebäude und ein Geschoss mit. Fast jedes Objekt hat genau eins
 * von beidem; die Ebenen existieren, damit ein Plan pro Geschoss hängen kann, und werden in
 * der Oberfläche ausgeblendet, solange es nur eines gibt.
 */
import { heute, jetzt, lies, monateSpaeter, tageBis, ulid } from "./basis";

export interface Objekt {
  id: string;
  name: string;
  adresse: string;
  plz: string;
  betreiber: string;
  betreiber_kontakt: string;
  ident: string;
  intervall_monate: number;
  rechtsgrundlagen: string;
  notizen: string;
  hero_kunde_id: string | null;
  hero_projekt_id: string | null;
  aktiv: number;
  angelegt_von: string;
  angelegt_am: number;
  geaendert_am: number;
}

export interface Gebaeude {
  id: string;
  objekt_id: string;
  name: string;
  reihenfolge: number;
}

export interface Geschoss {
  id: string;
  gebaeude_id: string;
  name: string;
  reihenfolge: number;
  plan_schluessel: string | null;
  plan_breite: number | null;
  plan_hoehe: number | null;
  plan_quelle: string | null;
  einheiten_je_meter: number | null;
  start_x: number | null;
  start_y: number | null;
}

export type Zustand = "ueberfaellig" | "bald" | "ok";

export interface Faelligkeit {
  /** Wann fällig. Leer = noch nie geprüft, also sofort. */
  faellig_am: string;
  zustand: Zustand;
  /** Tage bis zur Fälligkeit; negativ = überfällig. */
  tage: number | null;
  nie_geprueft: boolean;
}

/**
 * Fälligkeit aus dem Datum der letzten Prüfung und dem Intervall.
 *
 * Entscheidung: gerechnet wird mit dem **Prüfdatum der Begehung**, nicht mit `geprueft_am`.
 * Die Spezifikation nennt in Abschnitt 1 `max geprueft_am`; das ist die Client-Zeit beim
 * Erfassen und dient dem Offline-Abgleich. Für die Frist zählt, was auf dem Protokoll steht —
 * sonst hätte eine am Folgetag nachgetragene Begehung eine andere Frist als die gedruckte.
 * `geprueft_am` entscheidet weiterhin, *welche* Prüfung die letzte ist.
 */
export function faelligkeit(letztesDatum: string | null, intervallMonate: number): Faelligkeit {
  if (!letztesDatum) {
    return { faellig_am: "", zustand: "ueberfaellig", tage: null, nie_geprueft: true };
  }
  const faellig_am = monateSpaeter(letztesDatum, intervallMonate);
  const tage = tageBis(faellig_am);
  return {
    faellig_am,
    zustand: tage < 0 ? "ueberfaellig" : tage <= 30 ? "bald" : "ok",
    tage,
    nie_geprueft: false,
  };
}

/** Die früheste Fälligkeit gewinnt; „nie geprüft" schlägt jedes Datum. */
export function frueheste(liste: Faelligkeit[]): Faelligkeit {
  let beste: Faelligkeit = { faellig_am: "", zustand: "ok", tage: null, nie_geprueft: false };
  let gefunden = false;
  for (const f of liste) {
    if (!gefunden) {
      beste = f;
      gefunden = true;
      continue;
    }
    if (f.nie_geprueft && !beste.nie_geprueft) beste = f;
    else if (!f.nie_geprueft && !beste.nie_geprueft && f.faellig_am < beste.faellig_am) beste = f;
  }
  return gefunden ? beste : { faellig_am: "", zustand: "ok", tage: null, nie_geprueft: false };
}

function alsObjekt(zeile: Record<string, unknown>): Objekt {
  return zeile as unknown as Objekt;
}

export interface ObjektPatch {
  name?: string;
  adresse?: string;
  plz?: string;
  betreiber?: string;
  betreiber_kontakt?: string;
  ident?: string;
  intervall_monate?: number;
  rechtsgrundlagen?: string;
  notizen?: string;
  aktiv?: number;
}

const OBJEKT_SPALTEN = [
  "name", "adresse", "plz", "betreiber", "betreiber_kontakt", "ident",
  "intervall_monate", "rechtsgrundlagen", "notizen", "aktiv",
] as const;

/** Legt Objekt, Hauptgebäude und ein Geschoss „EG" an — ein Objekt ist nie ohne Ort. */
export async function objektAnlegen(
  db: D1Database,
  daten: ObjektPatch & { name: string; angelegt_von?: string },
): Promise<Objekt> {
  const t = jetzt();
  const o: Objekt = {
    id: ulid(t),
    name: daten.name.trim(),
    adresse: daten.adresse ?? "",
    plz: daten.plz ?? plzAusAdresse(daten.adresse ?? ""),
    betreiber: daten.betreiber ?? "",
    betreiber_kontakt: daten.betreiber_kontakt ?? "",
    ident: daten.ident ?? "",
    intervall_monate: daten.intervall_monate ?? 12,
    rechtsgrundlagen: daten.rechtsgrundlagen ?? "",
    notizen: daten.notizen ?? "",
    hero_kunde_id: null,
    hero_projekt_id: null,
    aktiv: 1,
    angelegt_von: daten.angelegt_von ?? "",
    angelegt_am: t,
    geaendert_am: t,
  };
  const gebaeudeId = ulid(t);
  await db.batch([
    db
      .prepare(
        `INSERT INTO objekte (id, name, adresse, plz, betreiber, betreiber_kontakt, ident,
           intervall_monate, rechtsgrundlagen, notizen, hero_kunde_id, hero_projekt_id, aktiv,
           angelegt_von, angelegt_am, geaendert_am)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        o.id, o.name, o.adresse, o.plz, o.betreiber, o.betreiber_kontakt, o.ident,
        o.intervall_monate, o.rechtsgrundlagen, o.notizen, null, null, o.aktiv,
        o.angelegt_von, o.angelegt_am, o.geaendert_am,
      ),
    db
      .prepare("INSERT INTO gebaeude (id, objekt_id, name, reihenfolge) VALUES (?,?,?,0)")
      .bind(gebaeudeId, o.id, "Hauptgebäude"),
  ]);
  return o;
}

/** „Heselstücken 12, 22523 Hamburg" → „22523". Nur für die Tagestour, darf danebenliegen. */
function plzAusAdresse(adresse: string): string {
  return /\b(\d{5})\b/.exec(adresse)?.[1] ?? "";
}

export async function objektLesen(db: D1Database, id: string): Promise<Objekt | null> {
  const zeile = await db.prepare("SELECT * FROM objekte WHERE id = ?").bind(id).first();
  return zeile ? alsObjekt(zeile as Record<string, unknown>) : null;
}

/**
 * Ein Objekt aus dem, was jemand sagt: ID, Name oder Adresse. Mehrdeutigkeit ist ein Fehler
 * mit Trefferliste — raten wäre schlimmer, als noch einmal zu fragen.
 */
export async function objektAufloesen(db: D1Database, text: string): Promise<Objekt> {
  const eingabe = String(text ?? "").trim();
  if (!eingabe) throw new Error("Kein Objekt angegeben.");

  const direkt = await objektLesen(db, eingabe);
  if (direkt) return direkt;

  const muster = `%${eingabe}%`;
  const { results } = await db
    .prepare(
      "SELECT * FROM objekte WHERE aktiv = 1 AND (name LIKE ? OR adresse LIKE ?) ORDER BY name LIMIT 10",
    )
    .bind(muster, muster)
    .all();
  const treffer = (results ?? []).map((z) => alsObjekt(z as Record<string, unknown>));
  if (treffer.length === 1) return treffer[0];
  if (treffer.length === 0) throw new Error(`Objekt '${eingabe}' gibt es nicht.`);
  throw new Error(
    `'${eingabe}' passt auf mehrere Objekte: ${treffer.map((t) => `${t.name} (${t.id})`).join(", ")}.`,
  );
}

/** Wie `objektAufloesen`, aber null statt Fehler, wenn es nichts gibt. */
export async function objektSuchen(db: D1Database, text: string): Promise<Objekt | null> {
  try {
    return await objektAufloesen(db, text);
  } catch (e) {
    if (/gibt es nicht/.test((e as Error).message)) return null;
    throw e;
  }
}

export async function objektAendern(
  db: D1Database,
  id: string,
  patch: ObjektPatch,
): Promise<Objekt | null> {
  const felder = OBJEKT_SPALTEN.filter((s) => patch[s] !== undefined);
  if (felder.length) {
    await db
      .prepare(
        `UPDATE objekte SET ${felder.map((f) => `${f} = ?`).join(", ")}, geaendert_am = ? WHERE id = ?`,
      )
      .bind(...felder.map((f) => patch[f]!), jetzt(), id)
      .run();
  }
  return objektLesen(db, id);
}

export interface ObjektMitStand extends Objekt {
  bauteile: number;
  faellige_bauteile: number;
  offene_maengel: number;
  letzte_begehung: string | null;
  stand: Faelligkeit;
}

/**
 * Die Startseite: Objekte mit Fälligkeit, Bauteilzahl und offenen Mängeln, sortiert nach
 * Dringlichkeit. Drei Abfragen statt korrelierter Unterabfragen je Objekt — bei einigen
 * Dutzend Objekten und ein paar tausend Bauteilen ist das der ruhigere Weg.
 */
export async function objekteListe(
  db: D1Database,
  filter: { suche?: string; nur_faellige?: boolean; limit?: number } = {},
): Promise<ObjektMitStand[]> {
  const wo: string[] = ["o.aktiv = 1"];
  const werte: unknown[] = [];
  if (filter.suche) {
    wo.push("(o.name LIKE ? OR o.adresse LIKE ? OR o.betreiber LIKE ?)");
    const muster = `%${filter.suche}%`;
    werte.push(muster, muster, muster);
  }
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);

  const { results: objekte } = await db
    .prepare(`SELECT * FROM objekte o WHERE ${wo.join(" AND ")} ORDER BY o.name LIMIT ?`)
    .bind(...werte, limit)
    .all();

  const liste = (objekte ?? []).map((z) => alsObjekt(z as Record<string, unknown>));
  if (!liste.length) return [];

  const { results: stand } = await db
    .prepare(
      `SELECT b.objekt_id, b.id, b.intervall_monate, b.wartungspflichtig,
              (SELECT g.datum FROM pruefungen p JOIN begehungen g ON g.id = p.begehung_id
                 WHERE p.bauteil_id = b.id ORDER BY p.geprueft_am DESC LIMIT 1) AS letztes_datum
         FROM bauteile b WHERE b.aktiv = 1`,
    )
    .all();

  const { results: maengel } = await db
    .prepare(
      `SELECT objekt_id, COUNT(*) AS n FROM maengel
        WHERE status IN ('offen','in_arbeit') GROUP BY objekt_id`,
    )
    .all();

  const { results: begehungen } = await db
    .prepare("SELECT objekt_id, MAX(datum) AS letzte FROM begehungen GROUP BY objekt_id")
    .all();

  const mangelZahl = new Map<string, number>();
  for (const z of maengel ?? []) mangelZahl.set(String((z as any).objekt_id), Number((z as any).n));
  const letzteBegehung = new Map<string, string>();
  for (const z of begehungen ?? []) letzteBegehung.set(String((z as any).objekt_id), String((z as any).letzte));

  const mit: ObjektMitStand[] = liste.map((o) => {
    const eigene = (stand ?? []).filter((z) => String((z as any).objekt_id) === o.id);
    const pflichtig = eigene.filter((z) => Number((z as any).wartungspflichtig) === 1);
    const stufen = pflichtig.map((z) =>
      faelligkeit(
        ((z as any).letztes_datum as string) ?? null,
        Number((z as any).intervall_monate ?? 0) || o.intervall_monate,
      ),
    );
    return {
      ...o,
      bauteile: eigene.length,
      faellige_bauteile: stufen.filter((f) => f.nie_geprueft || (f.tage ?? 0) <= 0).length,
      offene_maengel: mangelZahl.get(o.id) ?? 0,
      letzte_begehung: letzteBegehung.get(o.id) ?? null,
      stand: frueheste(stufen),
    };
  });

  const rang = (f: Faelligkeit) => (f.nie_geprueft ? -1e9 : (f.tage ?? 1e9));
  mit.sort((a, b) => rang(a.stand) - rang(b.stand) || a.name.localeCompare(b.name, "de"));
  return filter.nur_faellige ? mit.filter((o) => o.faellige_bauteile > 0) : mit;
}

/* ── Gebäude und Geschosse ─────────────────────────────────────────────────── */

export async function gebaeudeListe(db: D1Database, objektId: string): Promise<Gebaeude[]> {
  const { results } = await db
    .prepare("SELECT * FROM gebaeude WHERE objekt_id = ? ORDER BY reihenfolge, name")
    .bind(objektId)
    .all();
  return (results ?? []) as unknown as Gebaeude[];
}

export async function geschossLesen(db: D1Database, id: string): Promise<Geschoss | null> {
  const zeile = await db.prepare("SELECT * FROM geschosse WHERE id = ?").bind(id).first();
  return (zeile as unknown as Geschoss) ?? null;
}

/** Zu welchem Objekt gehört dieses Geschoss? */
export async function objektZuGeschoss(db: D1Database, geschossId: string): Promise<string | null> {
  const zeile = await db
    .prepare(
      "SELECT b.objekt_id AS o FROM geschosse g JOIN gebaeude b ON b.id = g.gebaeude_id WHERE g.id = ?",
    )
    .bind(geschossId)
    .first<{ o: string }>();
  return zeile?.o ?? null;
}

export async function geschosseListe(db: D1Database, objektId: string): Promise<Geschoss[]> {
  const { results } = await db
    .prepare(
      `SELECT g.* FROM geschosse g JOIN gebaeude b ON b.id = g.gebaeude_id
        WHERE b.objekt_id = ? ORDER BY g.reihenfolge, g.name`,
    )
    .bind(objektId)
    .all();
  return (results ?? []) as unknown as Geschoss[];
}

/** Geschoss anlegen. Ohne Gebäude wird das erste des Objekts genommen. */
export async function geschossAnlegen(
  db: D1Database,
  objektId: string,
  name: string,
  reihenfolge?: number,
): Promise<Geschoss> {
  let gebaeude = (await gebaeudeListe(db, objektId))[0];
  if (!gebaeude) {
    const id = ulid();
    await db
      .prepare("INSERT INTO gebaeude (id, objekt_id, name, reihenfolge) VALUES (?,?,?,0)")
      .bind(id, objektId, "Hauptgebäude")
      .run();
    gebaeude = { id, objekt_id: objektId, name: "Hauptgebäude", reihenfolge: 0 };
  }
  const id = ulid();
  const ordnung = reihenfolge ?? reihenfolgeAusName(name);
  await db
    .prepare("INSERT INTO geschosse (id, gebaeude_id, name, reihenfolge) VALUES (?,?,?,?)")
    .bind(id, gebaeude.id, name, ordnung)
    .run();
  return {
    id, gebaeude_id: gebaeude.id, name, reihenfolge: ordnung,
    plan_schluessel: null, plan_breite: null, plan_hoehe: null, plan_quelle: null,
    einheiten_je_meter: null, start_x: null, start_y: null,
  };
}

/**
 * Aus einer Ortsangabe einen Geschossnamen ableiten — oder nichts.
 *
 * Der Monteur diktiert „erstes Obergeschoss", das Formular kennt ETAGE, und in `flur` steht mal
 * „EG", mal „Flur Nord". Nur was eindeutig wie ein Geschoss aussieht, wird eines: lieber kein
 * Geschoss als ein falsches, denn ein falsches verstellt die Laufreihenfolge für Jahre.
 *
 * Zurück kommt immer die kanonische Schreibweise („UG", „EG", „1. OG", „DG"), damit aus
 * „1.OG", „1. Obergeschoss" und „Etage 1" nicht drei Geschosse werden.
 */
export function geschossName(text: string | null | undefined): string | null {
  const n = String(text ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!n || n.length > 30) return null;

  const benannt = (stufe: number) =>
    stufe < 0 ? (stufe === -1 ? "UG" : `${-stufe}. UG`) : stufe === 0 ? "EG" : `${stufe}. OG`;

  if (/^(EG|ERDGESCHOSS|PARTERRE)$/.test(n)) return "EG";
  if (/^(UG|KG|KELLER|KELLERGESCHOSS|UNTERGESCHOSS|SOUTERRAIN)$/.test(n)) return "UG";
  if (/^(DG|DACH|DACHGESCHOSS|SPITZBODEN)$/.test(n)) return "DG";

  /* „1. OG", „2.UG", „3 OG", „1. Obergeschoss" */
  let t = /^(\d{1,2})\s*\.?\s*(OG|OBERGESCHOSS|STOCK|STOCKWERK)$/.exec(n);
  if (t) return benannt(Number(t[1]));
  t = /^(\d{1,2})\s*\.?\s*(UG|UNTERGESCHOSS)$/.exec(n);
  if (t) return benannt(-Number(t[1]));

  /* „Etage 2", „Geschoss -1", „Ebene 0" */
  t = /^(ETAGE|GESCHOSS|EBENE|STOCK)\s*\.?\s*(-?\d{1,2})$/.exec(n);
  if (t) return benannt(Number(t[2]));

  /* Das nackte Formularfeld ETAGE: „2", „-1", „0". */
  t = /^(-?\d{1,2})$/.exec(n);
  if (t) return benannt(Number(t[1]));

  return null;
}

/**
 * Das Geschoss aus der Raumnummer raten: „1.04" liegt im 1. OG, „0.01" im Erdgeschoss.
 * Nur bei der Schreibweise Ziffer-Punkt-Ziffer, und nur als letzte Auskunft, wenn weder
 * ein Geschoss genannt noch ETAGE gefüllt ist.
 */
export function geschossAusRaumnummer(raumnummer: string | null | undefined): string | null {
  const t = /^(-?\d{1,2})[.\-_/]\d/.exec(String(raumnummer ?? "").trim());
  return t ? geschossName(t[1]) : null;
}

/**
 * Die erste Ortsangabe, die wie ein Geschoss aussieht, zum Geschoss dieses Objekts machen —
 * und es anlegen, wenn es das noch nicht gibt. So entsteht die Etagenordnung beim Diktieren
 * von selbst; niemand muss je das Wort „Geschoss" lesen.
 */
export async function geschossZuordnen(
  db: D1Database,
  objektId: string,
  ...quellen: (string | null | undefined)[]
): Promise<string | null> {
  let name: string | null = null;
  for (const q of quellen) {
    name = geschossName(q);
    if (name) break;
  }
  if (!name) return null;
  const vorhanden = (await geschosseListe(db, objektId)).find(
    (g) => g.name.trim().toUpperCase() === name!.toUpperCase(),
  );
  if (vorhanden) return vorhanden.id;
  return (await geschossAnlegen(db, objektId, name)).id;
}

/** „UG" = −1, „EG" = 0, „2. OG" = 2 — die Laufreihenfolge folgt dem Treppenhaus. */
export function reihenfolgeAusName(name: string): number {
  const n = name.trim().toUpperCase();
  if (/^(UG|KG|KELLER)/.test(n)) return -1;
  if (/^(EG|ERD)/.test(n)) return 0;
  if (/^(DG|DACH)/.test(n)) return 99;
  const zahl = /(\d+)/.exec(n)?.[1];
  return zahl ? Number(zahl) : 0;
}

export async function geschossAendern(
  db: D1Database,
  id: string,
  patch: {
    name?: string;
    reihenfolge?: number;
    start_x?: number;
    start_y?: number;
    plan_schluessel?: string;
    plan_breite?: number;
    plan_hoehe?: number;
    plan_quelle?: string;
    einheiten_je_meter?: number;
  },
): Promise<void> {
  const felder = ([
    "name", "reihenfolge", "start_x", "start_y",
    "plan_schluessel", "plan_breite", "plan_hoehe", "plan_quelle", "einheiten_je_meter",
  ] as const).filter((f) => patch[f] !== undefined);
  if (!felder.length) return;
  await db
    .prepare(`UPDATE geschosse SET ${felder.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
    .bind(...felder.map((f) => patch[f]!), id)
    .run();
}

/** Für die Berichte: die Rechtsgrundlagen des Objekts, sonst der Standard der Vorlage. */
export function rechtsgrundlagen(o: Objekt, vorlagenId: string): string {
  if (o.rechtsgrundlagen) return o.rechtsgrundlagen;
  return vorlagenId === "wartung_feststellanlagen"
    ? "nach Allgemeine Bauartengenehmigung der DIBt"
    : "DIN 18650, DGUV, Herstellervorgaben";
}

export { heute, lies };

/**
 * Ein Objekt mit allem, was daran hängt, entfernen.
 *
 * Gedacht für Testläufe und Fehlanlagen — im Alltag wird ein Objekt stillgelegt (`aktiv = 0`),
 * nicht gelöscht: die Historie ist der Wert dieser Anwendung. Die Funktion gibt die
 * R2-Schlüssel zurück, die der Aufrufer danach wegräumt; die Datenschicht kennt R2 nicht.
 */
export async function objektLoeschen(db: D1Database, objektId: string): Promise<string[]> {
  const schluessel: string[] = [];
  const sammeln = async (sql: string) => {
    const { results } = await db.prepare(sql).bind(objektId).all();
    for (const z of results ?? []) {
      const wert = (z as Record<string, unknown>).k;
      if (wert) schluessel.push(String(wert));
    }
  };
  await sammeln(
    `SELECT r.r2_schluessel AS k FROM berichte r JOIN pruefungen p ON p.id = r.pruefung_id
      JOIN begehungen g ON g.id = p.begehung_id WHERE g.objekt_id = ?`,
  );
  await sammeln(
    `SELECT s.r2_schluessel AS k FROM sammelberichte s JOIN begehungen g ON g.id = s.begehung_id
      WHERE g.objekt_id = ?`,
  );
  await sammeln("SELECT r2_schluessel AS k FROM fotos WHERE objekt_id = ?");
  await sammeln(
    "SELECT betreiber_unterschrift AS k FROM begehungen WHERE objekt_id = ? AND betreiber_unterschrift IS NOT NULL",
  );
  await sammeln(
    `SELECT plan_schluessel AS k FROM geschosse g JOIN gebaeude b ON b.id = g.gebaeude_id
      WHERE b.objekt_id = ? AND g.plan_schluessel IS NOT NULL`,
  );

  /* Reihenfolge von innen nach außen, damit keine Zeile ohne ihr Gegenüber zurückbleibt. */
  await db.batch([
    db
      .prepare(
        `DELETE FROM berichte WHERE pruefung_id IN
          (SELECT p.id FROM pruefungen p JOIN begehungen g ON g.id = p.begehung_id WHERE g.objekt_id = ?)`,
      )
      .bind(objektId),
    db
      .prepare(
        "DELETE FROM sammelberichte WHERE begehung_id IN (SELECT id FROM begehungen WHERE objekt_id = ?)",
      )
      .bind(objektId),
    db.prepare("DELETE FROM fotos WHERE objekt_id = ?").bind(objektId),
    db.prepare("DELETE FROM maengel WHERE objekt_id = ?").bind(objektId),
    db
      .prepare(
        "DELETE FROM pruefungen WHERE begehung_id IN (SELECT id FROM begehungen WHERE objekt_id = ?)",
      )
      .bind(objektId),
    db.prepare("DELETE FROM begehungen WHERE objekt_id = ?").bind(objektId),
    db
      .prepare(
        "DELETE FROM vorschlaege WHERE import_id IN (SELECT id FROM importe WHERE objekt_id = ?)",
      )
      .bind(objektId),
    db.prepare("DELETE FROM importe WHERE objekt_id = ?").bind(objektId),
    db.prepare("DELETE FROM bauteile WHERE objekt_id = ?").bind(objektId),
    db
      .prepare(
        "DELETE FROM geschosse WHERE gebaeude_id IN (SELECT id FROM gebaeude WHERE objekt_id = ?)",
      )
      .bind(objektId),
    db.prepare("DELETE FROM gebaeude WHERE objekt_id = ?").bind(objektId),
    db.prepare("DELETE FROM objekte WHERE id = ?").bind(objektId),
  ]);
  return schluessel;
}
