/**
 * Laufreihenfolge — in welcher Folge die Bauteile eines Objekts abgegangen werden.
 *
 * Eigenes Modul, weil dieselbe Funktion an zwei Stellen dasselbe Ergebnis liefern muss:
 * im Worker (Tools, Seiten, Sammelbericht) und später im Rundgang-Client am Handy. Deshalb
 * keine Abhängigkeit auf Datenbank oder Umgebung — rein rechnend, mit den Feldern, die ein
 * Bauteil ohnehin trägt.
 *
 * Regel (Abschnitt 7.9 der Spezifikation):
 *   1. nach Geschoss-Reihenfolge; Bauteile ohne Geschoss zuletzt,
 *   2. haben ≥ 70 % eine Raumnummer → natürliche Sortierung der Raumnummer,
 *   3. sonst, wenn ≥ 70 % eine Position haben → Nächster-Nachbar ab Startpunkt + 2-opt,
 *   4. sonst nach `nr`.
 */

export interface ReihenBauteil {
  id: string;
  nr: number;
  geschoss_id: string | null;
  raumnummer: string;
  x: number | null;
  y: number | null;
}

export interface ReihenGeschoss {
  id: string;
  reihenfolge: number;
  start_x?: number | null;
  start_y?: number | null;
  /** Pixelmaße des Plans — nur zum Ausgleich des Seitenverhältnisses. */
  plan_breite?: number | null;
  plan_hoehe?: number | null;
}

/**
 * Natürliche Sortierung: Ziffernblöcke numerisch, Rest als Text. „2.14a" kommt nach „2.14",
 * „2.9" vor „2.10". Genau das, was ein Mensch beim Ablaufen erwartet.
 */
export function natuerlichVergleich(a: string, b: string): number {
  const teile = (s: string) => s.match(/\d+|\D+/g) ?? [];
  const ta = teile(a.trim().toLowerCase());
  const tb = teile(b.trim().toLowerCase());
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d/.test(x);
    const yn = /^\d/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function anteil(liste: unknown[], trifft: (w: any) => boolean): number {
  return liste.length ? liste.filter(trifft).length / liste.length : 0;
}

/** Nächster-Nachbar ab Startpunkt, danach eine 2-opt-Runde. */
function wegSortieren<T extends ReihenBauteil>(
  mitPosition: T[],
  start: { x: number; y: number } | null,
  seitenverhaeltnis: number,
): T[] {
  const punkt = (b: T) => ({ x: (b.x ?? 0) * seitenverhaeltnis, y: b.y ?? 0 });
  const abstand = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.hypot(p.x - q.x, p.y - q.y);

  const offen = [...mitPosition];
  let hier =
    start !== null
      ? { x: start.x * seitenverhaeltnis, y: start.y }
      : /* ohne Startpunkt: das oberste Bauteil, bei Gleichstand das linkeste */
        punkt(
          offen.reduce((best, b) =>
            (b.y ?? 0) < (best.y ?? 0) || ((b.y ?? 0) === (best.y ?? 0) && (b.x ?? 0) < (best.x ?? 0))
              ? b
              : best,
          ),
        );

  const weg: T[] = [];
  while (offen.length) {
    let besterIndex = 0;
    let beste = Infinity;
    for (let i = 0; i < offen.length; i++) {
      const d = abstand(hier, punkt(offen[i]));
      if (d < beste) {
        beste = d;
        besterIndex = i;
      }
    }
    const naechstes = offen.splice(besterIndex, 1)[0];
    weg.push(naechstes);
    hier = punkt(naechstes);
  }

  /* 2-opt: Kreuzungen auflösen, höchstens 200 Tauschversuche — mehr lohnt bei 30 Türen nicht. */
  let versuche = 0;
  let verbessert = true;
  while (verbessert && versuche < 200) {
    verbessert = false;
    for (let i = 0; i < weg.length - 2 && versuche < 200; i++) {
      for (let k = i + 2; k < weg.length && versuche < 200; k++) {
        versuche++;
        const a = punkt(weg[i]);
        const b = punkt(weg[i + 1]);
        const c = punkt(weg[k]);
        const d = k + 1 < weg.length ? punkt(weg[k + 1]) : null;
        const vorher = abstand(a, b) + (d ? abstand(c, d) : 0);
        const nachher = abstand(a, c) + (d ? abstand(b, d) : 0);
        if (nachher + 1e-9 < vorher) {
          const stueck = weg.slice(i + 1, k + 1).reverse();
          weg.splice(i + 1, stueck.length, ...stueck);
          verbessert = true;
        }
      }
    }
  }
  return weg;
}

/** Die Bauteile eines Objekts in Laufreihenfolge. Verändert die übergebene Liste nicht. */
export function laufreihenfolge<T extends ReihenBauteil>(
  bauteile: T[],
  geschosse: ReihenGeschoss[],
): T[] {
  const nachGeschoss = new Map<string, ReihenGeschoss>();
  for (const g of geschosse) nachGeschoss.set(g.id, g);

  /* Gruppieren; Bauteile ohne Geschoss bilden eine eigene Gruppe und kommen zuletzt. */
  const gruppen = new Map<string, T[]>();
  for (const b of bauteile) {
    const schluessel = b.geschoss_id ?? "";
    const liste = gruppen.get(schluessel);
    if (liste) liste.push(b);
    else gruppen.set(schluessel, [b]);
  }

  const rang = (schluessel: string) =>
    schluessel === "" ? Number.MAX_SAFE_INTEGER : (nachGeschoss.get(schluessel)?.reihenfolge ?? 0);

  const schluessel = [...gruppen.keys()].sort((a, b) => {
    const d = rang(a) - rang(b);
    return d !== 0 ? d : a < b ? -1 : 1;
  });

  const out: T[] = [];
  for (const s of schluessel) {
    const gruppe = gruppen.get(s)!;
    const g = nachGeschoss.get(s);

    if (anteil(gruppe, (b) => String(b.raumnummer ?? "").trim() !== "") >= 0.7) {
      const mit = gruppe.filter((b) => String(b.raumnummer ?? "").trim() !== "");
      const ohne = gruppe.filter((b) => String(b.raumnummer ?? "").trim() === "");
      mit.sort((a, b) => natuerlichVergleich(a.raumnummer, b.raumnummer) || a.nr - b.nr);
      ohne.sort((a, b) => a.nr - b.nr);
      out.push(...mit, ...ohne);
      continue;
    }

    if (anteil(gruppe, (b) => b.x !== null && b.y !== null) >= 0.7) {
      const mit = gruppe.filter((b) => b.x !== null && b.y !== null);
      const ohne = gruppe.filter((b) => b.x === null || b.y === null);
      const verhaeltnis =
        g?.plan_breite && g?.plan_hoehe ? g.plan_breite / g.plan_hoehe : 1;
      const start =
        g && g.start_x !== null && g.start_x !== undefined && g.start_y !== null && g.start_y !== undefined
          ? { x: g.start_x, y: g.start_y }
          : null;
      ohne.sort((a, b) => a.nr - b.nr);
      out.push(...wegSortieren(mit, start, verhaeltnis), ...ohne);
      continue;
    }

    out.push(...[...gruppe].sort((a, b) => a.nr - b.nr));
  }
  return out;
}
