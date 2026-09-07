/**
 * Die Tools des MCP-Servers.
 *
 * Zuschnitt nach dem Diktat vor Ort: eine Wartung starten, Tür für Tür schreiben, am Ende
 * zurücklesen und die Berichte erzeugen. Jede Tür geht sofort in die Datenbank — bricht das
 * Gespräch ab, ist nichts verloren.
 *
 * Namen und Beschreibungen sind deutsch, weil diktiert wird und die Rückmeldungen vorgelesen
 * werden. `readOnlyHint` ist nicht Deko: der Hub sortiert Tools danach in Lesen/Schreiben.
 */
import type { Kontext, ToolDef } from "./protokoll";
import type { Bewertung } from "../vorlagen";
import { BEWERTUNGEN, VORLAGEN, VORLAGEN_IDS, vorlage } from "../vorlagen";
import {
  heute,
  inEinemJahr,
  naechsteNr,
  personLesen,
  personSpeichern,
  tuerLesen,
  tuerSpeichern,
  tuerenLesen,
  wartungAendern,
  wartungAnlegen,
  wartungLesen,
  wartungenListe,
} from "../daten/wartungen";
import type { Tuer, Wartung } from "../daten/wartungen";
import { berichteErzeugen, berichtsListe } from "../pdf/berichte";

const NUR_LESEN = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const SCHREIBT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });

function pflicht<T>(args: Record<string, any>, name: string): T {
  const v = args[name];
  if (v === undefined || v === null || v === "") {
    throw new Error(`Pflichtargument '${name}' fehlt.`);
  }
  return v as T;
}

async function holeWartung(ctx: Kontext, id: string): Promise<Wartung> {
  const w = await wartungLesen(ctx.env.DB, id);
  if (!w) {
    throw new Error(
      `Wartung '${id}' gibt es nicht. Mit 'wartungen_auflisten' nachsehen oder 'wartung_starten' benutzen.`,
    );
  }
  return w;
}

/** Bewertungen prüfen und Punkt-Nummern gegen die Vorlage abgleichen. */
function pruefeChecks(vorlagenId: string, checks: Record<string, unknown>): Record<string, Bewertung> {
  const v = vorlage(vorlagenId);
  const erlaubt = new Set(Object.keys(BEWERTUNGEN));
  const out: Record<string, Bewertung> = {};
  for (const [schluessel, wert] of Object.entries(checks ?? {})) {
    const k = String(schluessel);
    if (!(k in v.profil.points) && !(k in v.profil.check_rows)) {
      throw new Error(
        `Punkt '${k}' gibt es in der Vorlage '${vorlagenId}' nicht. Gültig: ${Object.keys(v.profil.points).join(", ")}.`,
      );
    }
    const w = String(wert);
    if (!erlaubt.has(w)) {
      throw new Error(
        `Bewertung '${w}' für Punkt ${k} ist unbekannt. Gültig: ${[...erlaubt].join(", ")}.`,
      );
    }
    out[k] = w as Bewertung;
  }
  return out;
}

function tuerAnsicht(t: Tuer) {
  return {
    nr: t.nr,
    felder: t.felder,
    checks: t.checks,
    abweichungen: Object.keys(t.checks).length,
    ergebnis: t.ergebnis,
    hinweise: t.hinweise,
    status: t.status,
    bericht: t.pdf_schluessel ? t.pdf_schluessel.split("/").pop() : null,
  };
}

function wartungAnsicht(w: Wartung) {
  return {
    id: w.id,
    vorlage: w.vorlage,
    objekt: w.objekt,
    betreiber: w.betreiber,
    ident: w.ident,
    tuertyp: w.tuertyp,
    pruefer: w.pruefer,
    befaehigung: w.befaehigung,
    datum: w.datum,
    ort: w.ort,
    rechtsgrundlagen: w.rechtsgrundlagen,
    letzte_pruefung: w.letzte_pruefung,
    naechste_pruefung: w.naechste_pruefung,
    beteiligte: w.beteiligte,
    status: w.status,
  };
}

/* ── Lesen ─────────────────────────────────────────────────────────────────── */

