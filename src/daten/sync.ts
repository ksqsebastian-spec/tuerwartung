/**
 * Offline-Abgleich: was am Handy ohne Netz erfasst wurde, kommt hier an.
 *
 * Jede Operation trägt eine vom Client erzeugte `op_id`. Die steht nach der Verarbeitung in
 * `sync_ops`; kommt sie ein zweites Mal, passiert nichts. Das ist die ganze Idempotenz —
 * Wiederholen ist damit harmlos, und der Client darf so oft senden, wie das Netz es zulässt.
 *
 * Konflikte gibt es nur an einer Stelle: zwei Geräte prüfen dasselbe Bauteil in derselben
 * Begehung. Dann gewinnt die **jüngere** Erfassung (`geprueft_am`), die ältere wird verworfen
 * und als `konflikt: "aelter"` quittiert.
 */
import { jetzt } from "./basis";
import { bauteilAnlegen, bauteilPerNr, naechsteNr } from "./bauteile";
import { pruefungErfassen, pruefungZuBauteil } from "./begehungen";
import type { Begehung } from "./begehungen";
import { maengelZuBauteil, mangelSchliessen } from "./maengel";
import type { Objekt } from "./objekte";

export type OpArt = "pruefung" | "bauteil_neu" | "mangel_schliessen";

export interface SyncOp {
  op_id: string;
  art: OpArt;
  payload: Record<string, any>;
  ts?: number;
}

export interface SyncErgebnis {
  op_id: string;
  ok: boolean;
  doppelt?: boolean;
  konflikt?: string;
  zuordnung?: { client_nr: number; server_nr: number };
  fehler?: string;
  bauteil_nr?: number;
}

/** Schon gesehen? Trägt die Operation gleich ein, wenn sie neu ist. */
async function schonGesehen(db: D1Database, opId: string, person: string): Promise<boolean> {
  const vorhanden = await db
    .prepare("SELECT op_id FROM sync_ops WHERE op_id = ?")
    .bind(opId)
    .first();
  if (vorhanden) return true;
  await db
    .prepare("INSERT INTO sync_ops (op_id, person, eingegangen_am) VALUES (?,?,?)")
    .bind(opId, person, jetzt())
    .run();
  return false;
}

export async function opsAnwenden(
  db: D1Database,
  objekt: Objekt,
  begehung: Begehung,
  ops: SyncOp[],
  person: string,
): Promise<SyncErgebnis[]> {
  const out: SyncErgebnis[] = [];
  /* Nummern, die der Server in diesem Lauf umgelegt hat — Folgeoperationen ziehen mit. */
  const umgelegt = new Map<number, number>();

  for (const op of ops) {
    if (!op?.op_id || !op.art) {
      out.push({ op_id: String(op?.op_id ?? ""), ok: false, fehler: "op_id oder art fehlt" });
      continue;
    }
    try {
      if (await schonGesehen(db, op.op_id, person)) {
        out.push({ op_id: op.op_id, ok: true, doppelt: true });
        continue;
      }
      const p = op.payload ?? {};
      const nr = p.nr !== undefined && p.nr !== null ? (umgelegt.get(Number(p.nr)) ?? Number(p.nr)) : undefined;

      if (op.art === "bauteil_neu") {
        const gewuenscht = nr ?? (await naechsteNr(db, objekt.id));
        const belegt = await bauteilPerNr(db, objekt.id, gewuenscht);
        const echte = belegt ? await naechsteNr(db, objekt.id) : gewuenscht;
        const b = await bauteilAnlegen(db, {
          objekt_id: objekt.id,
          art: String(p.art || "wartung_drehfluegel"),
          /* Der Türtyp reist mit: sonst hätte eine offline angelegte Tür keine Checkliste. */
          tuertyp_id: p.tuertyp_id ? String(p.tuertyp_id) : null,
          nr: echte,
          kennung: p.kennung ?? "",
          raumnummer: p.raumnummer ?? "",
          raum: p.raum ?? "",
          flur: p.flur ?? "",
          felder: p.felder ?? {},
          quelle: "rundgang",
        });
        if (nr !== undefined && echte !== nr) umgelegt.set(nr, echte);
        out.push({
          op_id: op.op_id,
          ok: true,
          bauteil_nr: b.nr,
          zuordnung: nr !== undefined && echte !== nr ? { client_nr: nr, server_nr: echte } : undefined,
        });
        continue;
      }

      if (op.art === "pruefung") {
        /* Die jüngere Erfassung gewinnt — sonst überschreibt ein spät eintrudelndes Gerät
           die Korrektur, die jemand danach gemacht hat. */
        const geprueftAm = Number(p.geprueft_am ?? op.ts ?? jetzt());
        const bauteil = nr !== undefined ? await bauteilPerNr(db, objekt.id, nr) : null;
        if (bauteil) {
          const vorhanden = await pruefungZuBauteil(db, begehung.id, bauteil.id);
          if (vorhanden && vorhanden.geprueft_am > geprueftAm) {
            out.push({ op_id: op.op_id, ok: true, konflikt: "aelter", bauteil_nr: bauteil.nr });
            continue;
          }
        }
        const e = await pruefungErfassen(
          db,
          objekt,
          begehung,
          {
            nr,
            art: p.art,
            checks: p.checks,
            ergebnis: p.ergebnis,
            hinweise: p.hinweise,
            felder: p.felder,
            raumnummer: p.raumnummer,
            raum: p.raum,
            flur: p.flur,
            geprueft_am: geprueftAm,
          },
          person,
        );
        if (nr !== undefined && e.bauteil.nr !== nr) umgelegt.set(nr, e.bauteil.nr);
        out.push({
          op_id: op.op_id,
          ok: true,
          bauteil_nr: e.bauteil.nr,
          zuordnung:
            nr !== undefined && e.bauteil.nr !== nr
              ? { client_nr: nr, server_nr: e.bauteil.nr }
              : undefined,
        });
        continue;
      }

      if (op.art === "mangel_schliessen") {
        const bauteil = nr !== undefined ? await bauteilPerNr(db, objekt.id, nr) : null;
        if (!bauteil) {
          out.push({ op_id: op.op_id, ok: false, fehler: `Bauteil ${p.nr} gibt es nicht.` });
          continue;
        }
        for (const m of await maengelZuBauteil(db, bauteil.id, true)) {
          await mangelSchliessen(db, m.id, String(p.freimeldung ?? ""), person);
        }
        out.push({ op_id: op.op_id, ok: true, bauteil_nr: bauteil.nr });
        continue;
      }

      out.push({ op_id: op.op_id, ok: false, fehler: `Unbekannte Art '${op.art}'.` });
    } catch (e) {
      out.push({ op_id: op.op_id, ok: false, fehler: (e as Error).message });
    }
  }
  return out;
}

/** Für den Foto-Upload: dieselbe Idempotenz, aber ohne Operationsliste. */
export async function fotoOpGesehen(
  db: D1Database,
  opId: string,
  person: string,
): Promise<boolean> {
  return schonGesehen(db, opId, person);
}
