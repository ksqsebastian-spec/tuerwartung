/**
 * Berichte erzeugen: aus den erfassten Türen einer Wartung werden ausgefüllte PDFs in R2.
 *
 * Der Lauf ist absichtlich stückweise. Ein Worker hat begrenzte CPU-Zeit, eine Wartung kann
 * dreißig Türen haben — also wird bis zu einem Zeitbudget gearbeitet und zurückgemeldet, wie
 * viele noch offen sind. Aufrufer (Website wie MCP-Tool) rufen einfach erneut auf. Weil jede
 * fertige Tür sofort auf `generiert` steht, wiederholt sich keine Arbeit.
 */
import type { Env } from "../env";
import { Fueller } from "./fuellen";
import { zipBauen } from "./zip";
import { vorlage, vorlagePdf } from "../vorlagen";
import {
  berichtName,
  datensatz,
  personLesen,
  tuerBerichtGesetzt,
  tuerenLesen,
  wartungLesen,
} from "../daten/wartungen";
import type { Tuer, Wartung } from "../daten/wartungen";

export interface Lauf {
  wartung: string;
  erzeugt: number;
  offen: number;
  fertig: boolean;
  berichte: { nr: number; name: string; schluessel: string }[];
  fehler: { nr: number; grund: string }[];
}

/** R2-Schlüssel eines Berichts. */
export function berichtSchluessel(wartungId: string, name: string): string {
  return `berichte/${wartungId}/${name}.pdf`;
}

/**
 * Erzeugt die noch offenen Berichte einer Wartung.
 * `zeitbudgetMs` begrenzt einen Durchlauf; `alle` erzeugt auch schon fertige neu.
 */
export async function berichteErzeugen(
  env: Env,
  wartungId: string,
  optionen: { zeitbudgetMs?: number; alle?: boolean } = {},
): Promise<Lauf> {
  const w = await wartungLesen(env.DB, wartungId);
  if (!w) throw new Error(`Wartung '${wartungId}' gibt es nicht.`);

  const alleTueren = await tuerenLesen(env.DB, wartungId);
  if (!alleTueren.length) throw new Error(`Wartung '${wartungId}' hat noch keine Türen.`);

  const offene = optionen.alle ? alleTueren : alleTueren.filter((t) => t.status !== "generiert");
  const lauf: Lauf = {
    wartung: wartungId,
    erzeugt: 0,
    offen: offene.length,
    fertig: offene.length === 0,
    berichte: [],
    fehler: [],
  };
  if (!offene.length) return lauf;

  const v = vorlage(w.vorlage);
  const unterschrift = await unterschriftLaden(env, w);
  const fueller = await Fueller.laden(vorlagePdf(v.id), v.profil, unterschrift);
  const budget = optionen.zeitbudgetMs ?? 20_000;
  const start = Date.now();

  for (const t of offene) {
    if (lauf.erzeugt > 0 && Date.now() - start > budget) break;
    try {
      const name = berichtName(w, t);
      const bytes = await fueller.erzeugen({ felder: datensatz(w, t), checks: t.checks });
      const schluessel = berichtSchluessel(wartungId, name);
      await env.R2.put(schluessel, bytes, {
        httpMetadata: { contentType: "application/pdf" },
      });
      await tuerBerichtGesetzt(env.DB, wartungId, t.nr, schluessel);
      lauf.erzeugt++;
      lauf.berichte.push({ nr: t.nr, name: `${name}.pdf`, schluessel });
    } catch (e) {
      lauf.fehler.push({ nr: t.nr, grund: (e as Error).message });
    }
  }

  const rest = await tuerenLesen(env.DB, wartungId);
  lauf.offen = rest.filter((t) => t.status !== "generiert").length;
  lauf.fertig = lauf.offen === 0;
  if (lauf.fertig && !lauf.fehler.length) {
    await env.DB.prepare("UPDATE wartungen SET status = 'generiert', geaendert_am = ? WHERE id = ?")
      .bind(Date.now(), wartungId)
      .run();
  }
  return lauf;
}

/** Unterschrift der Person, die die Wartung angelegt hat. Fehlt sie, bleibt das Feld leer. */
async function unterschriftLaden(env: Env, w: Wartung): Promise<ArrayBuffer | null> {
  if (!w.angelegt_von) return null;
  const person = await personLesen(env.DB, w.angelegt_von);
  if (!person?.unterschrift) return null;
  const obj = await env.R2.get(person.unterschrift);
  return obj ? obj.arrayBuffer() : null;
}

/** Alle fertigen Berichte einer Wartung als ZIP. */
export async function berichtePaket(
  env: Env,
  wartungId: string,
): Promise<{ name: string; daten: Uint8Array }> {
  const tueren = await tuerenLesen(env.DB, wartungId);
  const fertige = tueren.filter((t) => t.pdf_schluessel);
  if (!fertige.length) throw new Error("Für diese Wartung gibt es noch keine Berichte.");

  const eintraege = [];
  for (const t of fertige) {
    const obj = await env.R2.get(t.pdf_schluessel!);
    if (!obj) continue;
    eintraege.push({
      name: t.pdf_schluessel!.split("/").pop()!,
      daten: new Uint8Array(await obj.arrayBuffer()),
    });
  }
  return { name: `${wartungId}.zip`, daten: zipBauen(eintraege) };
}

/** Berichtsliste einer Wartung — für Website und Tools dieselbe Sicht. */
export function berichtsListe(tueren: Tuer[]) {
  return tueren
    .filter((t) => t.pdf_schluessel)
    .map((t) => ({
      nr: t.nr,
      datei: t.pdf_schluessel!.split("/").pop()!,
      schluessel: t.pdf_schluessel!,
      erzeugt_am: t.erzeugt_am,
    }));
}
