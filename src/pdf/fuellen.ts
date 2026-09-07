/**
 * Formular-PDF per Overlay befüllen — die Übersetzung von `scripts/fill_pdf_overlay.py`
 * nach pdf-lib, damit das Erzeugen im Worker läuft statt auf einem Rechner mit Python.
 *
 * Die Koordinaten-Profile sind unverändert übernommen: `top` ist der Abstand von oben,
 * die Grundlinie rechnet diese Datei aus — genauso wie das Python-Skript es tat. Ein Profil,
 * das dort funktioniert hat, funktioniert hier.
 *
 * v2 kann drei Dinge mehr: die zweite Unterschrift (der Betreiber quittiert die Begehung),
 * einen Fotoanhang hinter der Formularseite (Abschnitt 4.3) und das gezeichnete Deckblatt
 * des Sammelberichts (Abschnitt 4.4).
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

/** Ein Foto für den Anhang. `daten` ist das Bild, wie es in R2 liegt. */
export interface BerichtFoto {
  daten: Uint8Array;
  typ: string;
  notiz: string;
  aufgenommen_am: number;
}

export interface Bericht {
  /** Flache Feldwerte, Schlüssel wie im Profil (IDENT, OBJEKT, ERGEBNIS …). */
  felder: Record<string, string>;
  /** Punkt-Nummer oder Zeilenschlüssel → Bewertung. Leer = alles In Ordnung. */
  checks: Record<string, Bewertung | Bewertung[]>;
  /** Fotos, die als Anhangseiten hinter das Formular kommen (Abschnitt 4.3). */
  fotos?: BerichtFoto[];
  /** Kopfzeile der Anhangseiten: „Tür 12 · Kita Heselstücken · 07.09.2026". */
  anhang_titel?: string;
}

const A4: [number, number] = [595.28, 841.89];

/**
 * Hält die geladene Vorlage und die Unterschriften, damit eine Serie von Bauteilen die Vorlage
 * nur einmal parst. `erzeugen` liefert je Aufruf ein fertiges PDF: die Formularseite, dahinter
 * bei Bedarf der Fotoanhang.
 */
export class Fueller {
  private constructor(
    private readonly vorlage: PDFDocument,
    private readonly profil: Profil,
    private readonly unterschrift: Uint8Array | null,
    private readonly unterschriftBetreiber: Uint8Array | null,
  ) {}

  static async laden(
    vorlageBytes: ArrayBuffer | Uint8Array,
    profil: Profil,
    unterschrift?: ArrayBuffer | Uint8Array | null,
    unterschriftBetreiber?: ArrayBuffer | Uint8Array | null,
  ): Promise<Fueller> {
    const doc = await PDFDocument.load(vorlageBytes);
    const bytes = (x: ArrayBuffer | Uint8Array | null | undefined) =>
      x ? new Uint8Array(x as ArrayBuffer) : null;
    return new Fueller(doc, profil, bytes(unterschrift), bytes(unterschriftBetreiber));
  }

  async erzeugen(bericht: Bericht): Promise<{ bytes: Uint8Array; seiten: number }> {
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

    /* Unterschriften. Fehlt eine, bleibt ihr Feld leer — der Bericht entsteht trotzdem. */
    await this.unterschriftZeichnen(doc, seite as PDFPage, H, this.unterschrift, p.signature);
    await this.unterschriftZeichnen(
      doc,
      seite as PDFPage,
      H,
      this.unterschriftBetreiber,
      p.signature_betreiber,
    );
    if (p.betreiber_name && bericht.felder.BETREIBER_NAME) {
      schreiben(
        bericht.felder.BETREIBER_NAME,
        p.betreiber_name.x,
        H - (p.betreiber_name.top + 8),
        normal,
        p.betreiber_name.size ?? 7,
      );
    }

    /* Fotoanhang: eine Anhangseite je zwei Fotos (Abschnitt 4.3). */
    let seiten = 1;
    const fotos = bericht.fotos ?? [];
    for (let i = 0; i < fotos.length; i += 2) {
      await this.anhangseite(doc, fotos.slice(i, i + 2), bericht.anhang_titel ?? "", normal, fett);
      seiten++;
    }

    return { bytes: await doc.save(), seiten };
  }

