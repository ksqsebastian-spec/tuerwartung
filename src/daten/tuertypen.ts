/**
 * Türtypen — die Stammdatenebene über den Bauteilen.
 *
 * Ein Türtyp ist eine benannte Ausprägung einer der drei Vorlagen: „T30 Flurtür Hörmann" auf
 * Basis „Drehflügeltüren". Er trägt zweierlei:
 *
 * 1. **Gemeinsame Stammdaten** — Hersteller, Zulassung, Türtyp-Bezeichnung. Was für alle Türen
 *    dieses Typs gleich ist, wird einmal hinterlegt statt an jeder Tür wiederholt.
 * 2. **Seine Checkliste** — die Prüfpunkte der Vorlage, wie sie hier gelten sollen. Punkte lassen
 *    sich umbenennen, ausblenden und um eigene ergänzen; dazu kommen Zusatzfelder, die je Tür
 *    erfasst werden (Geschoss, Kommentar …).
 *
 * Der Haken beim Anpassen: das Berichts-PDF hat feste Ankreuzkästchen. Deshalb behalten die
 * Punkte aus der Vorlage **ihre Nummer** — umbenennen ändert nur den Text, ausblenden lässt das
 * Kästchen leer. Eigene Punkte bekommen Nummern ab `EIGEN_AB` und landen im Bericht unter
 * „Hinweise", weil das Formular für sie kein Kästchen hat.
 */
import type { Pruefpunkt } from "../vorlagen";
import { vorlage } from "../vorlagen";
import { jetzt, lies, ulid } from "./basis";

/** Ab hier zählen selbst hinzugefügte Punkte — außerhalb dessen, was das Formular kennt. */
export const EIGEN_AB = 900;

export interface TypPunkt {
  nr: string;
  text: string;
  /** false = im Diktat und auf der Checkliste ausgeblendet; das Formularkästchen bleibt leer. */
  aktiv: boolean;
  /** true = nicht aus der Vorlage, sondern selbst hinzugefügt. */
  eigen: boolean;
}

export interface Zusatzfeld {
  schluessel: string;
  label: string;
  pflicht: boolean;
}

export interface Tuertyp {
  id: string;
  name: string;
  art: string;
  beschreibung: string;
  felder: Record<string, string>;
  punkte: TypPunkt[];
  zusatz: Zusatzfeld[];
  /** Stammdaten, die beim Einrichten einer Tür stehen müssen, bevor es losgehen kann. */
  pflicht: string[];
  aktiv: number;
  angelegt_von: string;
  angelegt_am: number;
  geaendert_am: number;
}

/** Die Checkliste, mit der ein Türtyp startet: die Punkte seiner Vorlage, alle aktiv. */
export function punkteAusVorlage(art: string): TypPunkt[] {
  return vorlage(art).punkte.map((p: Pruefpunkt) => ({
    nr: p.nr,
    text: p.text,
    aktiv: true,
    eigen: false,
  }));
}

function alsTyp(z: Record<string, unknown>): Tuertyp {
  return {
    ...(z as unknown as Tuertyp),
    felder: lies<Record<string, string>>(z.felder_json as string, {}),
    punkte: lies<TypPunkt[]>(z.punkte_json as string, []),
    zusatz: lies<Zusatzfeld[]>(z.zusatz_json as string, []),
    pflicht: lies<string[]>(z.pflicht_json as string, []),
  };
}

export async function tuertypenListe(
  db: D1Database,
  filter: { auch_stillgelegte?: boolean } = {},
): Promise<Tuertyp[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM tuertypen ${filter.auch_stillgelegte ? "" : "WHERE aktiv = 1"}
        ORDER BY name COLLATE NOCASE`,
    )
    .all();
  return (results ?? []).map((z) => alsTyp(z as Record<string, unknown>));
}

export async function tuertypLesen(db: D1Database, id: string): Promise<Tuertyp | null> {
  const z = await db.prepare("SELECT * FROM tuertypen WHERE id = ?").bind(id).first();
  return z ? alsTyp(z as Record<string, unknown>) : null;
}

/** Türtyp über ID oder Name finden — im Diktat wird der Name gesagt, nicht die Kennung. */
export async function tuertypSuchen(db: D1Database, text: string): Promise<Tuertyp | null> {
  const t = text.trim();
  if (!t) return null;
  const direkt = await tuertypLesen(db, t);
  if (direkt) return direkt;
  const z = await db
    .prepare(
      `SELECT * FROM tuertypen WHERE aktiv = 1 AND name = ? COLLATE NOCASE
        UNION ALL
       SELECT * FROM tuertypen WHERE aktiv = 1 AND name LIKE ? COLLATE NOCASE
        LIMIT 1`,
    )
    .bind(t, `%${t}%`)
    .first();
  return z ? alsTyp(z as Record<string, unknown>) : null;
}

export interface TuertypPatch {
  name?: string;
  art?: string;
  beschreibung?: string;
  felder?: Record<string, string>;
  punkte?: TypPunkt[];
  zusatz?: Zusatzfeld[];
  pflicht?: string[];
  aktiv?: number;
}

export async function tuertypAnlegen(
  db: D1Database,
  daten: TuertypPatch & { name: string; art: string; angelegt_von?: string },
): Promise<Tuertyp> {
  const t = jetzt();
  vorlage(daten.art); // wirft, wenn die Vorlage nicht existiert
  const typ: Tuertyp = {
    id: ulid(t),
    name: daten.name.trim(),
    art: daten.art,
    beschreibung: daten.beschreibung ?? "",
    felder: daten.felder ?? {},
    punkte: daten.punkte ?? punkteAusVorlage(daten.art),
    zusatz: daten.zusatz ?? [],
    pflicht: daten.pflicht ?? [],
    aktiv: 1,
    angelegt_von: daten.angelegt_von ?? "",
    angelegt_am: t,
    geaendert_am: t,
  };
  await db
    .prepare(
      `INSERT INTO tuertypen (id, name, art, beschreibung, felder_json, punkte_json, zusatz_json,
         pflicht_json, aktiv, angelegt_von, angelegt_am, geaendert_am)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      typ.id, typ.name, typ.art, typ.beschreibung, JSON.stringify(typ.felder),
      JSON.stringify(typ.punkte), JSON.stringify(typ.zusatz), JSON.stringify(typ.pflicht),
      typ.aktiv, typ.angelegt_von, typ.angelegt_am, typ.geaendert_am,
    )
    .run();
  return typ;
}

