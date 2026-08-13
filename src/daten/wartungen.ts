/**
 * Datenzugriff. Alles, was mit D1 spricht, steht hier — Tools und Website benutzen dieselben
 * Funktionen, damit eine Tür über den MCP-Server genauso entsteht wie über das Formular.
 */
import type { Bewertung } from "../vorlagen";
import { STAMMFELDER, vorlage } from "../vorlagen";

export interface Wartung {
  id: string;
  vorlage: string;
  objekt: string;
  betreiber: string;
  ident: string;
  tuertyp: string;
  pruefer: string;
  befaehigung: string;
  datum: string;
  ort: string;
  rechtsgrundlagen: string;
  letzte_pruefung: string;
  naechste_pruefung: string;
  beteiligte: string;
  status: "offen" | "abgeschlossen" | "generiert";
  angelegt_von: string;
  angelegt_am: number;
  geaendert_am: number;
}

export interface Tuer {
  id: number;
  wartung_id: string;
  nr: number;
  dateiname: string;
  felder: Record<string, string>;
  checks: Record<string, Bewertung>;
  ergebnis: string;
  hinweise: string;
  status: "erfasst" | "generiert";
  pdf_schluessel: string | null;
  erzeugt_am: number | null;
  angelegt_am: number;
  geaendert_am: number;
}

export interface Person {
  benutzer: string;
  name: string;
  passwort_hash: string;
  vorgaben: Record<string, string>;
  unterschrift: string | null;
}


/** Spalten von `wartungen`, die per Patch gesetzt werden dürfen. */
const WARTUNG_SPALTEN = [
  "vorlage",
  "objekt",
  "betreiber",
  "ident",
  "tuertyp",
  "pruefer",
  "befaehigung",
  "datum",
  "ort",
  "rechtsgrundlagen",
  "letzte_pruefung",
  "naechste_pruefung",
  "beteiligte",
  "status",
] as const;

export type WartungPatch = Partial<Record<(typeof WARTUNG_SPALTEN)[number], string>>;

const jetzt = () => Date.now();

/** Aus „Heselstücken 12, Hamburg" wird „Heselstuecken-12-Hamburg". */
export function slug(text: string, laenge = 40): string {
  const ersetzt = text
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss");
  return (
    ersetzt
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, laenge) || "wartung"
  );
}

export function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Prüfdatum + 1 Jahr — die Voreinstellung für die nächste Prüfung. */
export function inEinemJahr(datum: string): string {
  const d = new Date(`${datum}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function alsWartung(zeile: Record<string, unknown>): Wartung {
  return zeile as unknown as Wartung;
}

function alsTuer(zeile: Record<string, unknown>): Tuer {
  const lies = (s: unknown) => {
    try {
      const o = JSON.parse(String(s || "{}"));
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  };
  return {
    ...(zeile as unknown as Tuer),
    felder: lies(zeile.felder),
    checks: lies(zeile.checks),
  };
}

/* ── Wartungen ─────────────────────────────────────────────────────────────── */

export async function wartungAnlegen(
  db: D1Database,
  daten: WartungPatch & { id?: string; angelegt_von?: string },
): Promise<Wartung> {
  const vorlagenId = daten.vorlage ?? "";
  vorlage(vorlagenId); // wirft bei unbekannter Vorlage — lieber hier als beim Erzeugen

  const datum = daten.datum || heute();
  const id = daten.id?.trim() || `WART-${datum}-${slug(daten.objekt ?? "", 28)}`;

  const vorhanden = await wartungLesen(db, id);
  if (vorhanden) {
    return (await wartungAendern(db, id, daten))!;
  }

  const t = jetzt();
  const w: Wartung = {
    id,
    vorlage: vorlagenId,
    objekt: daten.objekt ?? "",
    betreiber: daten.betreiber ?? "",
    ident: daten.ident ?? "",
    tuertyp: daten.tuertyp ?? "",
    pruefer: daten.pruefer ?? "",
    befaehigung: daten.befaehigung || "Sachkundiger DGWZ",
    datum,
    ort: daten.ort || "Hamburg",
    rechtsgrundlagen:
      daten.rechtsgrundlagen ||
      (vorlagenId === "wartung_feststellanlagen"
        ? "nach Allgemeine Bauartengenehmigung der DIBt"
        : "DIN 18650, DGUV, Herstellervorgaben"),
    letzte_pruefung: daten.letzte_pruefung ?? "",
    naechste_pruefung: daten.naechste_pruefung || inEinemJahr(datum),
    beteiligte: daten.beteiligte ?? "",
    status: "offen",
    angelegt_von: daten.angelegt_von ?? "",
    angelegt_am: t,
    geaendert_am: t,
  };

  await db
    .prepare(
      `INSERT INTO wartungen (id, vorlage, objekt, betreiber, ident, tuertyp, pruefer, befaehigung,
        datum, ort, rechtsgrundlagen, letzte_pruefung, naechste_pruefung, beteiligte, status,
        angelegt_von, angelegt_am, geaendert_am)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      w.id, w.vorlage, w.objekt, w.betreiber, w.ident, w.tuertyp, w.pruefer, w.befaehigung,
      w.datum, w.ort, w.rechtsgrundlagen, w.letzte_pruefung, w.naechste_pruefung, w.beteiligte,
      w.status, w.angelegt_von, w.angelegt_am, w.geaendert_am,
    )
    .run();
  return w;
}

