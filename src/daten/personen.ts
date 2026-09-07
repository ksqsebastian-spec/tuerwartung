/**
 * Personen: die vier festen Konten mit ihren Vorgaben und ihrer Unterschrift.
 * Unverändert aus Türwerk 1 übernommen, nur um die Rolle ergänzt.
 */
import { jetzt, lies } from "./basis";

export interface Person {
  benutzer: string;
  name: string;
  passwort_hash: string;
  vorgaben: Record<string, string>;
  unterschrift: string | null;
  /** monteur | buero — trägt in v2 nur das Löschrecht an Fotos (Abschnitt 6). */
  rolle: string;
}

function alsPerson(zeile: Record<string, unknown>): Person {
  return {
    ...(zeile as unknown as Person),
    vorgaben: lies<Record<string, string>>(zeile.vorgaben, {}),
    rolle: String(zeile.rolle ?? "monteur"),
  };
}

export async function personLesen(db: D1Database, benutzer: string): Promise<Person | null> {
  const zeile = await db
    .prepare("SELECT * FROM personen WHERE benutzer = ?")
    .bind(benutzer.toLowerCase())
    .first();
  return zeile ? alsPerson(zeile as Record<string, unknown>) : null;
}

export async function personenListe(db: D1Database): Promise<Person[]> {
  const { results } = await db.prepare("SELECT * FROM personen ORDER BY name").all();
  return (results ?? []).map((z) => alsPerson(z as Record<string, unknown>));
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
  patch: {
    vorgaben?: Record<string, string>;
    unterschrift?: string;
    passwort_hash?: string;
    rolle?: string;
  },
): Promise<void> {
  const vorher = await personLesen(db, benutzer);
  await db
    .prepare(
      `INSERT INTO personen (benutzer, name, passwort_hash, vorgaben, unterschrift, zuletzt_gesehen, rolle)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (benutzer) DO UPDATE SET passwort_hash = excluded.passwort_hash,
         vorgaben = excluded.vorgaben, unterschrift = excluded.unterschrift,
         zuletzt_gesehen = excluded.zuletzt_gesehen, rolle = excluded.rolle`,
    )
    .bind(
      benutzer.toLowerCase(),
      vorher?.name ?? benutzer,
      patch.passwort_hash ?? vorher?.passwort_hash ?? "",
      JSON.stringify(patch.vorgaben ?? vorher?.vorgaben ?? {}),
      patch.unterschrift ?? vorher?.unterschrift ?? null,
      jetzt(),
      patch.rolle ?? vorher?.rolle ?? "monteur",
    )
    .run();
}
