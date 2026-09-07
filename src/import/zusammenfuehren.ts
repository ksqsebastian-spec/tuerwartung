/**
 * Türliste und Plan zusammenführen (Abschnitt 7.7).
 *
 * Die Liste weiß, was für eine Tür es ist — Feuerwiderstand, Hersteller, Raumnummer. Der Plan
 * weiß, wo sie hängt. Zusammen ergibt das ein vollständiges Bauteil; getrennt bleiben beide
 * halb. Zusammengeführt wird nur, wo die Zuordnung eindeutig ist:
 *
 *   1. gleiche Kennung (normalisiert) — sicher, Konfidenz 1.0,
 *   2. sonst gleiche Raumnummer, und in diesem Raum steht auf jeder Seite genau eine Tür —
 *      wahrscheinlich, Konfidenz 0.8,
 *   3. der Rest bleibt getrennt: Listenzeilen ohne Position, Plankandidaten ohne Listenzeile.
 *
 * Geraten wird nicht. Eine falsch verheiratete Tür fällt später niemandem auf und steht dann
 * jahrelang mit der falschen Zulassung im Protokoll.
 */
import { kennungNormal } from "../daten/bauteile";
import type { Vorschlag } from "../daten/importe";

export interface Paar {
  liste: Vorschlag;
  plan: Vorschlag;
  grund: "kennung" | "raumnummer";
}

export interface Zusammenfuehrung {
  paare: Paar[];
  nur_liste: Vorschlag[];
  nur_plan: Vorschlag[];
}

function raumSchluessel(v: Vorschlag): string {
  return v.raumnummer.trim().toUpperCase();
}

export function zusammenfuehren(liste: Vorschlag[], plan: Vorschlag[]): Zusammenfuehrung {
  const paare: Paar[] = [];
  const vergebenListe = new Set<string>();
  const vergebenPlan = new Set<string>();

  /* 1. Kennung — der sichere Weg. */
  const planNachKennung = new Map<string, Vorschlag[]>();
  for (const p of plan) {
    const k = kennungNormal(p.kennung);
    if (!k) continue;
    const bisher = planNachKennung.get(k);
    if (bisher) bisher.push(p);
    else planNachKennung.set(k, [p]);
  }
  for (const l of liste) {
    const k = kennungNormal(l.kennung);
    if (!k) continue;
    const treffer = (planNachKennung.get(k) ?? []).filter((p) => !vergebenPlan.has(p.id));
    if (treffer.length === 1) {
      paare.push({ liste: l, plan: treffer[0], grund: "kennung" });
      vergebenListe.add(l.id);
      vergebenPlan.add(treffer[0].id);
    }
  }

  /* 2. Raumnummer — nur wenn auf beiden Seiten genau eine Tür in diesem Raum übrig ist. */
  const zaehleListe = new Map<string, Vorschlag[]>();
  const zaehlePlan = new Map<string, Vorschlag[]>();
  const einsortieren = (ziel: Map<string, Vorschlag[]>, v: Vorschlag) => {
    const s = raumSchluessel(v);
    if (!s) return;
    const bisher = ziel.get(s);
    if (bisher) bisher.push(v);
    else ziel.set(s, [v]);
  };
  for (const l of liste) if (!vergebenListe.has(l.id)) einsortieren(zaehleListe, l);
  for (const p of plan) if (!vergebenPlan.has(p.id)) einsortieren(zaehlePlan, p);
  for (const [raum, ls] of zaehleListe) {
    const ps = zaehlePlan.get(raum) ?? [];
    if (ls.length === 1 && ps.length === 1) {
      paare.push({ liste: ls[0], plan: ps[0], grund: "raumnummer" });
      vergebenListe.add(ls[0].id);
      vergebenPlan.add(ps[0].id);
    }
  }

  return {
    paare,
    nur_liste: liste.filter((l) => !vergebenListe.has(l.id)),
    nur_plan: plan.filter((p) => !vergebenPlan.has(p.id)),
  };
}

/**
 * Was aus einem Paar wird: die Position vom Plan, die Felder von der Liste, und die
 * Wartungspflicht, sobald eine der beiden Seiten sie behauptet.
 */
export function verschmelzen(paar: Paar): Partial<Vorschlag> {
  const { liste, plan } = paar;
  return {
    x: plan.x,
    y: plan.y,
    richtung_grad: plan.richtung_grad ?? liste.richtung_grad,
    breite_m: liste.breite_m ?? plan.breite_m,
    kennung: liste.kennung || plan.kennung,
    raumnummer: liste.raumnummer || plan.raumnummer,
    raum: liste.raum || plan.raum,
    art: liste.art !== "wartung_drehfluegel" ? liste.art : plan.art,
    felder: { ...plan.felder, ...liste.felder },
    wartungspflichtig: liste.wartungspflichtig || plan.wartungspflichtig ? 1 : 0,
    konfidenz: paar.grund === "kennung" ? 1 : 0.8,
    herkunft: "zusammengefuehrt",
    text_nahe: [...plan.text_nahe, ...liste.text_nahe],
  };
}