export async function wartungLesen(db: D1Database, id: string): Promise<Wartung | null> {
  const zeile = await db.prepare("SELECT * FROM wartungen WHERE id = ?").bind(id).first();
  return zeile ? alsWartung(zeile) : null;
}

export async function wartungAendern(
  db: D1Database,
  id: string,
  patch: WartungPatch,
): Promise<Wartung | null> {
  const felder = WARTUNG_SPALTEN.filter((s) => patch[s] !== undefined);
  if (felder.length) {
    await db
      .prepare(
        `UPDATE wartungen SET ${felder.map((f) => `${f} = ?`).join(", ")}, geaendert_am = ?
         WHERE id = ?`,
      )
      .bind(...felder.map((f) => patch[f]!), jetzt(), id)
      .run();
  }
  return wartungLesen(db, id);
}

export interface ListenFilter {
  suche?: string;
  status?: string;
  limit?: number;
}

export interface WartungMitZahlen extends Wartung {
  tueren: number;
  offen: number;
}

export async function wartungenListe(
  db: D1Database,
  filter: ListenFilter = {},
): Promise<WartungMitZahlen[]> {
  const wo: string[] = [];
  const werte: unknown[] = [];
  if (filter.status) {
    wo.push("w.status = ?");
    werte.push(filter.status);
  }
  if (filter.suche) {
    wo.push("(w.id LIKE ? OR w.objekt LIKE ? OR w.betreiber LIKE ?)");
    const muster = `%${filter.suche}%`;
    werte.push(muster, muster, muster);
  }
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const { results } = await db
    .prepare(
      `SELECT w.*,
              (SELECT COUNT(*) FROM tueren t WHERE t.wartung_id = w.id) AS tueren,
              (SELECT COUNT(*) FROM tueren t WHERE t.wartung_id = w.id AND t.status <> 'generiert') AS offen
         FROM wartungen w
        ${wo.length ? `WHERE ${wo.join(" AND ")}` : ""}
        ORDER BY w.geaendert_am DESC
        LIMIT ?`,
    )
    .bind(...werte, limit)
    .all();
  return (results ?? []) as unknown as WartungMitZahlen[];
}

export async function wartungLoeschen(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM tueren WHERE wartung_id = ?").bind(id),
    db.prepare("DELETE FROM wartungen WHERE id = ?").bind(id),
  ]);
}

/* ── Türen ─────────────────────────────────────────────────────────────────── */

export async function tuerenLesen(db: D1Database, wartungId: string): Promise<Tuer[]> {
  const { results } = await db
    .prepare("SELECT * FROM tueren WHERE wartung_id = ? ORDER BY nr")
    .bind(wartungId)
    .all();
  return (results ?? []).map((z) => alsTuer(z as Record<string, unknown>));
}