  private async unterschriftZeichnen(
    doc: PDFDocument,
    seite: PDFPage,
    H: number,
    bild: Uint8Array | null,
    feld: { x: number; top: number; w: number; h: number } | undefined,
  ): Promise<void> {
    if (!bild || !feld) return;
    try {
      const eingebettet = await doc.embedPng(bild);
      seite.drawImage(eingebettet, {
        x: feld.x,
        y: H - feld.top - feld.h,
        width: feld.w,
        height: feld.h,
      });
    } catch {
      /* Kaputtes Bild darf den Bericht nicht verhindern. */
    }
  }

  /** Eine Anhangseite mit bis zu zwei Fotos, je mit Notiz und Zeitstempel darunter. */
  private async anhangseite(
    doc: PDFDocument,
    fotos: BerichtFoto[],
    titel: string,
    normal: PDFFont,
    fett: PDFFont,
  ): Promise<void> {
    const [B, H] = A4;
    const seite = doc.addPage(A4);
    const rand = 48;
    seite.drawText(winAnsiSicher(`Fotoanhang - ${titel}`), {
      x: rand,
      y: H - rand,
      size: 11,
      font: fett,
      color: rgb(0, 0, 0),
    });

    /* Zwei Plätze übereinander, je höchstens 160 × 120 mm (1 mm = 2.8346 pt). */
    const maxB = Math.min(160 * 2.8346, B - 2 * rand);
    const maxH = 120 * 2.8346;
    let oben = H - rand - 26;

    for (const f of fotos) {
      let bild;
      try {
        bild = /png/i.test(f.typ) ? await doc.embedPng(f.daten) : await doc.embedJpg(f.daten);
      } catch {
        continue; /* ein unlesbares Foto kostet nicht den ganzen Bericht */
      }
      const faktor = Math.min(maxB / bild.width, maxH / bild.height, 1);
      const breite = bild.width * faktor;
      const hoehe = bild.height * faktor;
      seite.drawImage(bild, { x: rand, y: oben - hoehe, width: breite, height: hoehe });
      const unter = [f.notiz, zeitstempel(f.aufgenommen_am)].filter(Boolean).join(" · ");
      if (unter) {
        seite.drawText(winAnsiSicher(unter), {
          x: rand,
          y: oben - hoehe - 14,
          size: 8,
          font: normal,
          color: rgb(0.25, 0.25, 0.3),
        });
      }
      oben -= hoehe + 34;
    }
  }
}

