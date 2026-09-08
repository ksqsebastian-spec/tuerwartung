/**
 * Importe und Vorschläge — der Zwischenstand zwischen „gelesen" und „bestätigt".
 *
 * Ein Import ist ein Plan oder eine Türliste, die jemand ausgewertet hat. Was dabei gefunden
 * wurde, steht als Vorschlag hier und wird erst durch eine Freigabe zum Bauteil (Leitsatz 6:
 * kein Import legt Bauteile ohne Freigabe an). Wer ausgewertet hat, ist der Datenschicht egal —
 * seit Abschnitt 7.0 ist es der Agent in der Claude-App, der den Plan ohnehin vor sich hat.
 */
import { jetzt, lies, ulid } from "./basis";
import { bauteilAnlegen, bauteilPerNr, naechsteNr } from "./bauteile";
import type { Bauteil } from "./bauteile";

export type ImportArt = "tuerliste" | "plan" | "plan_vektor" | "plan_raster" | "dxf";
export type ImportStatus = "hochgeladen" | "ausgewertet" | "bestaetigt" | "verworfen";

export interface Import {
  id: string;
  objekt_id: string;
  geschoss_id: string | null;
  art: string;
  dateiname: string;
  r2_schluessel: string;
  status: ImportStatus;
  ergebnis: Record<string, unknown>;
  angelegt_von: string;
  angelegt_am: number;
}

export interface Vorschlag {
  id: string;
  import_id: string;
  objekt_id: string;
  geschoss_id: string | null;
  x: number | null;
  y: number | null;
  richtung_grad: number | null;
  breite_m: number | null;
  kennung: string;
  raumnummer: string;
  raum: string;
  art: string;
  /** Der Türtyp aus der Liste — er bestimmt später Vorlage und Checkliste. */
  tuertyp_id: string | null;
  felder: Record<string, string>;
  wartungspflichtig: number;
  konfidenz: number;
  herkunft: string;
  text_nahe: string[];
  status: "offen" | "angenommen" | "verworfen";
  bauteil_id: string | null;
  angelegt_am: number;
}

function alsImport(zeile: Record<string, unknown>): Import {
  return {
    ...(zeile as unknown as Import),
    ergebnis: lies<Record<string, unknown>>(zeile.ergebnis_json, {}),
  };
}

function alsVorschlag(zeile: Record<string, unknown>): Vorschlag {
  return {
    ...(zeile as unknown as Vorschlag),
    felder: lies<Record<string, string>>(zeile.felder_json, {}),
    text_nahe: lies<string[]>(zeile.text_nahe_json, []),
  };
}

/* ── Importe ───────────────────────────────────────────────────────────────── */

