/**
 * Der Vorrat: die Türtypen, die es in jedem zweiten Objekt gibt.
 *
 * Ohne ihn steht am Anfang eine leere Stammdatenseite, und die erste Tür scheitert an einer
 * Frage, die niemand stellen wollte: „wie heißt der Typ?". Also liegen die gängigen schon bereit
 * — sichtbar, aber noch nicht in der Datenbank. Wer einen benutzt, legt ihn damit an; wer ihn nie
 * benutzt, sieht ihn nur in einer Liste stehen. So ist nichts einzurichten und nichts aufzuräumen.
 *
 * Die Namen stammen aus den Türen- und Fensterlisten echter Bauvorhaben, nicht aus einem
 * Katalog. Sie sind ein Anfang und kein Gesetz: umbenennen, ergänzen und löschen geht in den
 * Stammdaten.
 *
 * **Pflichtfeld IDENT nur, wo es ein Schild gibt.** Eine Brandschutztür trägt ihr
 * Kennzeichnungsschild mit Ident-Nummer, eine gewöhnliche Zimmertür nicht. Stünde IDENT überall,
 * käme der Monteur an der ersten Bürotür nicht weiter — das ist genau die Sackgasse, die dieser
 * Vorrat verhindern soll.
 */

export interface VorratsTyp {
  name: string;
  art: string;
  beschreibung: string;
  pflicht: string[];
  /** Was an diesem Typ von Haus aus feststeht — der Rest kommt vom Betrieb. */
  felder?: Record<string, string>;
}

export const TYPEN_VORRAT: VorratsTyp[] = [
  /* ── Drehflügeltüren ─────────────────────────────────────────────────────── */
  {
    name: "T30 Brandschutztür",
    art: "wartung_drehfluegel",
    beschreibung: "Feuerhemmend, 30 Minuten. Trägt ein Kennzeichnungsschild mit Ident-Nummer.",
    pflicht: ["IDENT"],
    felder: { TUERTYP: "T30" },
  },
  {
    name: "T30-RS Brand- und Rauchschutztür",
    art: "wartung_drehfluegel",
    beschreibung: "Feuerhemmend und rauchdicht — der häufigste Typ in Flur und Treppenhaus.",
    pflicht: ["IDENT"],
    felder: { TUERTYP: "T30-RS" },
  },
  {
    name: "T90 Brandschutztür",
    art: "wartung_drehfluegel",
    beschreibung: "Feuerbeständig, 90 Minuten. Meist Keller, Technik, Heizraum.",
    pflicht: ["IDENT"],
    felder: { TUERTYP: "T90" },
  },
  {
    name: "RS Rauchschutztür",
    art: "wartung_drehfluegel",
    beschreibung: "Rauchdicht ohne Feuerwiderstand, nach DIN 18095.",
    pflicht: ["IDENT"],
    felder: { TUERTYP: "RS" },
  },
  {
    name: "Alu-Rohrrahmentür",
    art: "wartung_drehfluegel",
    beschreibung: "Verglaste Rohrrahmentür, ohne Brandschutzanforderung.",
    pflicht: [],
    felder: { TUERTYP: "Alu-Rohrrahmen" },
  },
  {
    name: "Alu-Rohrrahmentür T30-RS",
    art: "wartung_drehfluegel",
    beschreibung: "Verglaste Rohrrahmentür mit Feuer- und Rauchschutz.",
    pflicht: ["IDENT"],
    felder: { TUERTYP: "Alu-Rohrrahmen T30-RS" },
  },
  {
    name: "Vollspantür",
    art: "wartung_drehfluegel",
    beschreibung: "Gewöhnliche Innentür ohne Brandschutz — Büro, Gruppenraum, Abstellraum.",
    pflicht: [],
    felder: { TUERTYP: "Vollspan" },
  },
  {
    name: "Stahlblechtür",
    art: "wartung_drehfluegel",
    beschreibung: "Stahlzarge mit Stahlblatt, meist Technik- und Lagerräume.",
    pflicht: [],
    felder: { TUERTYP: "Stahlblech" },
  },
  {
    name: "Festverglasung",
    art: "wartung_drehfluegel",
    beschreibung: "Nebenelement neben oder über einer Tür — kein Flügel, aber im Bestand.",
    pflicht: [],
    felder: { TUERTYP: "Festverglasung" },
  },

  /* ── Feststellanlagen ────────────────────────────────────────────────────── */
  {
    name: "Feststellanlage mit Haftmagnet",
    art: "wartung_feststellanlagen",
    beschreibung: "Hält die Tür offen und löst im Brandfall aus. Jährlich prüfpflichtig.",
    pflicht: ["IDENT"],
  },
  {
    name: "Feststellanlage mit Rauchschalter",
    art: "wartung_feststellanlagen",
    beschreibung: "Feststellanlage mit eigenem Rauchmelder in der Anlage.",
    pflicht: ["IDENT"],
  },

  /* ── Fenster ─────────────────────────────────────────────────────────────── */
  {
    name: "Kunststofffenster DK",
    art: "wartung_fenster",
    beschreibung: "Dreh-Kipp-Fenster aus Kunststoff — der Regelfall im Wohnungsbau.",
    pflicht: [],
    felder: { FENSTERTYP: "DK" },
  },
  {
    name: "Kunststofffenster DK mit Oberlicht",
    art: "wartung_fenster",
    beschreibung: "Dreh-Kipp mit Oberlicht, oft elektrisch betrieben.",
    pflicht: [],
    felder: { FENSTERTYP: "DK/OL" },
  },
  {
    name: "Holzfenster DK",
    art: "wartung_fenster",
    beschreibung: "Dreh-Kipp-Fenster aus Holz.",
    pflicht: [],
    felder: { FENSTERTYP: "DK" },
  },
  {
    name: "Holz-Alu-Fenster DK",
    art: "wartung_fenster",
    beschreibung: "Holz innen, Aluschale außen.",
    pflicht: [],
    felder: { FENSTERTYP: "DK" },
  },
  {
    name: "Alufenster DK",
    art: "wartung_fenster",
    beschreibung: "Dreh-Kipp-Fenster aus Aluminium.",
    pflicht: [],
    felder: { FENSTERTYP: "DK" },
  },
];

/** Einen Vorratstyp über seinen Namen finden — genau, aber ohne Rücksicht auf Groß und Klein. */
export function vorratsTyp(name: string): VorratsTyp | null {
  const n = name.trim().toLowerCase();
  return TYPEN_VORRAT.find((t) => t.name.toLowerCase() === n) ?? null;
}