const vorlagenAuflisten: ToolDef = {
  name: "vorlagen_auflisten",
  title: "Vorlagen auflisten",
  description:
    "Welche Wartungsvorlagen es gibt (Drehflügeltüren, Fenster, Feststellanlagen) mit Anzahl " +
    "der Prüfpunkte und den Feldern, die je Tür abweichen dürfen.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: NUR_LESEN,
  async handler() {
    return {
      vorlagen: VORLAGEN_IDS.map((id) => ({
        id,
        label: VORLAGEN[id].label,
        pruefpunkte: VORLAGEN[id].punkte.length,
        bauteilfelder: VORLAGEN[id].bauteilfelder,
      })),
    };
  },
};

const pruefpunkte: ToolDef = {
  name: "pruefpunkte",
  title: "Prüfpunkte einer Vorlage",
  description:
    "Die nummerierten Prüfpunkte einer Vorlage im Klartext, plus das Cheatsheet für die " +
    "Diktat-Kurzsprache. IMMER zuerst aufrufen, bevor eine Wartung erfasst wird — sonst ist " +
    "unklar, was 'Punkt 8' bedeutet.",
  inputSchema: {
    type: "object",
    properties: {
      vorlage: str(`Eine von: ${VORLAGEN_IDS.join(", ")}`),
    },
    required: ["vorlage"],
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args) {
    const v = vorlage(pflicht<string>(args, "vorlage"));
    return {
      vorlage: v.id,
      label: v.label,
      punkte: v.punkte,
      bewertungen: BEWERTUNGEN,
      standard: "Nicht genannte Punkte gelten als 'io' (In Ordnung).",
      bauteilfelder: v.bauteilfelder,
      cheatsheet: v.blatt,
    };
  },
};

const wartungenAuflisten: ToolDef = {
  name: "wartungen_auflisten",
  title: "Wartungen auflisten",
  description:
    "Die zuletzt bearbeiteten Wartungen, optional gefiltert. Zeigt je Wartung, wie viele Türen " +
    "erfasst und wie viele Berichte noch offen sind.",
  inputSchema: {
    type: "object",
    properties: {
      suche: str("Freitext auf Kennung, Objekt oder Betreiber"),
      status: str("offen | abgeschlossen | generiert"),
      limit: int("Höchstzahl Treffer (Standard 20)"),
    },
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const liste = await wartungenListe(ctx.env.DB, {
      suche: args.suche,
      status: args.status,
      limit: args.limit ?? 20,
    });
    return {
      wartungen: liste.map((w) => ({
        ...wartungAnsicht(w),
        tueren: w.tueren,
        berichte_offen: w.offen,
      })),
    };
  },
};

const wartungLesenTool: ToolDef = {
  name: "wartung_lesen",
  title: "Wartung mit allen Türen lesen",
  description:
    "Stammdaten und alle erfassten Türen einer Wartung. Das ist der Rückleseschritt bei " +
    "'Fertig': kompakt vorlesen, bestätigen lassen, dann Berichte erzeugen.",
  inputSchema: {
    type: "object",
    properties: { wartung: str("Kennung der Wartung, z. B. WART-2026-08-13-Heselstuecken") },
    required: ["wartung"],
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const w = await holeWartung(ctx, pflicht<string>(args, "wartung"));
    const tueren = await tuerenLesen(ctx.env.DB, w.id);
    const v = vorlage(w.vorlage);
    return {
      wartung: wartungAnsicht(w),
      link: `${ctx.origin}/wartung/${encodeURIComponent(w.id)}`,
      tueren: tueren.map((t) => ({
        ...tuerAnsicht(t),
        abweichungen_klartext: Object.entries(t.checks).map(([nr, b]) => {
          const punkt = v.punkte.find((p) => p.nr === String(nr));
          return `${nr} ${punkt ? punkt.text : ""} → ${BEWERTUNGEN[b as Bewertung] ?? b}`;
        }),
      })),
    };
  },
};