export async function importAnlegen(
  db: D1Database,
  daten: {
    objekt_id: string;
    art: string;
    dateiname: string;
    geschoss_id?: string | null;
    r2_schluessel?: string;
    angelegt_von?: string;
  },
): Promise<Import> {
  const t = jetzt();
  const i: Import = {
    id: ulid(t),
    objekt_id: daten.objekt_id,
    geschoss_id: daten.geschoss_id ?? null,
    art: daten.art,
    dateiname: daten.dateiname,
    r2_schluessel: daten.r2_schluessel ?? "",
    status: "hochgeladen",
    ergebnis: {},
    angelegt_von: daten.angelegt_von ?? "",
    angelegt_am: t,
  };
  await db
    .prepare(
      `INSERT INTO importe (id, objekt_id, geschoss_id, art, dateiname, r2_schluessel, status,
         ergebnis_json, angelegt_von, angelegt_am) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      i.id, i.objekt_id, i.geschoss_id, i.art, i.dateiname, i.r2_schluessel, i.status,
      "{}", i.angelegt_von, i.angelegt_am,
    )
    .run();
  return i;
}

export async function importLesen(db: D1Database, id: string): Promise<Import | null> {
  const zeile = await db.prepare("SELECT * FROM importe WHERE id = ?").bind(id).first();
  return zeile ? alsImport(zeile as Record<string, unknown>) : null;
}

export async function importeListe(db: D1Database, objektId: string): Promise<Import[]> {
  const { results } = await db
    .prepare("SELECT * FROM importe WHERE objekt_id = ? ORDER BY angelegt_am DESC")
    .bind(objektId)
    .all();
  return (results ?? []).map((z) => alsImport(z as Record<string, unknown>));
}

export async function importAendern(
  db: D1Database,
  id: string,
  patch: {
    status?: ImportStatus;
    r2_schluessel?: string;
    geschoss_id?: string | null;
    ergebnis?: Record<string, unknown>;
  },
): Promise<Import | null> {
  const sätze: string[] = [];
  const werte: unknown[] = [];
  for (const feld of ["status", "r2_schluessel", "geschoss_id"] as const) {
    if (patch[feld] !== undefined) {
      sätze.push(`${feld} = ?`);
      werte.push(patch[feld]);
    }
  }
  if (patch.ergebnis !== undefined) {
    const vorher = await importLesen(db, id);
    sätze.push("ergebnis_json = ?");
    werte.push(JSON.stringify({ ...(vorher?.ergebnis ?? {}), ...patch.ergebnis }));
  }
  if (!sätze.length) return importLesen(db, id);
  await db
    .prepare(`UPDATE importe SET ${sätze.join(", ")} WHERE id = ?`)
    .bind(...werte, id)
    .run();
  return importLesen(db, id);
}

/* ── Vorschläge ────────────────────────────────────────────────────────────── */

export interface VorschlagEingabe {
  x?: number | null;
  y?: number | null;
  richtung_grad?: number | null;
  breite_m?: number | null;
  kennung?: string;
  raumnummer?: string;
  raum?: string;
  art?: string;
  tuertyp_id?: string | null;
  felder?: Record<string, string>;
  wartungspflichtig?: boolean | number;
  konfidenz?: number;
  herkunft?: string;
  text_nahe?: string[];
  geschoss_id?: string | null;
}

/** Zahl im Bereich 0..1 oder null — der Agent schätzt, wir lassen nichts Unsinniges durch. */
function anteil(wert: unknown): number | null {
  const n = Number(wert);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, 0), 1);
}

export async function vorschlaegeAnlegen(
  db: D1Database,
  imp: Import,
  kandidaten: VorschlagEingabe[],
): Promise<Vorschlag[]> {
  const t = jetzt();
  const out: Vorschlag[] = [];
  const anweisungen = [];
  for (const k of kandidaten) {
    const v: Vorschlag = {
      id: ulid(t),
      import_id: imp.id,
      objekt_id: imp.objekt_id,
      geschoss_id: k.geschoss_id ?? imp.geschoss_id ?? null,
      x: k.x === null || k.x === undefined ? null : anteil(k.x),
      y: k.y === null || k.y === undefined ? null : anteil(k.y),
      richtung_grad: k.richtung_grad ?? null,
      breite_m: k.breite_m ?? null,
      kennung: String(k.kennung ?? "").trim(),
      raumnummer: String(k.raumnummer ?? "").trim(),
      raum: String(k.raum ?? "").trim(),
      art: k.art || "wartung_drehfluegel",
      tuertyp_id: k.tuertyp_id ?? null,
      felder: k.felder ?? {},
      wartungspflichtig: k.wartungspflichtig ? 1 : 0,
      konfidenz: Math.min(Math.max(Number(k.konfidenz ?? 0.8), 0), 1),
      herkunft: k.herkunft || (imp.art === "tuerliste" ? "tuerliste" : "vision"),
      text_nahe: k.text_nahe ?? [],
      status: "offen",
      bauteil_id: null,
      angelegt_am: t,
    };
    out.push(v);
    anweisungen.push(
      db
        .prepare(
          `INSERT INTO vorschlaege (id, import_id, objekt_id, geschoss_id, x, y, richtung_grad,
             breite_m, kennung, raumnummer, raum, art, tuertyp_id, felder_json, wartungspflichtig,
             konfidenz, herkunft, text_nahe_json, status, bauteil_id, angelegt_am)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          v.id, v.import_id, v.objekt_id, v.geschoss_id, v.x, v.y, v.richtung_grad, v.breite_m,
          v.kennung, v.raumnummer, v.raum, v.art, v.tuertyp_id, JSON.stringify(v.felder),
          v.wartungspflichtig, v.konfidenz, v.herkunft, JSON.stringify(v.text_nahe), v.status,
          null, v.angelegt_am,
        ),
    );
  }
  /* D1 verträgt keine unbegrenzten Stapel — in Häppchen, ein Plan hat auch mal 200 Türen. */
  for (let i = 0; i < anweisungen.length; i += 20) {
    await db.batch(anweisungen.slice(i, i + 20));
  }
  return out;
}

export async function vorschlaegeLesen(
  db: D1Database,
  filter: { import_id?: string; objekt_id?: string; geschoss_id?: string; status?: string },
): Promise<Vorschlag[]> {
  const wo: string[] = [];
  const werte: unknown[] = [];
  if (filter.import_id) {
    wo.push("import_id = ?");
    werte.push(filter.import_id);
  }
  if (filter.objekt_id) {
    wo.push("objekt_id = ?");
    werte.push(filter.objekt_id);
  }
  if (filter.geschoss_id) {
    wo.push("geschoss_id = ?");
    werte.push(filter.geschoss_id);
  }
  if (filter.status && filter.status !== "alle") {
    wo.push("status = ?");
    werte.push(filter.status);
  }
  const { results } = await db
    .prepare(
      `SELECT * FROM vorschlaege ${wo.length ? `WHERE ${wo.join(" AND ")}` : ""}
        ORDER BY konfidenz DESC, angelegt_am`,
    )
    .bind(...werte)
    .all();
  return (results ?? []).map((z) => alsVorschlag(z as Record<string, unknown>));
}