export async function tuerLesen(
  db: D1Database,
  wartungId: string,
  nr: number,
): Promise<Tuer | null> {
  const zeile = await db
    .prepare("SELECT * FROM tueren WHERE wartung_id = ? AND nr = ?")
    .bind(wartungId, nr)
    .first();
  return zeile ? alsTuer(zeile as Record<string, unknown>) : null;
}

export interface TuerPatch {
  nr?: number;
  dateiname?: string;
  felder?: Record<string, string>;
  checks?: Record<string, Bewertung>;
  ergebnis?: string;
  hinweise?: string;
  status?: "erfasst" | "generiert";
}

/**
 * Tür anlegen oder überschreiben. Ohne `nr` wird hochgezählt; `felder` und `checks` ersetzen
 * die bisherigen Werte vollständig — wer nur ergänzen will, liest vorher und mischt selbst.
 * Jede Änderung setzt den Bericht zurück auf `erfasst`, damit er neu erzeugt wird.
 */
export async function tuerSpeichern(
  db: D1Database,
  wartungId: string,
  patch: TuerPatch,
): Promise<Tuer> {
  const nr = patch.nr ?? (await naechsteNr(db, wartungId));
  const vorher = await tuerLesen(db, wartungId, nr);
  const t = jetzt();

  const neu: Omit<Tuer, "id"> = {
    wartung_id: wartungId,
    nr,
    dateiname: patch.dateiname ?? vorher?.dateiname ?? "",
    felder: patch.felder ?? vorher?.felder ?? {},
    checks: patch.checks ?? vorher?.checks ?? {},
    ergebnis: patch.ergebnis ?? vorher?.ergebnis ?? "",
    hinweise: patch.hinweise ?? vorher?.hinweise ?? "",
    status: patch.status ?? "erfasst",
    pdf_schluessel: patch.status === "generiert" ? (vorher?.pdf_schluessel ?? null) : null,
    erzeugt_am: patch.status === "generiert" ? (vorher?.erzeugt_am ?? null) : null,
    angelegt_am: vorher?.angelegt_am ?? t,
    geaendert_am: t,
  };

  await db
    .prepare(
      `INSERT INTO tueren (wartung_id, nr, dateiname, felder, checks, ergebnis, hinweise, status,
                           pdf_schluessel, erzeugt_am, angelegt_am, geaendert_am)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (wartung_id, nr) DO UPDATE SET
         dateiname = excluded.dateiname, felder = excluded.felder, checks = excluded.checks,
         ergebnis = excluded.ergebnis, hinweise = excluded.hinweise, status = excluded.status,
         pdf_schluessel = excluded.pdf_schluessel, erzeugt_am = excluded.erzeugt_am,
         geaendert_am = excluded.geaendert_am`,
    )
    .bind(
      wartungId, nr, neu.dateiname, JSON.stringify(neu.felder), JSON.stringify(neu.checks),
      neu.ergebnis, neu.hinweise, neu.status, neu.pdf_schluessel, neu.erzeugt_am,
      neu.angelegt_am, neu.geaendert_am,
    )
    .run();

  await db
    .prepare("UPDATE wartungen SET geaendert_am = ?, status = 'offen' WHERE id = ? AND status = 'generiert'")
    .bind(t, wartungId)
    .run();
  await db.prepare("UPDATE wartungen SET geaendert_am = ? WHERE id = ?").bind(t, wartungId).run();

  return (await tuerLesen(db, wartungId, nr))!;
}

