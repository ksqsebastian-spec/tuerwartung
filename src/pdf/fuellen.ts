/**
 * Formular-PDF per Overlay befüllen — die Übersetzung von `scripts/fill_pdf_overlay.py`
 * nach pdf-lib, damit das Erzeugen im Worker läuft statt auf einem Rechner mit Python.
 *
 * Die Koordinaten-Profile sind unverändert übernommen: `top` ist der Abstand von oben,
 * die Grundlinie rechnet diese Datei aus — genauso wie das Python-Skript es tat. Ein Profil,
 * das dort funktioniert hat, funktioniert hier.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import type { Bewertung, Profil } from "../vorlagen";

/**
 * Die Standardschriften eines PDFs können nur WinAnsi. Diktiertes Deutsch bringt aber
 * typografische Anführungszeichen und Gedankenstriche mit; die würden pdf-lib zum Werfen
 * bringen und den ganzen Bericht kosten. Also vorher entschärfen — Umlaute bleiben, sie
 * sind in WinAnsi enthalten.
 */
const ERSATZ: Record<string, string> = {
  "\u201e": '"', "\u201c": '"', "\u201d": '"',      // „ “ ”
  "\u201a": "'", "\u2018": "'", "\u2019": "'",      // ‚ ‘ ’
  "\u2013": "-", "\u2014": "-", "\u2212": "-",      // – — −
  "\u2026": "...", "\u2022": "-",                  // … •
  "\u00a0": " ", "\u202f": " ", "\u2009": " ",      // geschützte und schmale Leerzeichen
  "\u00ad": "", "\u200b": "",                      // weiches Trennzeichen, Nullbreite
  "\t": " ", "\n": " ", "\r": " ",
};

export function winAnsiSicher(text: string): string {
  let out = "";
  for (const zeichen of String(text)) {
    const ersatz = ERSATZ[zeichen];
    if (ersatz !== undefined) {
      out += ersatz;
      continue;
    }
    const code = zeichen.codePointAt(0)!;
    // Alles jenseits von Latin-1 fliegt raus, statt das PDF scheitern zu lassen.
    out += code <= 0xff || code === 0x20ac ? zeichen : "?";
  }
  // Steuerzeichen haben in einem Formularfeld nichts verloren.
  return out.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function umbrechen(text: string, zeichenProZeile: number): string[] {
  const worte = String(text).split(/\s+/).filter(Boolean);
  const zeilen: string[] = [];
  let aktuell = "";
  for (const wort of worte) {
    if (aktuell.length + wort.length + 1 <= zeichenProZeile) {
      aktuell = (aktuell + " " + wort).trim();
    } else {
      if (aktuell) zeilen.push(aktuell);
      aktuell = wort;
    }
  }
  if (aktuell) zeilen.push(aktuell);
  return zeilen;
}

export interface Bericht {
  /** Flache Feldwerte, Schlüssel wie im Profil (IDENT, OBJEKT, ERGEBNIS …). */
  felder: Record<string, string>;
  /** Punkt-Nummer oder Zeilenschlüssel → Bewertung. Leer = alles In Ordnung. */
  checks: Record<string, Bewertung | Bewertung[]>;
}

/**
 * Hält die geladene Vorlage und die Unterschrift, damit eine Serie von Türen die Vorlage
 * nur einmal parst. `erzeugen` liefert je Aufruf ein fertiges, einseitiges PDF.
 */
export class Fueller {
  private constructor(
    private readonly vorlage: PDFDocument,
    private readonly profil: Profil,
    private readonly unterschrift: Uint8Array | null,
  ) {}

  static async laden(
    vorlageBytes: ArrayBuffer | Uint8Array,
    profil: Profil,
    unterschrift?: ArrayBuffer | Uint8Array | null,
  ): Promise<Fueller> {
    const doc = await PDFDocument.load(vorlageBytes);
    const sig = unterschrift ? new Uint8Array(unterschrift as ArrayBuffer) : null;
    return new Fueller(doc, profil, sig);
  }

  async erzeugen(bericht: Bericht): Promise<Uint8Array> {
    const p = this.profil;
    const [, H] = p.page;
    const groesse = p.font_size ?? 9;

    const doc = await PDFDocument.create();
    const [seite] = await doc.copyPages(this.vorlage, [0]);
    doc.addPage(seite);

    const normal = await doc.embedFont(StandardFonts.Helvetica);
    const fett = await doc.embedFont(StandardFonts.HelveticaBold);
    const schwarz = rgb(0, 0, 0);

    const schreiben = (
      text: string,
      x: number,
      y: number,
      font: PDFFont,
      size: number,
      zentriert = false,
    ) => {
      const sicher = winAnsiSicher(text);
      if (!sicher) return;
      const links = zentriert ? x - font.widthOfTextAtSize(sicher, size) / 2 : x;
      (seite as PDFPage).drawText(sicher, { x: links, y, size, font, color: schwarz });
    };

    /* Einzeilige Felder. */
    for (const [name, koordinaten] of Object.entries(p.fields)) {
      const wert = bericht.felder[name];
      if (!wert) continue;
      const [x, top, ausrichtung] = koordinaten as [number, number, string?];
      schreiben(String(wert), x, H - (top + 8), normal, groesse, ausrichtung === "c");
    }

    /* Fließtext mit Umbruch. */
    for (const [name, [x, top, breite]] of Object.entries(p.boxes ?? {})) {
      const wert = bericht.felder[name];
      if (!wert) continue;
      umbrechen(String(wert), breite).forEach((zeile, i) => {
        schreiben(zeile, x, H - (top + 8) - i * 11, normal, groesse);
      });
    }

    /* Ankreuzfelder: erst alles auf den Standard, dann die genannten Abweichungen. */
    const standard = (p.checks_default_column ?? "io") as Bewertung;
    const gewaehlt: Record<string, Bewertung | Bewertung[]> = {};
    for (const zeile of Object.keys(p.check_rows)) gewaehlt[zeile] = standard;
    for (const [schluessel, spalte] of Object.entries(bericht.checks ?? {})) {
      const zeile = p.points[String(schluessel)] ?? schluessel;
      gewaehlt[zeile] = spalte;
    }

    for (const [zeile, spalte] of Object.entries(gewaehlt)) {
      const treffer = p.check_rows[zeile];
      if (!treffer) continue;
      const [block, top] = treffer;
      for (const s of Array.isArray(spalte) ? spalte : [spalte]) {
        if (!s || s === "none") continue;
        const x = p.check_columns[block]?.[s];
        if (x === undefined) continue;
        schreiben("X", x, H - (top + 3), fett, 9, true);
      }
    }

    /* Unterschrift. Fehlt sie, bleibt die Zeile leer — der Bericht entsteht trotzdem. */
    if (this.unterschrift && p.signature) {
      try {
        const bild = await doc.embedPng(this.unterschrift);
        (seite as PDFPage).drawImage(bild, {
          x: p.signature.x,
          y: H - p.signature.top - p.signature.h,
          width: p.signature.w,
          height: p.signature.h,
        });
      } catch {
        /* Kaputtes Bild darf den Bericht nicht verhindern. */
      }
    }

    return doc.save();
  }
}