const vorgabenLesen: ToolDef = {
  name: "vorgaben_lesen",
  title: "Eigene Vorgaben lesen",
  description:
    "Die gespeicherten Standardwerte des angemeldeten Nutzers (Prüfer, Befähigungsnachweis, " +
    "Rechtsgrundlagen, Prüfort) und ob eine Unterschrift hinterlegt ist.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: NUR_LESEN,
  async handler(_args, ctx) {
    const p = await personLesen(ctx.env.DB, ctx.nutzer.benutzer);
    return {
      benutzer: ctx.nutzer.benutzer,
      name: ctx.nutzer.name,
      vorgaben: p?.vorgaben ?? {},
      unterschrift_hinterlegt: Boolean(p?.unterschrift),
      hinweis: p?.unterschrift
        ? undefined
        : `Ohne Unterschrift bleibt das Feld im Bericht leer. Hochladen unter ${ctx.origin}/einstellungen`,
    };
  },
};

const berichteAuflisten: ToolDef = {
  name: "berichte_auflisten",
  title: "Berichte einer Wartung auflisten",
  description: "Die fertigen PDFs einer Wartung mit Download-Link (Anmeldung im Browser nötig).",
  inputSchema: {
    type: "object",
    properties: { wartung: str("Kennung der Wartung") },
    required: ["wartung"],
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const w = await holeWartung(ctx, pflicht<string>(args, "wartung"));
    const tueren = await tuerenLesen(ctx.env.DB, w.id);
    return {
      wartung: w.id,
      berichte: berichtsListe(tueren).map((b) => ({
        ...b,
        link: `${ctx.origin}/datei/${b.schluessel}`,
      })),
      offen: tueren.filter((t) => t.status !== "generiert").length,
      alle_als_zip: `${ctx.origin}/wartung/${encodeURIComponent(w.id)}/paket.zip`,
    };
  },
};

/* ── Schreiben ─────────────────────────────────────────────────────────────── */