/** Bericht einer Tür festschreiben. */
export async function tuerBerichtGesetzt(
  db: D1Database,
  wartungId: string,
  nr: number,
  schluessel: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE tueren SET status = 'generiert', pdf_schluessel = ?, erzeugt_am = ?, geaendert_am = ?
        WHERE wartung_id = ? AND nr = ?`,
    )
    .bind(schluessel, jetzt(), jetzt(), wartungId, nr)
    .run();
}

export async function tuerLoeschen(db: D1Database, wartungId: string, nr: number): Promise<void> {
  await db.prepare("DELETE FROM tueren WHERE wartung_id = ? AND nr = ?").bind(wartungId, nr).run();
}

export async function naechsteNr(db: D1Database, wartungId: string): Promise<number> {
  const zeile = await db
    .prepare("SELECT COALESCE(MAX(nr), 0) AS m FROM tueren WHERE wartung_id = ?")
    .bind(wartungId)
    .first<{ m: number }>();
  return (zeile?.m ?? 0) + 1;
}

/* ── Personen ──────────────────────────────────────────────────────────────── */

export async function personLesen(db: D1Database, benutzer: string): Promise<Person | null> {
  const zeile = await db
    .prepare("SELECT * FROM personen WHERE benutzer = ?")
    .bind(benutzer.toLowerCase())
    .first();
  if (!zeile) return null;
  let vorgaben: Record<string, string> = {};
  try {
    vorgaben = JSON.parse(String((zeile as any).vorgaben || "{}"));
  } catch {
    /* kaputtes JSON ist kein Grund, die Anmeldung scheitern zu lassen */
  }
  return { ...(zeile as unknown as Person), vorgaben };
}

export async function personenListe(db: D1Database): Promise<Person[]> {
  const { results } = await db.prepare("SELECT * FROM personen ORDER BY name").all();
  return (results ?? []).map((z) => ({ ...(z as unknown as Person), vorgaben: {} }));
}

export async function personGesehen(db: D1Database, benutzer: string): Promise<void> {
  await db
    .prepare("UPDATE personen SET zuletzt_gesehen = ? WHERE benutzer = ?")
    .bind(jetzt(), benutzer.toLowerCase())
    .run();
}

export async function personSpeichern(
  db: D1Database,
  benutzer: string,
  patch: { vorgaben?: Record<string, string>; unterschrift?: string; passwort_hash?: string },
): Promise<void> {
  const vorher = await personLesen(db, benutzer);
  await db
    .prepare(
      `INSERT INTO personen (benutzer, name, passwort_hash, vorgaben, unterschrift, zuletzt_gesehen)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (benutzer) DO UPDATE SET passwort_hash = excluded.passwort_hash,
         vorgaben = excluded.vorgaben, unterschrift = excluded.unterschrift,
         zuletzt_gesehen = excluded.zuletzt_gesehen`,
    )
    .bind(
      benutzer.toLowerCase(),
      vorher?.name ?? benutzer,
      patch.passwort_hash ?? vorher?.passwort_hash ?? "",
      JSON.stringify(patch.vorgaben ?? vorher?.vorgaben ?? {}),
      patch.unterschrift ?? vorher?.unterschrift ?? null,
      jetzt(),
    )
    .run();
}

/* ── Datensatz fürs PDF ────────────────────────────────────────────────────── */

/** Stammdaten der Wartung + Felder der Tür → ein flacher Datensatz, wie ihn das Profil erwartet. */
export function datensatz(w: Wartung, t: Tuer): Record<string, string> {
  const rec: Record<string, string> = {
    IDENT: w.ident,
    BETREIBER: w.betreiber,
    OBJEKT: w.objekt,
    TUERTYP: w.tuertyp,
    PRUEFER: w.pruefer,
    BEFAEHIGUNG: w.befaehigung,
    DATUM: w.datum,
    ORT: w.ort,
    RECHTSGRUNDLAGEN: w.rechtsgrundlagen,
    LETZTE_PRUEFUNG: w.letzte_pruefung,
    NAECHSTE_PRUEFUNG: w.naechste_pruefung,
    BETEILIGTE: w.beteiligte,
    ERGEBNIS: t.ergebnis,
    HINWEISE: t.hinweise,
  };
  for (const [k, v] of Object.entries(t.felder)) {
    if (v !== undefined && v !== null && v !== "") rec[k] = String(v);
  }
  return rec;
}

/** Dateiname des Berichts — ohne Endung, ohne Sonderzeichen. */
export function berichtName(w: Wartung, t: Tuer): string {
  if (t.dateiname) return slug(t.dateiname, 120);
  const teile = [
    "WAR",
    w.datum,
    slug(w.objekt, 28),
    `Tuer-${String(t.nr).padStart(2, "0")}`,
    slug(t.felder.RAUM ?? t.felder.ETAGE ?? "", 20),
  ].filter(Boolean);
  return slug(teile.join("_"), 120);
}
