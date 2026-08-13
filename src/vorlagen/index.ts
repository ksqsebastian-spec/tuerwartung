/**
 * Die Wartungsvorlagen: je Vorlage ein Formular-PDF, ein Koordinaten-Profil und ein
 * Cheatsheet mit den nummerierten Prüfpunkten.
 *
 * Profile, Cheatsheets und Formular-PDFs stammen unverändert aus dem Skill `tuerenwartung-diktat`
 * und werden mit einkompiliert. Auch die PDFs: rund 600 KB, dafür ist ein Deployment vollständig
 * und es gibt keinen Zustand, der beim Aufsetzen vergessen werden kann.
 *
 * Aus dem Cheatsheet wird die Punkteliste gelesen (Tabellenzeilen `| 7 | Text |`), damit
 * Nummer und Klartext an genau einer Stelle gepflegt werden: der Monteur diktiert „Punkt 7",
 * die Website zeigt „7 — Kontrolle auf Verschmutzungen", das PDF kreuzt die richtige Zeile an.
 */
import drehfluegelProfil from "./wartung_drehfluegel.json";
import fensterProfil from "./wartung_fenster.json";
import feststellProfil from "./wartung_feststellanlagen.json";
import drehfluegelBlatt from "./wartung_drehfluegel_cheatsheet.md";
import fensterBlatt from "./wartung_fenster_cheatsheet.md";
import feststellBlatt from "./wartung_feststellanlagen_cheatsheet.md";
import drehfluegelPdf from "./wartung_drehfluegel.pdf";
import fensterPdf from "./wartung_fenster.pdf";
import feststellPdf from "./wartung_feststellanlagen.pdf";

/** Bewertung einer Prüfzeile. Leer = In Ordnung. */
export type Bewertung = "io" | "nio" | "nz" | "sb" | "none";

export const BEWERTUNGEN: Record<Bewertung, string> = {
  io: "In Ordnung",
  nio: "Nicht in Ordnung",
  nz: "Nicht zutreffend",
  sb: "Siehe Bemerkung",
  none: "kein Kreuz",
};

export interface Profil {
  page: [number, number];
  font?: string;
  font_size?: number;
  /** Feldname → [x, Abstand-von-oben, "c" für zentriert]. */
  fields: Record<string, [number, number] | [number, number, string]>;
  /** Feldname → [x, Abstand-von-oben, Zeichen pro Zeile] für umbrechenden Fließtext. */
  boxes?: Record<string, [number, number, number]>;
  signature?: { x: number; top: number; w: number; h: number };
  check_columns: Record<string, Partial<Record<Bewertung, number>>>;
  check_rows: Record<string, [string, number]>;
  /** Punkt-Nummer → Zeilenschlüssel in check_rows. */
  points: Record<string, string>;
  checks_default_column?: Bewertung;
}

export interface Pruefpunkt {
  nr: string;
  text: string;
}

export interface Vorlage {
  id: string;
  label: string;
  profil: Profil;
  /** Cheatsheet im Original — geht so an Claude raus. */
  blatt: string;
  punkte: Pruefpunkt[];
  /** Das Formular-PDF, base64 einkompiliert. */
  pdfBase64: string;
  /** Felder, die je Tür abweichen dürfen (alles andere ist Stammdatum der Wartung). */
  tuerfelder: string[];
}

/**
 * Stammdaten der Wartung — einmal je Termin, nie je Tür. Steht als Spalte in `wartungen`.
 * ERGEBNIS und HINWEISE sind bewusst nicht dabei: die gehören zur einzelnen Tür.
 */
export const STAMMFELDER = [
  "IDENT",
  "BETREIBER",
  "OBJEKT",
  "TUERTYP",
  "PRUEFER",
  "BEFAEHIGUNG",
  "DATUM",
  "ORT",
  "RECHTSGRUNDLAGEN",
  "LETZTE_PRUEFUNG",
  "NAECHSTE_PRUEFUNG",
  "BETEILIGTE",
] as const;

/**
 * Zeilen der Cheatsheet-Tabelle: `| 7 | Kontrolle auf Verschmutzungen |`.
 * Die Hervorhebungssternchen des Markdowns fliegen raus — auf der Website steht Text,
 * kein Markup.
 */
function punkteAusBlatt(md: string): Pruefpunkt[] {
  const punkte: Pruefpunkt[] = [];
  for (const zeile of md.split("\n")) {
    const treffer = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*$/.exec(zeile.trim());
    if (treffer) {
      punkte.push({ nr: treffer[1], text: treffer[2].replace(/\*+/g, "").trim() });
    }
  }
  return punkte;
}

function bauen(
  id: string,
  label: string,
  profil: unknown,
  blatt: string,
  pdfBase64: string,
  eigene: string[],
): Vorlage {
  const p = profil as Profil;
  const stamm = new Set<string>(STAMMFELDER);
  return {
    id,
    label,
    profil: p,
    blatt,
    punkte: punkteAusBlatt(blatt),
    pdfBase64,
    tuerfelder: [
      ...eigene.filter((f) => !stamm.has(f) && f in p.fields),
      ...Object.keys(p.fields).filter((f) => !stamm.has(f) && !eigene.includes(f)),
    ].filter((f) => f !== "ERGEBNIS"),
  };
}

/* Reihenfolge der Türfelder = Reihenfolge im Formular; was hier nicht steht, hängt hinten dran. */
export const VORLAGEN: Record<string, Vorlage> = {
  wartung_drehfluegel: bauen(
    "wartung_drehfluegel",
    "Drehflügeltüren",
    drehfluegelProfil,
    drehfluegelBlatt,
    drehfluegelPdf,
    ["ETAGE", "RAUM", "HERSTELLER", "ABSENKDICHTUNG", "OTS", "SPION", "ZULASSUNG"],
  ),
  wartung_fenster: bauen("wartung_fenster", "Fenster", fensterProfil, fensterBlatt, fensterPdf, [
    "ETAGE",
    "RAUM",
    "FLUR",
    "RAUMBEZ",
    "FENSTERTYP",
    "HERSTELLER",
    "FABRIK_BESCHLAEGE",
  ]),
  wartung_feststellanlagen: bauen(
    "wartung_feststellanlagen",
    "Feststellanlagen",
    feststellProfil,
    feststellBlatt,
    feststellPdf,
    ["ETAGE", "RAUM", "FLUR", "RAUMBEZ", "HERSTELLER", "ABSENKDICHTUNG", "OTS", "SPION", "ZULASSUNG"],
  ),
};

export const VORLAGEN_IDS = Object.keys(VORLAGEN);

export function vorlage(id: string): Vorlage {
  const v = VORLAGEN[id];
  if (!v) {
    throw new Error(`Unbekannte Vorlage '${id}'. Möglich: ${VORLAGEN_IDS.join(", ")}.`);
  }
  return v;
}

/* Base64 einmal beim Kaltstart auspacken, danach aus dem Speicher bedienen. */
const PDF_CACHE = new Map<string, Uint8Array>();

export function vorlagePdf(id: string): Uint8Array {
  let bytes = PDF_CACHE.get(id);
  if (!bytes) {
    const bin = atob(vorlage(id).pdfBase64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    PDF_CACHE.set(id, bytes);
  }
  return bytes;
}
