/**
 * Mängel — der Lebenslauf einer Abweichung.
 *
 * Ein Mangel gehört dem Bauteil, nicht dem Termin: er entsteht aus einer Prüfung und bleibt
 * offen, bis jemand ihn freimeldet. Deshalb sieht die Begehung im nächsten Jahr, was vom
 * letzten Mal noch offen ist — und der Monteur wird danach gefragt.
 */
import { jetzt, lies, ulid } from "./basis";

export type MangelStatus = "offen" | "in_arbeit" | "behoben" | "verworfen";

export interface Mangel {
  id: string;
  objekt_id: string;
  bauteil_id: string;
  pruefung_id: string | null;
  punkte: string[];
  beschreibung: string;
  prioritaet: string;
  frist: string | null;
  zustaendig: string;
  status: MangelStatus;
  behoben_am: number | null;
  behoben_von: string;
  freimeldung: string;
  angelegt_am: number;
  geaendert_am: number;
}

export const OFFENE_STATUS = ["offen", "in_arbeit"] as const;

function alsMangel(zeile: Record<string, unknown>): Mangel {
  return {
    ...(zeile as unknown as Mangel),
    punkte: lies<string[]>(zeile.punkte_json, []),
  };
}

export interface MangelPatch {
  punkte?: string[];
  beschreibung?: string;
  prioritaet?: string;
  frist?: string | null;
  zustaendig?: string;
  status?: MangelStatus;
}

export async function mangelAnlegen(
  db: D1Database,
  daten: MangelPatch & { objekt_id: string; bauteil_id: string; pruefung_id?: string | null },
): Promise<Mangel> {
  const t = jetzt();
  const m: Mangel = {
    id: ulid(t),
    objekt_id: daten.objekt_id,
    bauteil_id: daten.bauteil_id,
    pruefung_id: daten.pruefung_id ?? null,
    punkte: daten.punkte ?? [],
    beschreibung: daten.beschreibung ?? "",
    prioritaet: daten.prioritaet ?? "mittel",
    frist: daten.frist ?? null,
    zustaendig: daten.zustaendig ?? "Seehafer",
    status: daten.status ?? "offen",
    behoben_am: null,
    behoben_von: "",
    freimeldung: "",
    angelegt_am: t,
    geaendert_am: t,
  };
  await db
    .prepare(
      `INSERT INTO maengel (id, objekt_id, bauteil_id, pruefung_id, punkte_json, beschreibung,
         prioritaet, frist, zustaendig, status, behoben_am, behoben_von, freimeldung,
         angelegt_am, geaendert_am)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      m.id, m.objekt_id, m.bauteil_id, m.pruefung_id, JSON.stringify(m.punkte), m.beschreibung,
      m.prioritaet, m.frist, m.zustaendig, m.status, null, "", "", m.angelegt_am, m.geaendert_am,
    )
    .run();
  return m;
}

export async function mangelLesen(db: D1Database, id: string): Promise<Mangel | null> {
  const zeile = await db.prepare("SELECT * FROM maengel WHERE id = ?").bind(id).first();
  return zeile ? alsMangel(zeile as Record<string, unknown>) : null;
}

export async function mangelAendern(
  db: D1Database,
  id: string,
  patch: MangelPatch,
): Promise<Mangel | null> {
  const sätze: string[] = [];
  const werte: unknown[] = [];
  for (const feld of ["beschreibung", "prioritaet", "frist", "zustaendig", "status"] as const) {
    if (patch[feld] !== undefined) {
      sätze.push(`${feld} = ?`);
      werte.push(patch[feld]);
    }
  }
  if (patch.punkte !== undefined) {
    sätze.push("punkte_json = ?");
    werte.push(JSON.stringify(patch.punkte));
  }
  if (!sätze.length) return mangelLesen(db, id);
  await db
    .prepare(`UPDATE maengel SET ${sätze.join(", ")}, geaendert_am = ? WHERE id = ?`)
    .bind(...werte, jetzt(), id)
    .run();
  return mangelLesen(db, id);
}

/** Freimeldung: „Dichtung ist getauscht." */
export async function mangelSchliessen(
  db: D1Database,
  id: string,
  freimeldung: string,
  von: string,
): Promise<Mangel | null> {
  const t = jetzt();
  await db
    .prepare(
      `UPDATE maengel SET status = 'behoben', behoben_am = ?, behoben_von = ?, freimeldung = ?,
        geaendert_am = ? WHERE id = ?`,
    )
    .bind(t, von, freimeldung, t, id)
    .run();
  return mangelLesen(db, id);
}

export async function maengelZuBauteil(
  db: D1Database,
  bauteilId: string,
  nurOffene = false,
): Promise<Mangel[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM maengel WHERE bauteil_id = ?
        ${nurOffene ? "AND status IN ('offen','in_arbeit')" : ""}
        ORDER BY angelegt_am DESC`,
    )
    .bind(bauteilId)
    .all();
  return (results ?? []).map((z) => alsMangel(z as Record<string, unknown>));
}

export interface MangelMitOrt extends Mangel {
  objekt_name: string;
  bauteil_nr: number;
  bauteil_kennung: string;
  bauteil_raum: string;
  bauteil_art: string;
}

export async function maengelListe(
  db: D1Database,
  filter: { objekt_id?: string; status?: string; faellig_bis?: string; limit?: number } = {},
): Promise<MangelMitOrt[]> {
  const wo: string[] = [];
  const werte: unknown[] = [];
  if (filter.objekt_id) {
    wo.push("m.objekt_id = ?");
    werte.push(filter.objekt_id);
  }
  if (filter.status === "offen" || !filter.status) wo.push("m.status IN ('offen','in_arbeit')");
  else if (filter.status !== "alle") {
    wo.push("m.status = ?");
    werte.push(filter.status);
  }
  if (filter.faellig_bis) {
    wo.push("m.frist IS NOT NULL AND m.frist <= ?");
    werte.push(filter.faellig_bis);
  }
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  const { results } = await db
    .prepare(
      `SELECT m.*, o.name AS objekt_name, b.nr AS bauteil_nr, b.kennung AS bauteil_kennung,
              b.raum AS bauteil_raum, b.art AS bauteil_art
         FROM maengel m
         JOIN objekte o ON o.id = m.objekt_id
         JOIN bauteile b ON b.id = m.bauteil_id
        ${wo.length ? `WHERE ${wo.join(" AND ")}` : ""}
        ORDER BY (m.frist IS NULL), m.frist, m.angelegt_am DESC
        LIMIT ?`,
    )
    .bind(...werte, limit)
    .all();
  return (results ?? []).map((z) => ({
    ...alsMangel(z as Record<string, unknown>),
    objekt_name: String((z as any).objekt_name ?? ""),
    bauteil_nr: Number((z as any).bauteil_nr ?? 0),
    bauteil_kennung: String((z as any).bauteil_kennung ?? ""),
    bauteil_raum: String((z as any).bauteil_raum ?? ""),
    bauteil_art: String((z as any).bauteil_art ?? ""),
  }));
}

/** Der Mangel, der aus einer Prüfung stammt — je Prüfung höchstens einer. */
export async function mangelZuPruefung(
  db: D1Database,
  pruefungId: string,
): Promise<Mangel | null> {
  const zeile = await db
    .prepare(
      "SELECT * FROM maengel WHERE pruefung_id = ? AND status IN ('offen','in_arbeit') ORDER BY angelegt_am LIMIT 1",
    )
    .bind(pruefungId)
    .first();
  return zeile ? alsMangel(zeile as Record<string, unknown>) : null;
}