function zeitstempel(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


/* ── Deckblatt des Sammelberichts ──────────────────────────────────────────── */

export interface DeckblattZeile {
  nr: number;
  ort: string;
  ergebnis: string;
  abweichungen: number;
}

export interface DeckblattDaten {
  objekt: string;
  adresse: string;
  betreiber: string;
  ident: string;
  datum: string;
  pruefer: string;
  befaehigung: string;
  ort: string;
  betreiber_name: string;
  zeilen: DeckblattZeile[];
  offene_maengel: number;
}

/**
 * Das Deckblatt wird gezeichnet, nicht ausgefüllt: dafür gibt es keine Vorlage, und die
 * Tabelle wächst mit der Zahl der Bauteile. Dieselbe Linie wie die Website — viel Weiß,
 * Haarlinien statt Rahmen, keine Farbe außer Schwarz und Grau.
 */
export async function deckblatt(
  daten: DeckblattDaten,
  unterschriftBetreiber: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const schwarz = rgb(0, 0, 0);
  const grau = rgb(0.42, 0.42, 0.47);
  const linie = rgb(0.85, 0.85, 0.88);
  const [B, H] = A4;
  const rand = 56;

  let seite = doc.addPage(A4);
  let y = H - rand;

  const text = (s: string, x: number, groesse: number, font = normal, farbe = schwarz) => {
    const sicher = winAnsiSicher(s);
    if (sicher) seite.drawText(sicher, { x, y, size: groesse, font, color: farbe });
  };
  const strich = (staerke = 0.7) => {
    seite.drawLine({ start: { x: rand, y }, end: { x: B - rand, y }, thickness: staerke, color: linie });
  };
  const platzPruefen = (braucht: number) => {
    if (y - braucht < rand) {
      seite = doc.addPage(A4);
      y = H - rand;
    }
  };

  text("Wartungsbericht", rand, 22, fett);
  y -= 26;
  text(daten.objekt, rand, 13, normal, grau);
  y -= 36;

  const paar = (beschriftung: string, wert: string) => {
    if (!wert) return;
    text(beschriftung.toUpperCase(), rand, 7.5, fett, grau);
    y -= 13;
    text(wert, rand, 10.5);
    y -= 21;
  };
  paar("Adresse", daten.adresse);
  paar(
    "Betreiber",
    [daten.betreiber, daten.ident && `Ident ${daten.ident}`].filter(Boolean).join(" - "),
  );
  paar("Pruefdatum", [daten.datum, daten.ort].filter(Boolean).join(" - "));
  paar("Pruefer", [daten.pruefer, daten.befaehigung].filter(Boolean).join(" - "));

  y -= 4;
  strich();
  y -= 24;

  text("GEPRÜFTE BAUTEILE", rand, 7.5, fett, grau);
  y -= 18;
  const spalten = [rand, rand + 44, B - rand - 190, B - rand - 78];
  ["NR", "ORT", "ABWEICHUNGEN", "ERGEBNIS"].forEach((k, i) => {
    seite.drawText(k, { x: spalten[i], y, size: 7, font: fett, color: grau });
  });
  y -= 7;
  strich();
  y -= 15;

  for (const z of daten.zeilen) {
    platzPruefen(30);
    const werte = [
      String(z.nr),
      z.ort || "-",
      z.abweichungen ? String(z.abweichungen) : "keine",
      z.ergebnis || "bestanden",
    ];
    werte.forEach((w, i) => {
      const sicher = winAnsiSicher(w).slice(0, i === 1 ? 46 : 26);
      if (!sicher) return;
      seite.drawText(sicher, {
        x: spalten[i],
        y,
        size: 9,
        font: i === 3 && z.ergebnis === "Nachbesserung" ? fett : normal,
        color: schwarz,
      });
    });
    y -= 9;
    strich(0.4);
    y -= 15;
  }

  platzPruefen(40);
  y -= 8;
  const nachbesserung = daten.zeilen.filter((z) => z.ergebnis === "Nachbesserung").length;
  text(
    `${daten.zeilen.length} Bauteile geprüft - ${nachbesserung} mit Nachbesserung - ` +
      `${daten.offene_maengel} offene Mängel`,
    rand,
    10,
    fett,
  );
  y -= 64;

  /* Unterschrift des Betreibers, wenn sie vorliegt — sonst bleibt die Linie leer. */
  platzPruefen(80);
  if (unterschriftBetreiber) {
    try {
      const bild = await doc.embedPng(unterschriftBetreiber);
      const faktor = Math.min(180 / bild.width, 54 / bild.height, 1);
      seite.drawImage(bild, {
        x: rand,
        y: y + 6,
        width: bild.width * faktor,
        height: bild.height * faktor,
      });
    } catch {
      /* kaputtes Bild kostet nicht das Deckblatt */
    }
  }
  seite.drawLine({
    start: { x: rand, y },
    end: { x: rand + 200, y },
    thickness: 0.7,
    color: linie,
  });
  y -= 12;
  text(daten.betreiber_name || "Betreiber", rand, 8, normal, grau);
  y -= 11;
  text("Datum, Unterschrift des Betreibers", rand, 7.5, normal, grau);

  return doc.save();
}