export async function tuertypAendern(
  db: D1Database,
  id: string,
  patch: TuertypPatch,
): Promise<Tuertyp | null> {
  const vorher = await tuertypLesen(db, id);
  if (!vorher) return null;
  /* Wechselt die Vorlage, passt die alte Checkliste nicht mehr — dann eine frische. */
  const artNeu = patch.art && patch.art !== vorher.art ? patch.art : null;
  if (artNeu) vorlage(artNeu);

  const saetze: string[] = [];
  const werte: unknown[] = [];
  const setz = (spalte: string, wert: unknown) => {
    saetze.push(`${spalte} = ?`);
    werte.push(wert);
  };
  if (patch.name !== undefined) setz("name", patch.name.trim());
  if (artNeu) setz("art", artNeu);
  if (patch.beschreibung !== undefined) setz("beschreibung", patch.beschreibung);
  if (patch.felder !== undefined) setz("felder_json", JSON.stringify(patch.felder));
  if (patch.zusatz !== undefined) setz("zusatz_json", JSON.stringify(patch.zusatz));
  if (patch.pflicht !== undefined) setz("pflicht_json", JSON.stringify(patch.pflicht));
  if (patch.aktiv !== undefined) setz("aktiv", patch.aktiv);
  if (patch.punkte !== undefined) setz("punkte_json", JSON.stringify(patch.punkte));
  else if (artNeu) setz("punkte_json", JSON.stringify(punkteAusVorlage(artNeu)));

  if (!saetze.length) return vorher;
  setz("geaendert_am", jetzt());
  await db
    .prepare(`UPDATE tuertypen SET ${saetze.join(", ")} WHERE id = ?`)
    .bind(...werte, id)
    .run();
  return tuertypLesen(db, id);
}

/** Die nächste freie Nummer für einen eigenen Punkt. */
export function naechsteEigeneNr(punkte: TypPunkt[]): string {
  const zahlen = punkte
    .filter((p) => p.eigen)
    .map((p) => Number(p.nr))
    .filter((n) => Number.isFinite(n));
  return String(Math.max(EIGEN_AB - 1, ...zahlen) + 1);
}

/**
 * Einen Punkt der Checkliste ändern: Text, Sichtbarkeit — oder einen eigenen anlegen bzw.
 * entfernen. Punkte aus der Vorlage lassen sich nicht löschen, nur ausblenden: ihr Kästchen
 * gibt es im Formular weiterhin, und die Historie soll lesbar bleiben.
 */
export function punkteAnpassen(
  punkte: TypPunkt[],
  aenderungen: { nr?: string; text?: string; aktiv?: boolean; entfernen?: boolean }[],
): TypPunkt[] {
  let liste = punkte.map((p) => ({ ...p }));
  for (const a of aenderungen) {
    if (!a.nr) {
      /* Ohne Nummer ist es ein neuer eigener Punkt. */
      if (!a.text?.trim()) continue;
      liste.push({ nr: naechsteEigeneNr(liste), text: a.text.trim(), aktiv: true, eigen: true });
      continue;
    }
    const treffer = liste.find((p) => p.nr === a.nr);
    if (!treffer) {
      if (a.text?.trim()) {
        liste.push({ nr: a.nr, text: a.text.trim(), aktiv: a.aktiv !== false, eigen: true });
      }
      continue;
    }
    if (a.entfernen) {
      if (treffer.eigen) liste = liste.filter((p) => p.nr !== a.nr);
      else treffer.aktiv = false;
      continue;
    }
    if (a.text !== undefined && a.text.trim()) treffer.text = a.text.trim();
    if (a.aktiv !== undefined) treffer.aktiv = a.aktiv;
  }
  return liste.sort((a, b) => Number(a.nr) - Number(b.nr));
}