const wartungStarten: ToolDef = {
  name: "wartung_starten",
  title: "Wartung starten",
  description:
    "Legt eine Wartung mit ihren Stammdaten an — einmal je Objekttermin, danach gelten sie für " +
    "jede Tür. Ohne Kennung wird eine aus Datum und Objekt gebildet. Fehlende Angaben werden " +
    "sinnvoll vorbelegt: Befähigung 'Sachkundiger DGWZ', Ort 'Hamburg', nächste Prüfung " +
    "Prüfdatum + 1 Jahr, Rechtsgrundlagen passend zur Vorlage. Existiert die Kennung schon, " +
    "werden die Stammdaten aktualisiert.",
  inputSchema: {
    type: "object",
    properties: {
      vorlage: str(`Pflicht. Eine von: ${VORLAGEN_IDS.join(", ")}`),
      objekt: str("Objektbeschreibung/Adresse — NICHT die Stadt"),
      id: str("Eigene Kennung, sonst wird eine gebildet"),
      betreiber: str("Betreiber / Auftraggeber"),
      ident: str("Ident-Nummer, falls vorhanden"),
      tuertyp: str("Türtyp"),
      pruefer: str("Name des Prüfers"),
      befaehigung: str("Befähigungsnachweis"),
      datum: str("Prüfdatum YYYY-MM-DD, Standard heute"),
      ort: str("Prüfort/Stadt"),
      rechtsgrundlagen: str("Rechtsgrundlagen"),
      letzte_pruefung: str("Datum der letzten Prüfung"),
      naechste_pruefung: str("Datum der nächsten Prüfung"),
      beteiligte: str("Beteiligte Personen / Messgeräte"),
    },
    required: ["vorlage", "objekt"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const person = await personLesen(ctx.env.DB, ctx.nutzer.benutzer);
    const v = person?.vorgaben ?? {};
    const w = await wartungAnlegen(ctx.env.DB, {
      vorlage: pflicht<string>(args, "vorlage"),
      objekt: pflicht<string>(args, "objekt"),
      id: args.id,
      betreiber: args.betreiber,
      ident: args.ident,
      tuertyp: args.tuertyp,
      pruefer: args.pruefer ?? v.pruefer ?? ctx.nutzer.name,
      befaehigung: args.befaehigung ?? v.befaehigung,
      datum: args.datum || heute(),
      ort: args.ort ?? v.ort,
      rechtsgrundlagen: args.rechtsgrundlagen ?? v.rechtsgrundlagen,
      letzte_pruefung: args.letzte_pruefung,
      naechste_pruefung: args.naechste_pruefung,
      beteiligte: args.beteiligte,
      angelegt_von: ctx.nutzer.benutzer,
    });
    return {
      wartung: wartungAnsicht(w),
      link: `${ctx.origin}/wartung/${encodeURIComponent(w.id)}`,
      naechste_tuer: await naechsteNr(ctx.env.DB, w.id),
      hinweis:
        "Stammdaten gelten ab jetzt für jede Tür. Vor der ersten Tür 'pruefpunkte' lesen, " +
        "falls noch nicht geschehen.",
    };
  },
};

const wartungAendernTool: ToolDef = {
  name: "wartung_aendern",
  title: "Stammdaten einer Wartung ändern",
  description:
    "Ändert Stammdaten einer laufenden Wartung. Nur die genannten Felder werden angefasst. " +
    "Gilt rückwirkend für alle Türen, weil die Stammdaten erst beim Erzeugen eingesetzt werden.",
  inputSchema: {
    type: "object",
    properties: {
      wartung: str("Kennung der Wartung"),
      objekt: str("Objektbeschreibung/Adresse"),
      betreiber: str("Betreiber / Auftraggeber"),
      ident: str("Ident-Nummer"),
      tuertyp: str("Türtyp"),
      pruefer: str("Name des Prüfers"),
      befaehigung: str("Befähigungsnachweis"),
      datum: str("Prüfdatum YYYY-MM-DD"),
      ort: str("Prüfort/Stadt"),
      rechtsgrundlagen: str("Rechtsgrundlagen"),
      letzte_pruefung: str("Datum der letzten Prüfung"),
      naechste_pruefung: str("Datum der nächsten Prüfung"),
      beteiligte: str("Beteiligte Personen / Messgeräte"),
      status: str("offen | abgeschlossen"),
    },
    required: ["wartung"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const w = await holeWartung(ctx, pflicht<string>(args, "wartung"));
    const patch: Record<string, string> = {};
    for (const feld of [
      "objekt", "betreiber", "ident", "tuertyp", "pruefer", "befaehigung", "datum", "ort",
      "rechtsgrundlagen", "letzte_pruefung", "naechste_pruefung", "beteiligte", "status",
    ]) {
      if (args[feld] !== undefined) patch[feld] = String(args[feld]);
    }
    if (patch.datum && !args.naechste_pruefung && !w.naechste_pruefung) {
      patch.naechste_pruefung = inEinemJahr(patch.datum);
    }
    const neu = await wartungAendern(ctx.env.DB, w.id, patch);
    return { wartung: wartungAnsicht(neu!), geaendert: Object.keys(patch) };
  },
};

/** Gemeinsame Logik für eine einzelne Tür — benutzt von tuer_erfassen und tueren_erfassen. */
async function tuerSchreiben(
  ctx: Kontext,
  w: Wartung,
  eingabe: Record<string, any>,
): Promise<Tuer> {
  const nr: number = eingabe.nr ?? (await naechsteNr(ctx.env.DB, w.id));
  const vorher = eingabe.wie_davor ? await tuerLesen(ctx.env.DB, w.id, nr - 1) : null;
  const bestehend = await tuerLesen(ctx.env.DB, w.id, nr);

  const felder = {
    ...(vorher?.felder ?? {}),
    ...(bestehend?.felder ?? {}),
    ...(eingabe.felder ?? {}),
  };
  const checks =
    eingabe.checks !== undefined
      ? pruefeChecks(w.vorlage, eingabe.checks)
      : (vorher?.checks ?? bestehend?.checks ?? {});

  return tuerSpeichern(ctx.env.DB, w.id, {
    nr,
    felder: Object.fromEntries(
      Object.entries(felder).filter(([, v]) => v !== null && v !== undefined && v !== ""),
    ) as Record<string, string>,
    checks,
    ergebnis: eingabe.ergebnis ?? vorher?.ergebnis ?? bestehend?.ergebnis ?? "bestanden",
    hinweise: eingabe.hinweise ?? bestehend?.hinweise ?? "",
    dateiname: eingabe.dateiname ?? bestehend?.dateiname,
  });
}

const TUER_FELDER = {
  nr: int("Türnummer. Ohne Angabe wird hochgezählt. Bestehende Nummer = Korrektur."),
  wie_davor: bool(
    "true, wenn der Monteur 'wie davor' oder 'alles gleich außer …' sagt: Felder und " +
      "Bewertungen der vorigen Tür werden übernommen und nur die genannten überschrieben. " +
      "Standard false.",
  ),
  felder: {
    type: "object",
    description:
      "Felder, die je Tür abweichen, als Schlüssel/Wert — z. B. {\"ETAGE\":\"2\",\"RAUM\":\"Flur Ost\"}. " +
      "Welche Schlüssel die Vorlage kennt, sagt 'pruefpunkte'.",
    additionalProperties: { type: "string" },
  },
  checks: {
    type: "object",
    description:
      "NUR die Abweichungen, Punkt-Nummer → Bewertung: io (In Ordnung), nio (Nicht in Ordnung), " +
      "nz (Nicht zutreffend), sb (Siehe Bemerkung). Leer lassen heißt: alles in Ordnung. " +
      "Beispiel: {\"8\":\"nio\",\"10\":\"sb\"}.",
    additionalProperties: { type: "string" },
  },
  ergebnis: str("bestanden | Nachbesserung — Standard 'bestanden'"),
  hinweise: str("Bemerkungen, Mängeltext, Folgebedarf"),
  dateiname: str("Eigener Dateiname des Berichts, sonst wird einer gebildet"),
};

const tuerErfassen: ToolDef = {
  name: "tuer_erfassen",
  title: "Tür erfassen",
  description:
    "Schreibt eine Tür sofort in die Datenbank — nach jeder diktierten Tür genau einmal " +
    "aufrufen und kurz quittieren ('Tür 3 gespeichert'). Eine bereits vorhandene Nummer wird " +
    "überschrieben, das ist der Weg für Korrekturen ('Tür 3 doch in Ordnung').",
  inputSchema: {
    type: "object",
    properties: { wartung: str("Kennung der Wartung"), ...TUER_FELDER },
    required: ["wartung"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const w = await holeWartung(ctx, pflicht<string>(args, "wartung"));
    const t = await tuerSchreiben(ctx, w, args);
    return {
      gespeichert: `Tür ${t.nr}`,
      tuer: tuerAnsicht(t),
      naechste_tuer: await naechsteNr(ctx.env.DB, w.id),
    };
  },
};

const tuerenErfassen: ToolDef = {
  name: "tueren_erfassen",
  title: "Mehrere Türen auf einmal erfassen",
  description:
    "Mehrere Türen in einem Aufruf — für Serien gleicher Türen oder wenn ein Diktat " +
    "nachträglich gebündelt übertragen wird. Reihenfolge zählt: 'wie_davor' bezieht sich auf " +
    "die jeweils vorige Nummer.",
  inputSchema: {
    type: "object",
    properties: {
      wartung: str("Kennung der Wartung"),
      tueren: {
        type: "array",
        description: "Liste von Türen, gleiche Felder wie bei tuer_erfassen.",
        items: { type: "object", properties: TUER_FELDER, additionalProperties: false },
      },
    },
    required: ["wartung", "tueren"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const w = await holeWartung(ctx, pflicht<string>(args, "wartung"));
    const eingaben = pflicht<Record<string, any>[]>(args, "tueren");
    const geschrieben: number[] = [];
    for (const e of eingaben) {
      const t = await tuerSchreiben(ctx, w, e);
      geschrieben.push(t.nr);
    }
    return {
      gespeichert: geschrieben.length,
      tueren: geschrieben,
      naechste_tuer: await naechsteNr(ctx.env.DB, w.id),
    };
  },
};

const wartungAbschliessen: ToolDef = {
  name: "wartung_abschliessen",
  title: "Wartung abschließen",
  description:
    "Markiert die Erfassung als fertig und liest alle Türen zurück. Danach 'berichte_erzeugen' " +
    "aufrufen — oder vorher noch korrigieren, das bleibt jederzeit möglich.",
  inputSchema: {
    type: "object",
    properties: { wartung: str("Kennung der Wartung") },
    required: ["wartung"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const w = await holeWartung(ctx, pflicht<string>(args, "wartung"));
    await wartungAendern(ctx.env.DB, w.id, { status: "abgeschlossen" });
    const tueren = await tuerenLesen(ctx.env.DB, w.id);
    return {
      wartung: w.id,
      tueren_gesamt: tueren.length,
      mit_abweichungen: tueren.filter((t) => Object.keys(t.checks).length).length,
      rueckblick: tueren.map(tuerAnsicht),
    };
  },
};

const berichteErzeugenTool: ToolDef = {
  name: "berichte_erzeugen",
  title: "Berichte erzeugen",
  description:
    "Füllt für jede Tür die Vorlage aus und legt das PDF ab. Läuft in Stücken: kommt 'fertig: " +
    "false' zurück, einfach erneut aufrufen, bis nichts mehr offen ist. Schon erzeugte Türen " +
    "werden übersprungen, geänderte automatisch neu gemacht.",
  inputSchema: {
    type: "object",
    properties: {
      wartung: str("Kennung der Wartung"),
      alle_neu: bool("true erzeugt auch bereits fertige Berichte noch einmal"),
    },
    required: ["wartung"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const w = await holeWartung(ctx, pflicht<string>(args, "wartung"));
    const lauf = await berichteErzeugen(ctx.env, w.id, { alle: args.alle_neu === true });
    return {
      ...lauf,
      link: `${ctx.origin}/wartung/${encodeURIComponent(w.id)}`,
      alle_als_zip: lauf.fertig
        ? `${ctx.origin}/wartung/${encodeURIComponent(w.id)}/paket.zip`
        : undefined,
    };
  },
};

const vorgabenSpeichern: ToolDef = {
  name: "vorgaben_speichern",
  title: "Eigene Vorgaben speichern",
  description:
    "Speichert die Standardwerte des angemeldeten Nutzers dauerhaft. Sie füllen künftige " +
    "Wartungen vor, sodass Prüfer, Befähigungsnachweis, Rechtsgrundlagen und Ort nicht jedes " +
    "Mal diktiert werden müssen.",
  inputSchema: {
    type: "object",
    properties: {
      pruefer: str("Name des Prüfers"),
      befaehigung: str("Befähigungsnachweis, z. B. 'Sachkundiger DGWZ'"),
      rechtsgrundlagen: str("Rechtsgrundlagen"),
      ort: str("Prüfort/Stadt"),
    },
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const p = await personLesen(ctx.env.DB, ctx.nutzer.benutzer);
    const vorgaben = { ...(p?.vorgaben ?? {}) };
    for (const feld of ["pruefer", "befaehigung", "rechtsgrundlagen", "ort"]) {
      if (args[feld] !== undefined) vorgaben[feld] = String(args[feld]);
    }
    await personSpeichern(ctx.env.DB, ctx.nutzer.benutzer, { vorgaben });
    return { gespeichert: true, vorgaben };
  },
};

export const TOOLS: ToolDef[] = [
  vorlagenAuflisten,
  pruefpunkte,
  wartungenAuflisten,
  wartungLesenTool,
  vorgabenLesen,
  berichteAuflisten,
  wartungStarten,
  wartungAendernTool,
  tuerErfassen,
  tuerenErfassen,
  wartungAbschliessen,
  berichteErzeugenTool,
  vorgabenSpeichern,
];

export const ANLEITUNG =
  "Türenwartung für Seehafer Elemente — Diktat vor Ort, fertige Wartungsprotokolle am Ende. " +
  "Ablauf: (1) 'pruefpunkte' der passenden Vorlage lesen, damit Punkt-Nummern verständlich sind. " +
  "(2) 'wartung_starten' mit Objekt und Stammdaten — einmal je Termin. " +
  "(3) Nach JEDER diktierten Tür sofort 'tuer_erfassen' und kurz quittieren; nicht im Gespräch " +
  "puffern, damit bei Abbruch nichts verloren geht. Standard ist: alles in Ordnung — nur " +
  "Abweichungen als checks nennen, z. B. {\"8\":\"nio\"}. Sagt der Monteur 'wie davor', " +
  "wie_davor=true setzen. (4) Auf 'Fertig' 'wartung_abschliessen' und den Rückblick kompakt " +
  "vorlesen. (5) Auf 'Go' 'berichte_erzeugen' — bei 'fertig: false' erneut aufrufen. " +
  "Kurz antworten, der Monteur hat die Hände voll und schaut nicht aufs Display.";