export async function vorschlagLesen(db: D1Database, id: string): Promise<Vorschlag | null> {
  const zeile = await db.prepare("SELECT * FROM vorschlaege WHERE id = ?").bind(id).first();
  return zeile ? alsVorschlag(zeile as Record<string, unknown>) : null;
}

export async function vorschlagAendern(
  db: D1Database,
  id: string,
  patch: VorschlagEingabe & { status?: string },
): Promise<Vorschlag | null> {
  const sätze: string[] = [];
  const werte: unknown[] = [];
  for (const feld of [
    "x", "y", "richtung_grad", "breite_m", "kennung", "raumnummer", "raum", "art", "status",
    "geschoss_id", "konfidenz",
  ] as const) {
    if ((patch as Record<string, unknown>)[feld] !== undefined) {
      sätze.push(`${feld} = ?`);
      werte.push((patch as Record<string, unknown>)[feld]);
    }
  }
  if (patch.wartungspflichtig !== undefined) {
    sätze.push("wartungspflichtig = ?");
    werte.push(patch.wartungspflichtig ? 1 : 0);
  }
  if (patch.felder !== undefined) {
    sätze.push("felder_json = ?");
    werte.push(JSON.stringify(patch.felder));
  }
  if (!sätze.length) return vorschlagLesen(db, id);
  await db
    .prepare(`UPDATE vorschlaege SET ${sätze.join(", ")} WHERE id = ?`)
    .bind(...werte, id)
    .run();
  return vorschlagLesen(db, id);
}

/**
 * Aus Vorschlägen werden Bauteile. Die Nummer kommt aus der Kennung, wenn sie eine reine Zahl
 * und noch frei ist — der Monteur diktiert später „Tür 12", und dann soll das die Tür sein, die
 * im Plan die 12 trägt. Sonst zählt der Server hoch.
 */
export async function vorschlaegeAnnehmen(
  db: D1Database,
  vorschlaege: Vorschlag[],
): Promise<{ angelegt: Bauteil[]; uebersprungen: { id: string; grund: string }[] }> {
  const angelegt: Bauteil[] = [];
  const uebersprungen: { id: string; grund: string }[] = [];

  for (const v of vorschlaege) {
    if (v.status === "angenommen") {
      uebersprungen.push({ id: v.id, grund: "war schon angenommen" });
      continue;
    }
    let nr: number | undefined;
    const ausKennung = /^\d{1,4}$/.test(v.kennung) ? Number(v.kennung) : NaN;
    if (Number.isFinite(ausKennung) && ausKennung > 0) {
      const belegt = await bauteilPerNr(db, v.objekt_id, ausKennung);
      if (!belegt) nr = ausKennung;
    }
    const b = await bauteilAnlegen(db, {
      objekt_id: v.objekt_id,
      art: v.art,
      tuertyp_id: v.tuertyp_id,
      nr: nr ?? (await naechsteNr(db, v.objekt_id)),
      kennung: v.kennung,
      geschoss_id: v.geschoss_id,
      raumnummer: v.raumnummer,
      raum: v.raum,
      felder: v.felder,
      x: v.x,
      y: v.y,
      richtung_grad: v.richtung_grad,
      breite_m: v.breite_m,
      wartungspflichtig: v.wartungspflichtig,
      quelle: v.herkunft === "tuerliste" ? "tuerliste" : v.herkunft === "manuell" ? "manuell" : "plan",
    });
    await db
      .prepare("UPDATE vorschlaege SET status = 'angenommen', bauteil_id = ? WHERE id = ?")
      .bind(b.id, v.id)
      .run();
    angelegt.push(b);
  }
  return { angelegt, uebersprungen };
}

export async function vorschlaegeVerwerfen(db: D1Database, ids: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const teil = ids.slice(i, i + 20);
    await db.batch(
      teil.map((id) =>
        db
          .prepare("UPDATE vorschlaege SET status = 'verworfen' WHERE id = ? AND status = 'offen'")
          .bind(id),
      ),
    );
    n += teil.length;
  }
  return n;
}

/** Zahlen für die Kopfleiste: „12 offen · 30 angenommen · 4 verworfen". */
export function zaehlen(vorschlaege: Vorschlag[]) {
  return {
    gesamt: vorschlaege.length,
    offen: vorschlaege.filter((v) => v.status === "offen").length,
    angenommen: vorschlaege.filter((v) => v.status === "angenommen").length,
    verworfen: vorschlaege.filter((v) => v.status === "verworfen").length,
    mit_position: vorschlaege.filter((v) => v.x !== null && v.y !== null).length,
    wartungspflichtig: vorschlaege.filter((v) => v.wartungspflichtig === 1).length,
  };
}
