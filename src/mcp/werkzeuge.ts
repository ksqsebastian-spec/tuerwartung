/**
 * Die Tools des MCP-Servers, Fassung 2.
 *
 * Zuschnitt nach dem Diktat vor Ort: eine Begehung starten, Bauteil für Bauteil schreiben, am
 * Ende zurücklesen und die Berichte erzeugen. Jede Prüfung geht sofort in die Datenbank —
 * bricht das Gespräch ab, ist nichts verloren.
 *
 * Der Unterschied zu v1 steckt im Datenmodell, nicht in der Sprache: „Tür 12" meint jetzt das
 * Bauteil Nr. 12 des Objekts und nicht die zwölfte Tür des Tages. Kennt der Server ein Objekt
 * nicht, legt `begehung_starten` es an — die erste Begehung ist die Bestandsaufnahme.
 *
 * Namen und Beschreibungen sind deutsch, weil diktiert wird und die Rückmeldungen vorgelesen
 * werden. `readOnlyHint` ist nicht Deko: der Hub sortiert Tools danach in Lesen/Schreiben.
 */
import type { Kontext, ToolDef } from "./protokoll";
import { TUERTYP_TOOLS } from "./tuertypen_werkzeuge";
import {
  BEWERTUNGEN,
  VORLAGEN,
  VORLAGEN_IDS,
  abweichungenKlartext,
  vorlage,
} from "../vorlagen";
import { heute, monateSpaeter, tageBis, zugriffPruefen } from "../daten/basis";
import { personLesen, personSpeichern } from "../daten/personen";
import {
  faelligkeit,
  geschosseListe,
  objektAendern,
  objektAnlegen,
  objektAufloesen,
  objektLesen,
  objektSuchen,
  objekteListe,
} from "../daten/objekte";
import type { Objekt } from "../daten/objekte";
import {
  bauteilAendern,
  bauteilAnlegen,
  bauteileAnlegen,
  bauteilPerKennung,
  bauteilPerNr,
  bauteileMitStand,
  inLaufreihenfolge,
  istFaellig,
  naechsteNr,
} from "../daten/bauteile";
import type { BauteilMitStand } from "../daten/bauteile";
import {
  begehungAbbrechen,
  begehungAendern,
  begehungFuerTag,
  begehungLesen,
  begehungenListe,
  pruefungErfassen,
  pruefungenHistorie,
  pruefungenLesen,
} from "../daten/begehungen";
import type { Begehung } from "../daten/begehungen";
import {
  mangelAendern,
  mangelAnlegen,
  mangelLesen,
  mangelSchliessen,
  maengelListe,
  maengelZuBauteil,
} from "../daten/maengel";
import { fotosZuBauteil } from "../daten/fotos";
import { berichteZuPruefung } from "../daten/berichte";
import { berichteErzeugen, berichtsUebersicht, sammelberichtErzeugen } from "../pdf/berichte";
import { IMPORT_TOOLS } from "./import_werkzeuge";

const NUR_LESEN = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const SCHREIBT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });
const wortliste = (description: string) => ({
  type: "array",
  description,
  items: { type: "string" },
});

function pflicht<T>(args: Record<string, any>, name: string): T {
  const v = args[name];
  if (v === undefined || v === null || v === "") {
    throw new Error(`Pflichtargument '${name}' fehlt.`);
  }
  return v as T;
}

/* ── Auflösung ─────────────────────────────────────────────────────────────── */

async function holeObjekt(ctx: Kontext, text: string): Promise<Objekt> {
  const o = await objektAufloesen(ctx.env.DB, text);
  zugriffPruefen(ctx.nutzer.benutzer, o.id);
  return o;
}

/**
 * Eine Begehung finden: über ihre Kennung, sonst über das Objekt — dann gewinnt die jüngste
 * laufende. Der Monteur sagt „die von heute in der Kita", nicht eine 26-stellige Kennung.
 */
async function holeBegehung(ctx: Kontext, text: string): Promise<Begehung> {
  const direkt = await begehungLesen(ctx.env.DB, text);
  if (direkt) {
    zugriffPruefen(ctx.nutzer.benutzer, direkt.objekt_id);
    return direkt;
  }
  const objekt = await objektSuchen(ctx.env.DB, text);
  if (objekt) {
    const liste = await begehungenListe(ctx.env.DB, { objekt_id: objekt.id, limit: 1 });
    if (liste.length) {
      zugriffPruefen(ctx.nutzer.benutzer, liste[0].objekt_id);
      return (await begehungLesen(ctx.env.DB, liste[0].id))!;
    }
  }
  throw new Error(
    `Begehung '${text}' gibt es nicht. Mit 'objekt_lesen' nachsehen oder 'begehung_starten' benutzen.`,
  );
}

async function holeBauteil(
  ctx: Kontext,
  objekt: Objekt,
  args: Record<string, any>,
): Promise<BauteilMitStand> {
  const alle = await bauteileMitStand(ctx.env.DB, objekt, { auch_stillgelegte: true });
  if (args.nr !== undefined && args.nr !== null && args.nr !== "") {
    const b = alle.find((x) => x.nr === Number(args.nr));
    if (b) return b;
    throw new Error(`Bauteil Nr. ${args.nr} gibt es an '${objekt.name}' nicht.`);
  }
  if (args.kennung) {
    const treffer = await bauteilPerKennung(ctx.env.DB, objekt.id, String(args.kennung));
    if (treffer.length === 1) return alle.find((x) => x.id === treffer[0].id)!;
    if (treffer.length > 1) {
      throw new Error(
        `Kennung '${args.kennung}' passt auf mehrere Bauteile (Nr. ${treffer.map((t) => t.nr).join(", ")}).`,
      );
    }
    throw new Error(`Kennung '${args.kennung}' gibt es an '${objekt.name}' nicht.`);
  }
  throw new Error("Bauteil angeben: 'nr' oder 'kennung'.");
}

/* ── Ansichten ─────────────────────────────────────────────────────────────── */

function objektAnsicht(o: Objekt) {
  return {
    id: o.id,
    name: o.name,
    objektart: o.objektart || undefined,
    adresse: o.adresse,
    betreiber: o.betreiber,
    betreiber_kontakt: o.betreiber_kontakt || undefined,
    telefon: o.telefon || undefined,
    email: o.email || undefined,
    /* Der wichtigste Satz für jemanden, der gleich hinfährt — deshalb steht er mit drin. */
    zugang: o.zugang || undefined,
    vertrag: o.vertrag || undefined,
    ident: o.ident,
    intervall_monate: o.intervall_monate,
    rechtsgrundlagen: o.rechtsgrundlagen,
  };
}

function standAnsicht(b: BauteilMitStand) {
  return {
    faellig_am: b.stand.faellig_am || "sofort",
    zustand: b.stand.zustand,
    tage: b.stand.tage,
  };
}

function bauteilAnsicht(b: BauteilMitStand) {
  return {
    nr: b.nr,
    kennung: b.kennung || undefined,
    art: b.art,
    ort: [b.raumnummer, b.raum || b.bezeichnung, b.flur].filter(Boolean).join(" · ") || undefined,
    /* Verortet im Plan? Dann weiß der Agent, dass die Karte diese Tür kennt. */
    x: b.x ?? undefined,
    y: b.y ?? undefined,
    felder: b.felder,
    letzte_pruefung: b.letzte_pruefung || null,
    letztes_ergebnis: b.letztes_ergebnis || null,
    faelligkeit: standAnsicht(b),
    offene_maengel: b.offene_maengel,
    wartungspflichtig: b.wartungspflichtig === 1,
    aktiv: b.aktiv === 1,
  };
}

function mangelAnsicht(m: {
  id: string;
  punkte: string[];
  beschreibung: string;
  prioritaet: string;
  frist: string | null;
  zustaendig: string;
  status: string;
}) {
  return {
    id: m.id,
    punkte: m.punkte,
    beschreibung: m.beschreibung,
    prioritaet: m.prioritaet,
    frist: m.frist,
    zustaendig: m.zustaendig,
    status: m.status,
  };
}

function begehungAnsicht(b: Begehung) {
  return {
    id: b.id,
    objekt_id: b.objekt_id,
    datum: b.datum,
    pruefer: b.pruefer,
    befaehigung: b.befaehigung,
    ort: b.ort,
    beteiligte: b.beteiligte,
    status: b.status,
    betreiber_name: b.betreiber_name || undefined,
    unterschrieben: Boolean(b.betreiber_unterschrift),
  };
}

/* ── Lesen ─────────────────────────────────────────────────────────────────── */

const vorlagenAuflisten: ToolDef = {
  name: "vorlagen_auflisten",
  title: "Vorlagen auflisten",
  description:
    "Welche Wartungsvorlagen es gibt (Drehflügeltüren, Fenster, Feststellanlagen) mit Anzahl " +
    "der Prüfpunkte und den Feldern, die je Bauteil abweichen dürfen.",
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
    "Diktat-Kurzsprache. IMMER zuerst aufrufen, bevor eine Begehung erfasst wird — sonst ist " +
    "unklar, was 'Punkt 8' bedeutet.",
  inputSchema: {
    type: "object",
    properties: { vorlage: str(`Eine von: ${VORLAGEN_IDS.join(", ")}`) },
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

const objekteAuflisten: ToolDef = {
  name: "objekte_auflisten",
  title: "Objekte auflisten",
  description:
    "Die Objekte mit Fälligkeit, Bauteilzahl und offenen Mängeln, das dringendste zuerst. " +
    "Der Einstieg für 'wo stehen wir?' und 'gibt es das Objekt schon?'.",
  inputSchema: {
    type: "object",
    properties: {
      suche: str("Freitext auf Name, Adresse oder Betreiber"),
      nur_faellige: bool("true zeigt nur Objekte mit fälligen Bauteilen"),
      limit: int("Höchstzahl Treffer (Standard 50)"),
    },
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const liste = await objekteListe(ctx.env.DB, {
      suche: args.suche,
      nur_faellige: args.nur_faellige === true,
      limit: args.limit ?? 50,
    });
    return {
      objekte: liste.map((o) => ({
        ...objektAnsicht(o),
        bauteile: o.bauteile,
        faellige_bauteile: o.faellige_bauteile,
        offene_maengel: o.offene_maengel,
        letzte_begehung: o.letzte_begehung,
        faellig_am: o.stand.faellig_am || "sofort",
        zustand: o.stand.zustand,
      })),
    };
  },
};

const objektLesenTool: ToolDef = {
  name: "objekt_lesen",
  title: "Objekt mit Bestand lesen",
  description:
    "Stammdaten, Geschosse und alle Bauteile eines Objekts in Laufreihenfolge — je Bauteil " +
    "letzte Prüfung, Fälligkeit und offene Mängel. Dazu die letzten Begehungen.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse des Objekts"),
      nur_faellige: bool("true zeigt nur die fälligen Bauteile"),
    },
    required: ["objekt"],
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const objekt = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const geschosse = await geschosseListe(ctx.env.DB, objekt.id);
    const alle = await bauteileMitStand(ctx.env.DB, objekt);
    const sortiert = inLaufreihenfolge(alle, geschosse);
    const gezeigt = args.nur_faellige === true ? sortiert.filter(istFaellig) : sortiert;
    const begehungen = await begehungenListe(ctx.env.DB, { objekt_id: objekt.id, limit: 5 });
    return {
      objekt: objektAnsicht(objekt),
      link: `${ctx.origin}/objekt/${objekt.id}`,
      geschosse: geschosse.map((g) => ({ id: g.id, name: g.name, reihenfolge: g.reihenfolge })),
      bauteile_gesamt: alle.length,
      faellige_bauteile: sortiert.filter(istFaellig).length,
      bauteile: gezeigt.map(bauteilAnsicht),
      begehungen: begehungen.map((b) => ({
        id: b.id,
        datum: b.datum,
        status: b.status,
        pruefungen: b.pruefungen,
      })),
    };
  },
};

const bauteilLesenTool: ToolDef = {
  name: "bauteil_lesen",
  title: "Bauteil mit Historie lesen",
  description:
    "Ein Bauteil mit allem, was daran hängt: Stammdaten, alle Prüfungen der vergangenen Jahre, " +
    "Mängel, Fotos und Berichtsversionen.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse des Objekts"),
      nr: int("Nummer des Bauteils, z. B. 12"),
      kennung: str("Kennung aus Türliste/Plan, z. B. T-2.14"),
    },
    required: ["objekt"],
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const objekt = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const b = await holeBauteil(ctx, objekt, args);
    const historie = await pruefungenHistorie(ctx.env.DB, b.id);
    const maengel = await maengelZuBauteil(ctx.env.DB, b.id);
    const fotos = await fotosZuBauteil(ctx.env.DB, b.id);
    const berichte: { datum: string; version: number; link: string }[] = [];
    for (const p of historie) {
      for (const r of await berichteZuPruefung(ctx.env.DB, p.id)) {
        berichte.push({
          datum: p.datum,
          version: r.version,
          link: `${ctx.origin}/datei/${r.r2_schluessel}`,
        });
      }
    }
    return {
      objekt: objektAnsicht(objekt),
      bauteil: bauteilAnsicht(b),
      link: `${ctx.origin}/objekt/${objekt.id}/bauteil/${b.nr}`,
      pruefungen: historie.map((p) => ({
        datum: p.datum,
        pruefer: p.pruefer,
        ergebnis: p.ergebnis,
        hinweise: p.hinweise || undefined,
        abweichungen: abweichungenKlartext(b.art, p.checks),
      })),
      maengel: maengel.map(mangelAnsicht),
      fotos: fotos.map((f) => ({
        notiz: f.notiz,
        aufgenommen_am: f.aufgenommen_am,
        link: `${ctx.origin}/datei/${f.r2_schluessel}`,
      })),
      berichte,
    };
  },
};

const faellig: ToolDef = {
  name: "faellig",
  title: "Was ist fällig?",
  description:
    "Objekte, deren Bauteile innerhalb der nächsten Tage fällig werden — mit Anzahl der " +
    "fälligen Bauteile und dem frühesten Datum. Das ist die Antwort auf 'was ist diese Woche dran?'.",
  inputSchema: {
    type: "object",
    properties: { tage: int("Vorlauf in Tagen, Standard 30") },
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const tage = Number(args.tage ?? 30);
    const grenze = new Date(Date.now() + tage * 86_400_000).toISOString().slice(0, 10);
    const liste = await objekteListe(ctx.env.DB, { limit: 500 });
    const treffer = liste.filter(
      (o) => o.stand.nie_geprueft || (o.stand.faellig_am && o.stand.faellig_am <= grenze),
    );
    return {
      stichtag: grenze,
      objekte: treffer.map((o) => ({
        id: o.id,
        name: o.name,
        adresse: o.adresse,
        plz: o.plz,
        faellige_bauteile: o.faellige_bauteile,
        bauteile: o.bauteile,
        faellig_am: o.stand.faellig_am || "sofort",
        zustand: o.stand.zustand,
        offene_maengel: o.offene_maengel,
      })),
    };
  },
};

const begehungLesenTool: ToolDef = {
  name: "begehung_lesen",
  title: "Begehung mit allen Prüfungen lesen",
  description:
    "Alle Prüfungen einer Begehung mit den Abweichungen im Klartext, dazu die fälligen " +
    "Bauteile, die noch fehlen. Das ist der Rückleseschritt bei 'Fertig'.",
  inputSchema: {
    type: "object",
    properties: { begehung: str("Kennung der Begehung oder Name des Objekts") },
    required: ["begehung"],
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const begehung = await holeBegehung(ctx, pflicht<string>(args, "begehung"));
    return rueckblick(ctx, begehung);
  },
};


const berichteAuflisten: ToolDef = {
  name: "berichte_auflisten",
  title: "Berichte einer Begehung auflisten",
  description:
    "Die neuesten Berichtsversionen einer Begehung mit Download-Link, dazu Sammelbericht und " +
    "ZIP (Anmeldung im Browser nötig).",
  inputSchema: {
    type: "object",
    properties: { begehung: str("Kennung der Begehung oder Name des Objekts") },
    required: ["begehung"],
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const begehung = await holeBegehung(ctx, pflicht<string>(args, "begehung"));
    const objekt = (await objektLesen(ctx.env.DB, begehung.objekt_id))!;
    const posten = await berichtsUebersicht(ctx.env, begehung, objekt);
    const pruefungen = await pruefungenLesen(ctx.env.DB, begehung.id);
    return {
      begehung: begehung.id,
      objekt: objekt.name,
      berichte: posten.map((p) => ({
        nr: p.nr,
        version: p.version,
        datei: p.name,
        seiten: p.seiten,
        veraltet: p.veraltet,
        aeltere_versionen: p.aeltere.map((a) => a.version),
        link: `${ctx.origin}/datei/${p.schluessel}`,
      })),
      ohne_bericht: pruefungen.length - posten.length,
      sammelbericht: `${ctx.origin}/objekt/${begehung.objekt_id}/berichte`,
      alle_als_zip: `${ctx.origin}/begehung/${begehung.id}/paket.zip`,
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

/* ── Schreiben: Bestand ────────────────────────────────────────────────────── */

const objektAnlegenTool: ToolDef = {
  name: "objekt_anlegen",
  title: "Objekt anlegen",
  description:
    "Legt ein Objekt mit Hauptgebäude und Geschoss 'EG' an. Für den Regelfall reicht " +
    "'begehung_starten' — das legt ein unbekanntes Objekt selbst an.",
  inputSchema: {
    type: "object",
    properties: {
      name: str("Name des Objekts, z. B. 'Kita Heselstücken'"),
      adresse: str("Straße, PLZ Ort in einer Zeile"),
      plz: str("Postleitzahl, sonst aus der Adresse gelesen"),
      betreiber: str("Betreiber, wie er aufs Protokoll gehört"),
      betreiber_kontakt: str("Ansprechpartner vor Ort mit Telefon"),
      ident: str("Ident-Nummer des Betreibers"),
      intervall_monate: int("Prüfintervall in Monaten, Standard 12"),
      rechtsgrundlagen: str("Rechtsgrundlagen; leer = Standard je Vorlage"),
    },
    required: ["name"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const o = await objektAnlegen(ctx.env.DB, {
      name: pflicht<string>(args, "name"),
      adresse: args.adresse,
      plz: args.plz,
      betreiber: args.betreiber,
      betreiber_kontakt: args.betreiber_kontakt,
      ident: args.ident,
      intervall_monate: args.intervall_monate,
      rechtsgrundlagen: args.rechtsgrundlagen,
      angelegt_von: ctx.nutzer.benutzer,
    });
    return { objekt: objektAnsicht(o), link: `${ctx.origin}/objekt/${o.id}` };
  },
};

/* ── Einrichten ────────────────────────────────────────────────────────────── */

/**
 * Was ein Objekt braucht, damit die Berichte vollständig sind und niemand vergeblich hinfährt —
 * in der Reihenfolge, in der man vernünftig danach fragt. Die Frage steht gleich dabei, damit
 * Claude nicht selbst formulieren muss und über alle Objekte dieselbe Sprache spricht.
 */
const EINRICHTUNG: { feld: string; frage: string; pflicht: boolean; warum: string }[] = [
  {
    feld: "adresse",
    frage: "Wie lautet die Adresse? (Straße, PLZ Ort)",
    pflicht: true,
    warum: "steht im Bericht",
  },
  {
    feld: "betreiber",
    frage: "Wer ist der Betreiber?",
    pflicht: true,
    warum: "steht im Bericht",
  },
  {
    feld: "objektart",
    frage: "Was ist das für ein Objekt — Kita, Schule, Bürogebäude?",
    pflicht: false,
    warum: "hilft beim Einordnen und Suchen",
  },
  {
    feld: "betreiber_kontakt",
    frage: "Wer ist vor Ort der Ansprechpartner?",
    pflicht: false,
    warum: "damit man weiß, bei wem man klingelt",
  },
  {
    feld: "telefon",
    frage: "Welche Nummer hat er?",
    pflicht: false,
    warum: "spart die Suche, wenn vor Ort niemand aufmacht",
  },
  {
    feld: "zugang",
    frage:
      "Wie kommt man rein? Schlüssel beim Hausmeister, Anmeldung im Sekretariat, Codeschloss?",
    pflicht: false,
    warum: "verhindert die vergebliche Anfahrt",
  },
  {
    feld: "vertrag",
    frage: "Gibt es eine Wartungsvertrags- oder Auftragsnummer?",
    pflicht: false,
    warum: "gehört auf die Papiere",
  },
  {
    feld: "ident",
    frage: "Hat der Betreiber eine Ident-Nummer für das Objekt?",
    pflicht: false,
    warum: "steht im Formular",
  },
];

/**
 * Der Einrichtungs-Assistent: ein Tool, das führt, statt nur zu speichern.
 *
 * Ein neues Objekt anzulegen hieß bisher: `objekt_anlegen`, dann selbst überlegen, welche
 * Stammdaten fehlen, dann `objekt_aendern`. Was dabei nicht gefragt wurde, fehlte später im
 * Bericht — und fiel erst auf, wenn er beim Kunden lag. Dieses Tool kehrt das um: es nimmt
 * mit, was schon gesagt wurde, und nennt **eine** nächste Frage. Mehrfach aufgerufen führt es
 * durch die Einrichtung, ohne dass jemand eine Reihenfolge im Kopf haben muss.
 */
const objektEinrichtenTool: ToolDef = {
  name: "objekt_einrichten",
  title: "Neues Objekt einrichten (geführt)",
  description:
    "Der Assistent für ein neues Objekt. Legt es an, wenn es das noch nicht gibt, übernimmt " +
    "alles Mitgegebene und antwortet mit 'naechste_frage' — genau eine Frage, die du dem " +
    "Menschen stellst. Seine Antwort im nächsten Aufruf mitgeben, bis 'fertig: true' kommt. " +
    "Stell immer nur die eine genannte Frage und lies nicht die ganze Liste vor. Fehlt etwas " +
    "Freiwilliges und der Mensch weiß es nicht, 'ueberspringen' mit dem Feldnamen mitgeben. " +
    "Am Ende sagt 'weiter_mit', was sich lohnt: Bauplan einlesen oder gleich losdiktieren.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("Name des Objekts — oder die ID, wenn es schon angelegt ist"),
      ...Object.fromEntries(
        EINRICHTUNG.map((e) => [e.feld, str(`Antwort auf: ${e.frage}`)]),
      ),
      intervall_monate: int("Prüfintervall in Monaten, Standard 12"),
      notizen: str("Was sonst noch wichtig ist"),
      ueberspringen: wortliste("Felder, die der Mensch nicht weiß und die nicht nachgefragt werden sollen"),
    },
    required: ["objekt"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const name = String(pflicht<string>(args, "objekt")).trim();

    /* Vorhandenes fortsetzen statt verdoppeln — der Assistent wird ja mehrfach gerufen. */
    let objekt = await objektSuchen(ctx.env.DB, name);
    let neu = false;
    if (!objekt) {
      objekt = await objektAnlegen(ctx.env.DB, {
        name,
        angelegt_von: ctx.nutzer.benutzer,
      });
      neu = true;
    }

    const patch: Record<string, unknown> = {};
    for (const feld of [...EINRICHTUNG.map((e) => e.feld), "notizen"]) {
      const wert = args[feld];
      if (wert !== undefined && String(wert).trim()) patch[feld] = String(wert).trim();
    }
    const intervall = Number(args.intervall_monate);
    if (Number.isFinite(intervall) && intervall > 0) patch.intervall_monate = intervall;
    if (Object.keys(patch).length) {
      objekt = (await objektAendern(ctx.env.DB, objekt.id, patch))!;
    }

    const uebersprungen = new Set(
      (Array.isArray(args.ueberspringen) ? args.ueberspringen : []).map((w: unknown) =>
        String(w).trim(),
      ),
    );
    const offen = EINRICHTUNG.filter(
      (e) => !String((objekt as any)[e.feld] ?? "").trim() && !uebersprungen.has(e.feld),
    );
    const naechste = offen[0] ?? null;
    const pflichtOffen = offen.filter((e) => e.pflicht);

    const bauteile = await bauteileMitStand(ctx.env.DB, objekt);
    const fertig = !naechste;

    return {
      objekt: objektAnsicht(objekt),
      neu_angelegt: neu,
      uebernommen: Object.keys(patch),
      fertig,
      naechste_frage: naechste
        ? { feld: naechste.feld, frage: naechste.frage, warum: naechste.warum, pflicht: naechste.pflicht }
        : null,
      noch_offen: offen.map((e) => e.feld),
      pflicht_offen: pflichtOffen.map((e) => e.feld),
      bestand: bauteile.length,
      weiter_mit: fertig
        ? bauteile.length
          ? ["begehung_starten — der Bestand steht, es kann losgehen"]
          : [
              "bauplan_uebernehmen — wenn ein Grundriss oder eine Türliste da ist",
              "begehung_starten — sonst legt die erste Begehung den Bestand an",
            ]
        : [],
      link: `${ctx.origin}/objekt/${objekt.id}`,
    };
  },
};

/** Die Textfelder eines Objekts, die überall gleich behandelt werden. */
const STAMMFELDER = [
  "name", "adresse", "plz", "betreiber", "betreiber_kontakt", "telefon", "email", "zugang",
  "vertrag", "objektart", "ident", "rechtsgrundlagen", "notizen",
] as const;

const objektAendernTool: ToolDef = {
  name: "objekt_aendern",
  title: "Objekt-Stammdaten ändern",
  description:
    "Ändert die Stammdaten eines Objekts. Nur die genannten Felder werden angefasst. Wirkt auf " +
    "künftige Berichte; bereits erzeugte Versionen bleiben, bei Bedarf neu erzeugen.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse"),
      name: str("Name des Objekts"),
      adresse: str("Straße, PLZ Ort"),
      plz: str("Postleitzahl"),
      betreiber: str("Betreiber, wie er aufs Protokoll gehört"),
      betreiber_kontakt: str("Ansprechpartner vor Ort — Name"),
      telefon: str("Durchwahl des Ansprechpartners"),
      email: str("E-Mail des Ansprechpartners"),
      zugang: str(
        "Wie kommt man rein? Etwa 'Schlüssel beim Hausmeister, Herr Kern 0171-…', 'Anmeldung " +
        "im Sekretariat', 'Codeschloss 1234'. Das Feld verhindert die vergebliche Anfahrt.",
      ),
      vertrag: str("Wartungsvertrag oder Auftragsnummer des Betreibers"),
      objektart: str("'Kita', 'Schule', 'Bürogebäude' …"),
      ident: str("Ident-Nummer des Betreibers"),
      intervall_monate: int("Prüfintervall in Monaten"),
      rechtsgrundlagen: str("Rechtsgrundlagen"),
      notizen: str("Freie Notizen"),
    },
    required: ["objekt"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const o = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const patch: Record<string, unknown> = {};
    for (const feld of STAMMFELDER) {
      if (args[feld] !== undefined) patch[feld] = String(args[feld]);
    }
    if (args.intervall_monate !== undefined) patch.intervall_monate = Number(args.intervall_monate);
    const neu = await objektAendern(ctx.env.DB, o.id, patch);
    return { objekt: objektAnsicht(neu!), geaendert: Object.keys(patch) };
  },
};

const bauteilAnlegenTool: ToolDef = {
  name: "bauteil_anlegen",
  title: "Bauteil anlegen",
  description:
    "Legt ein einzelnes Bauteil im Bestand an, ohne Import und ohne Begehung. Ohne 'nr' wird " +
    "die nächste freie Nummer des Objekts vergeben.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse"),
      art: str(`Vorlage: ${VORLAGEN_IDS.join(", ")}`),
      nr: int("Eigene Nummer, sonst die nächste freie"),
      kennung: str("Kennung aus Türliste/Plan, z. B. T-2.14"),
      geschoss: str("Name oder ID des Geschosses"),
      raumnummer: str("Raumnummer, z. B. 2.14 — treibt die Laufreihenfolge"),
      raum: str("Raumbezeichnung"),
      flur: str("Flur"),
      bezeichnung: str("Freier Name, z. B. 'Flur Ost zur Küche'"),
      felder: {
        type: "object",
        description: "Bauteilfelder als Schlüssel/Wert, z. B. {\"HERSTELLER\":\"Hörmann\"}",
        additionalProperties: { type: "string" },
      },
      wartungspflichtig: bool("false = im Bestand, aber nicht Teil der Wartung"),
    },
    required: ["objekt", "art"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const objekt = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const art = pflicht<string>(args, "art");
    vorlage(art);
    const geschossId = await geschossFinden(ctx, objekt, args.geschoss);
    const b = await bauteilAnlegen(ctx.env.DB, {
      objekt_id: objekt.id,
      art,
      nr: args.nr,
      kennung: args.kennung,
      geschoss_id: geschossId,
      raumnummer: args.raumnummer,
      raum: args.raum,
      flur: args.flur,
      bezeichnung: args.bezeichnung,
      felder: args.felder,
      wartungspflichtig: args.wartungspflichtig === false ? 0 : 1,
    });
    return {
      gespeichert: `Tür ${b.nr}`,
      bauteil: { nr: b.nr, kennung: b.kennung, art: b.art, raum: b.raum },
      naechste_nr: await naechsteNr(ctx.env.DB, objekt.id),
    };
  },
};

const bauteileAnlegenTool: ToolDef = {
  name: "bauteile_anlegen",
  title: "Mehrere Bauteile auf einmal anlegen",
  description:
    "Legt einen Stapel Bauteile im Bestand an — für eine gepflegte Türliste, die ohne " +
    "Bestätigungsschleife übernommen werden soll. Kommt die Liste aus einem Plan oder einer " +
    "Datei, die du selbst gelesen hast, ist 'import_starten' + 'vorschlaege_anlegen' der " +
    "richtige Weg: dort bestätigt ein Mensch, bevor Bauteile entstehen. " +
    "Nummern: die genannte, sonst die Kennung, wenn sie eine reine Zahl und frei ist, sonst " +
    "die nächste freie. Eine belegte Nummer wird übersprungen und gemeldet, nie überschrieben.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse"),
      art: str(`Vorlage für alle, sofern die Zeile keine eigene nennt: ${VORLAGEN_IDS.join(", ")}`),
      geschoss: str("Geschoss für alle, sofern die Zeile keines nennt — Name oder ID"),
      bauteile: {
        type: "array",
        description: "Die Bauteile, höchstens 200 je Aufruf.",
        items: {
          type: "object",
          properties: {
            nr: int("Eigene Nummer; ohne Angabe vergibt Türwerk sie"),
            kennung: str("Kennung aus Türliste oder Plan, z. B. T-2.14"),
            art: str("Eigene Vorlage für diese Zeile"),
            geschoss: str("Eigenes Geschoss für diese Zeile"),
            raumnummer: str("Raumnummer, z. B. 2.14 — treibt die Laufreihenfolge"),
            raum: str("Raumbezeichnung"),
            flur: str("Flur"),
            bezeichnung: str("Freier Name"),
            wartungspflichtig: bool("false = im Bestand, aber nicht Teil der Wartung"),
            intervall_monate: int("Eigenes Prüfintervall; ohne Angabe gilt das des Objekts"),
            felder: {
              type: "object",
              description: "Bauteilfelder: HERSTELLER, ZULASSUNG, OTS, ABSENKDICHTUNG …",
              additionalProperties: { type: "string" },
            },
          },
          additionalProperties: false,
        },
      },
    },
    required: ["objekt", "bauteile"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const objekt = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const eingaben = pflicht<Record<string, any>[]>(args, "bauteile");
    if (!Array.isArray(eingaben) || !eingaben.length) throw new Error("Keine Bauteile dabei.");
    if (eingaben.length > 200) {
      throw new Error(
        `${eingaben.length} Bauteile auf einmal sind zu viele. In Stapeln von höchstens 200.`,
      );
    }
    const standardArt = String(args.art ?? "") || (await haeufigsteArtImObjekt(ctx, objekt.id));
    vorlage(standardArt);

    /* Geschosse einmal auflösen, nicht je Zeile — sonst legt eine Tippfehler-Zeile eins an. */
    const geschossFuer = new Map<string, string | undefined>();
    const auflösen = async (wunsch: unknown) => {
      const schluessel = String(wunsch ?? "");
      if (!geschossFuer.has(schluessel)) {
        geschossFuer.set(schluessel, await geschossFinden(ctx, objekt, schluessel || args.geschoss));
      }
      return geschossFuer.get(schluessel);
    };

    const liste = [];
    for (const e of eingaben) {
      const art = String(e.art ?? "") || standardArt;
      vorlage(art);
      liste.push({
        art,
        nr: e.nr,
        kennung: e.kennung,
        geschoss_id: (await auflösen(e.geschoss)) ?? null,
        raumnummer: e.raumnummer,
        raum: e.raum,
        flur: e.flur,
        bezeichnung: e.bezeichnung,
        felder: e.felder,
        intervall_monate: e.intervall_monate ?? null,
        wartungspflichtig: e.wartungspflichtig === false ? 0 : 1,
        quelle: "tuerliste",
      });
    }
    const { angelegt, uebersprungen } = await bauteileAnlegen(ctx.env.DB, objekt.id, liste);
    return {
      angelegt: angelegt.length,
      bauteile: angelegt.map((b) => ({
        nr: b.nr,
        kennung: b.kennung || undefined,
        raum: b.raum || undefined,
      })),
      uebersprungen: uebersprungen.length ? uebersprungen : undefined,
      naechste_nr: await naechsteNr(ctx.env.DB, objekt.id),
      link: `${ctx.origin}/objekt/${objekt.id}`,
      hinweis: uebersprungen.length
        ? "Übersprungene Zeilen tragen eine belegte Nummer. Mit 'objekt_lesen' nachsehen, " +
          "was dort schon steht, und die Zeile ohne 'nr' erneut schicken."
        : undefined,
    };
  },
};

/** Die Art, die an diesem Objekt vorherrscht — Vorgabe für einen Stapel ohne eigene Angabe. */
async function haeufigsteArtImObjekt(ctx: Kontext, objektId: string): Promise<string> {
  const zeile = await ctx.env.DB.prepare(
    "SELECT art, COUNT(*) AS n FROM bauteile WHERE objekt_id = ? GROUP BY art ORDER BY n DESC LIMIT 1",
  )
    .bind(objektId)
    .first<{ art: string }>();
  return zeile?.art ?? "wartung_drehfluegel";
}

const bauteilAendernTool: ToolDef = {
  name: "bauteil_aendern",
  title: "Bauteil ändern",
  description:
    "Schreibt Stammdaten eines Bauteils fort oder legt es still. 'felder' wird gemischt, nicht " +
    "ersetzt: ein leerer Wert entfernt ein Feld. 'aktiv: false' heißt ausgebaut — das Bauteil " +
    "bleibt für die Historie, ist aber nicht mehr fällig.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse"),
      nr: int("Nummer des Bauteils"),
      kennung: str("Alternativ: Kennung"),
      neue_kennung: str("Kennung setzen oder ändern"),
      art: str(`Vorlage wechseln: ${VORLAGEN_IDS.join(", ")}`),
      geschoss: str("Name oder ID des Geschosses"),
      raumnummer: str("Raumnummer"),
      raum: str("Raumbezeichnung"),
      flur: str("Flur"),
      bezeichnung: str("Freier Name"),
      felder: {
        type: "object",
        description: "Bauteilfelder als Schlüssel/Wert; leerer Wert entfernt das Feld.",
        additionalProperties: { type: "string" },
      },
      intervall_monate: int("Eigenes Prüfintervall; 0 = Objektintervall"),
      wartungspflichtig: bool("false = nicht Teil der Wartung"),
      aktiv: bool("false = stillgelegt/ausgebaut"),
    },
    required: ["objekt"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const objekt = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const b = await holeBauteil(ctx, objekt, args);
    const patch: Record<string, unknown> = {};
    if (args.neue_kennung !== undefined) patch.kennung = String(args.neue_kennung);
    if (args.art !== undefined) {
      vorlage(String(args.art));
      patch.art = String(args.art);
    }
    for (const feld of ["raumnummer", "raum", "flur", "bezeichnung"]) {
      if (args[feld] !== undefined) patch[feld] = String(args[feld]);
    }
    if (args.geschoss !== undefined) {
      patch.geschoss_id = await geschossFinden(ctx, objekt, args.geschoss);
    }
    if (args.felder !== undefined) patch.felder = args.felder;
    if (args.intervall_monate !== undefined) {
      patch.intervall_monate = Number(args.intervall_monate) || null;
    }
    if (args.wartungspflichtig !== undefined) {
      patch.wartungspflichtig = args.wartungspflichtig ? 1 : 0;
    }
    if (args.aktiv !== undefined) patch.aktiv = args.aktiv ? 1 : 0;
    const neu = await bauteilAendern(ctx.env.DB, b.id, patch);
    return {
      gespeichert: `Tür ${neu!.nr}`,
      geaendert: Object.keys(patch),
      bauteil: { nr: neu!.nr, kennung: neu!.kennung, art: neu!.art, aktiv: neu!.aktiv === 1 },
    };
  },
};

/** Geschoss über Name oder ID finden; ein unbekannter Name wird angelegt. */
async function geschossFinden(
  ctx: Kontext,
  objekt: Objekt,
  wunsch: unknown,
): Promise<string | undefined> {
  if (wunsch === undefined || wunsch === null || wunsch === "") return undefined;
  const text = String(wunsch).trim();
  const geschosse = await geschosseListe(ctx.env.DB, objekt.id);
  const treffer =
    geschosse.find((g) => g.id === text) ??
    geschosse.find((g) => g.name.toLowerCase() === text.toLowerCase());
  if (treffer) return treffer.id;
  const { geschossAnlegen } = await import("../daten/objekte");
  const neu = await geschossAnlegen(ctx.env.DB, objekt.id, text);
  return neu.id;
}

/* ── Schreiben: Begehung ───────────────────────────────────────────────────── */

const begehungStarten: ToolDef = {
  name: "begehung_starten",
  title: "Begehung starten",
  description:
    "Startet einen Termin an einem Objekt — einmal je Begehung. Das Objekt darf als ID, Name " +
    "oder Adresse angegeben werden; kennt der Server es nicht, wird es angelegt: die erste " +
    "Begehung ist die Bestandsaufnahme. Läuft am selben Objekt und Tag schon eine Begehung, " +
    "wird sie fortgesetzt statt verdoppelt. Die Antwort nennt die fälligen Bauteile in " +
    "Laufreihenfolge und was an ihnen noch offen ist.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse des Objekts"),
      datum: str("Prüfdatum YYYY-MM-DD, Standard heute"),
      pruefer: str("Name des Prüfers"),
      befaehigung: str("Befähigungsnachweis"),
      ort: str("Prüfort/Stadt"),
      beteiligte: str("Beteiligte Personen / Messgeräte"),
      adresse: str("Adresse, falls das Objekt neu angelegt wird"),
      betreiber: str("Betreiber, falls das Objekt neu angelegt wird"),
      art_vorgabe: str(`Vorlage für neue Bauteile: ${VORLAGEN_IDS.join(", ")}`),
    },
    required: ["objekt"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const person = await personLesen(ctx.env.DB, ctx.nutzer.benutzer);
    const v = person?.vorgaben ?? {};
    const datum = args.datum || heute();

    let objekt = await objektSuchen(ctx.env.DB, pflicht<string>(args, "objekt"));
    let objektNeu = false;
    if (!objekt) {
      objekt = await objektAnlegen(ctx.env.DB, {
        name: String(args.objekt).trim(),
        adresse: args.adresse ?? "",
        betreiber: args.betreiber ?? "",
        angelegt_von: ctx.nutzer.benutzer,
      });
      objektNeu = true;
    }
    zugriffPruefen(ctx.nutzer.benutzer, objekt.id);

    /* Gespräch abgebrochen? Dieselbe Begehung fortsetzen statt eine zweite anzulegen. */
    const { begehung, fortgesetzt } = await begehungFuerTag(ctx.env.DB, objekt.id, datum, {
      pruefer: args.pruefer ?? v.pruefer ?? ctx.nutzer.name,
      befaehigung: args.befaehigung ?? v.befaehigung,
      ort: args.ort ?? v.ort,
      beteiligte: args.beteiligte,
      angelegt_von: ctx.nutzer.benutzer,
    });

    if (args.art_vorgabe) vorlage(String(args.art_vorgabe));

    const geschosse = await geschosseListe(ctx.env.DB, objekt.id);
    const bauteile = inLaufreihenfolge(
      await bauteileMitStand(ctx.env.DB, objekt),
      geschosse,
    );
    const faellige = bauteile.filter(istFaellig);
    const offeneMaengel = await maengelListe(ctx.env.DB, { objekt_id: objekt.id, status: "offen" });

    return {
      begehung: begehungAnsicht(begehung),
      fortgesetzt,
      objekt: objektAnsicht(objekt),
      objekt_neu_angelegt: objektNeu,
      link: `${ctx.origin}/objekt/${begehung.objekt_id}`,
      checkliste: `${ctx.origin}/objekt/${begehung.objekt_id}/checkliste`,
      bauteile_gesamt: bauteile.length,
      faellige_bauteile: faellige.map((b) => ({
        nr: b.nr,
        kennung: b.kennung || undefined,
        ort: [b.raumnummer, b.raum, b.flur].filter(Boolean).join(" · ") || undefined,
        faellig_am: b.stand.faellig_am || "sofort",
        offene_maengel: b.offene_maengel,
      })),
      offene_maengel: offeneMaengel.map((m) => ({
        ...mangelAnsicht(m),
        bauteil_nr: m.bauteil_nr,
      })),
      naechste_nr: await naechsteNr(ctx.env.DB, objekt.id),
      hinweis: objektNeu
        ? "Neues Objekt — diese Begehung ist die Bestandsaufnahme. Jede diktierte Tür legt ein Bauteil an."
        : undefined,
    };
  },
};

const begehungAendernTool: ToolDef = {
  name: "begehung_aendern",
  title: "Begehung ändern",
  description:
    "Ändert die Stammdaten oder den Status einer Begehung. Nur die genannten Felder werden " +
    "angefasst. 'status: laufend' nimmt einen Abschluss zurück.",
  inputSchema: {
    type: "object",
    properties: {
      begehung: str("Kennung der Begehung oder Name des Objekts"),
      datum: str("Prüfdatum YYYY-MM-DD"),
      pruefer: str("Name des Prüfers"),
      befaehigung: str("Befähigungsnachweis"),
      ort: str("Prüfort/Stadt"),
      beteiligte: str("Beteiligte Personen / Messgeräte"),
      status: str("geplant | laufend | abgeschlossen | abgebrochen"),
    },
    required: ["begehung"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const begehung = await holeBegehung(ctx, pflicht<string>(args, "begehung"));
    const patch: Record<string, string> = {};
    for (const feld of ["datum", "pruefer", "befaehigung", "ort", "beteiligte", "status"]) {
      if (args[feld] !== undefined) patch[feld] = String(args[feld]);
    }
    const neu = await begehungAendern(ctx.env.DB, begehung.id, patch);
    return { begehung: begehungAnsicht(neu!), geaendert: Object.keys(patch) };
  },
};

const PRUEFUNG_FELDER = {
  nr: int("Nummer des Bauteils, wie diktiert ('Tür 12'). Unbekannte Nummer legt das Bauteil an."),
  kennung: str("Alternativ die Kennung aus Türliste/Plan, z. B. T-2.14"),
  art: str(`Vorlage, falls das Bauteil neu angelegt wird: ${VORLAGEN_IDS.join(", ")}`),
  wie_davor: bool(
    "true, wenn der Monteur 'wie davor' oder 'alles gleich außer …' sagt: Felder, Bewertungen " +
      "und Ergebnis der zuletzt erfassten Prüfung werden übernommen und nur die genannten " +
      "überschrieben. Standard false.",
  ),
  felder: {
    type: "object",
    description:
      "Felder, die je Bauteil abweichen, als Schlüssel/Wert — z. B. {\"ETAGE\":\"2\",\"RAUM\":\"Flur Ost\"}. " +
      "Welche Schlüssel die Vorlage kennt, sagt 'pruefpunkte'. Sie werden aufs Bauteil " +
      "geschrieben und gelten damit auch im nächsten Jahr.",
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
  raumnummer: str("Raumnummer, z. B. 2.14"),
  raum: str("Raumbezeichnung"),
  flur: str("Flur"),
  geschoss: str(
    "Etage, z. B. 'EG', '1. OG', 'UG'. Nur nötig, wenn sie weder in der Raumnummer ('1.04') " +
    "noch im Feld ETAGE steckt — sonst erkennt der Server sie selbst.",
  ),
  prioritaet: str(
    "Einstufung eines dabei entstehenden Mangels: hoch | mittel | niedrig. Danach richtet sich " +
    "die Frist (7 / 28 / 90 Tage). Ohne Angabe 'mittel'. Setz sie aus dem, was der Monteur " +
    "sagt — eine Brandschutztür, die nicht schließt, ist 'hoch'; eine spröde Dichtung 'mittel'; " +
    "eine Schramme im Lack 'niedrig'.",
  ),
  zustaendig: str(
    "Wer den Mangel behebt: 'Seehafer' (Standard) oder 'Betreiber' — oder ein Name, wenn der " +
    "Monteur einen nennt.",
  ),
  neu: bool("false verbietet das Anlegen eines unbekannten Bauteils"),
};

const pruefungErfassenTool: ToolDef = {
  name: "pruefung_erfassen",
  title: "Prüfung erfassen",
  description:
    "Schreibt die Prüfung eines Bauteils sofort in die Datenbank — nach jeder diktierten Tür " +
    "genau einmal aufrufen und kurz quittieren ('Tür 3 gespeichert'). Eine bereits geprüfte " +
    "Nummer wird überschrieben, das ist der Weg für Korrekturen. Ist die Nummer am Objekt " +
    "unbekannt, wird das Bauteil angelegt ('Tür 12 ist neu — lege ich an'). Kommt " +
    "'offene_maengel_vorjahr' zurück, vorlesen und nachfragen; bestätigt der Monteur die " +
    "Behebung, 'mangel_schliessen' aufrufen.",
  inputSchema: {
    type: "object",
    properties: { begehung: str("Kennung der Begehung"), ...PRUEFUNG_FELDER },
    required: ["begehung"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const begehung = await holeBegehung(ctx, pflicht<string>(args, "begehung"));
    const objekt = (await objektLesen(ctx.env.DB, begehung.objekt_id))!;
    const e = await pruefungErfassen(ctx.env.DB, objekt, begehung, args, ctx.nutzer.benutzer);
    return erfassungsAntwort(e, objekt);
  },
};

const pruefungenErfassenTool: ToolDef = {
  name: "pruefungen_erfassen",
  title: "Mehrere Prüfungen auf einmal erfassen",
  description:
    "Mehrere Bauteile in einem Aufruf — für Serien gleicher Türen oder wenn ein Diktat " +
    "nachträglich gebündelt übertragen wird. Reihenfolge zählt: 'wie_davor' bezieht sich auf " +
    "die jeweils vorige Zeile.",
  inputSchema: {
    type: "object",
    properties: {
      begehung: str("Kennung der Begehung"),
      pruefungen: {
        type: "array",
        description: "Liste von Prüfungen, gleiche Felder wie bei pruefung_erfassen.",
        items: { type: "object", properties: PRUEFUNG_FELDER, additionalProperties: false },
      },
    },
    required: ["begehung", "pruefungen"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const begehung = await holeBegehung(ctx, pflicht<string>(args, "begehung"));
    const objekt = (await objektLesen(ctx.env.DB, begehung.objekt_id))!;
    const eingaben = pflicht<Record<string, any>[]>(args, "pruefungen");
    const geschrieben: number[] = [];
    const neu: number[] = [];
    const vorjahr: unknown[] = [];
    for (const e of eingaben) {
      const r = await pruefungErfassen(ctx.env.DB, objekt, begehung, e, ctx.nutzer.benutzer);
      geschrieben.push(r.bauteil.nr);
      if (r.neu_angelegt) neu.push(r.bauteil.nr);
      for (const m of r.offene_maengel_vorjahr) {
        vorjahr.push({ bauteil_nr: r.bauteil.nr, ...mangelAnsicht(m) });
      }
    }
    return {
      gespeichert: geschrieben.length,
      bauteile: geschrieben,
      neu_angelegt: neu,
      offene_maengel_vorjahr: vorjahr,
      naechste_nr: await naechsteNr(ctx.env.DB, objekt.id),
    };
  },
};

/**
 * Ortsangabe in einer Zeile, ohne Doppelung. Der Monteur diktiert die Etage oft auch in `flur`;
 * dann stünde sie sonst zweimal da („EG · 0.01 · Haupteingang · EG").
 */
function ortText(
  geschoss: string,
  b: { raumnummer: string; raum: string; bezeichnung: string; flur: string },
): string {
  const teile: string[] = [];
  const gesehen = new Set<string>();
  for (const t of [geschoss, b.raumnummer, b.raum || b.bezeichnung, b.flur]) {
    const schluessel = t.trim().toLowerCase().replace(/[\s.]/g, "");
    if (!schluessel || gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    teile.push(t.trim());
  }
  return teile.join(" · ");
}

function erfassungsAntwort(
  e: Awaited<ReturnType<typeof pruefungErfassen>>,
  objekt: Objekt,
) {
  return {
    gespeichert: `Tür ${e.bauteil.nr}`,
    neu_angelegt: e.neu_angelegt,
    bauteil: {
      nr: e.bauteil.nr,
      kennung: e.bauteil.kennung || undefined,
      art: e.bauteil.art,
      tuertyp: e.tuertyp?.name,
      /* Die erkannte Etage steht mit im Ort — dann kann Claude sie zurückquittieren. */
      ort: ortText(e.geschoss?.name ?? "", e.bauteil) || undefined,
      geschoss: e.geschoss?.name || undefined,
      felder: e.bauteil.felder,
    },
    ergebnis: e.pruefung.ergebnis,
    abweichungen: abweichungenKlartext(e.bauteil.art, e.pruefung.checks, e.tuertyp?.punkte),
    mangel_angelegt: e.mangel ? mangelAnsicht(e.mangel) : undefined,
    offene_maengel_vorjahr: e.offene_maengel_vorjahr.map((m) => ({
      ...mangelAnsicht(m),
      seit: new Date(m.angelegt_am).toISOString().slice(0, 10),
    })),
    naechste_nr: e.naechste_nr,
    objekt: objekt.name,
  };
}

/* ── Schreiben: Mängel ─────────────────────────────────────────────────────── */



const mangelSchliessenTool: ToolDef = {
  name: "mangel_schliessen",
  title: "Mangel freimelden",
  description:
    "Meldet einen Mangel frei ('Dichtung ist getauscht'). Mit 'mangel' genau einen, mit " +
    "'objekt' + 'nr' alle offenen Mängel dieses Bauteils. Der Regelweg beim Diktat: der " +
    "Monteur bestätigt, dass ein Mangel aus dem Vorjahr behoben ist.",
  inputSchema: {
    type: "object",
    properties: {
      mangel: str("ID des Mangels"),
      objekt: str("Alternativ: ID, Name oder Adresse des Objekts"),
      nr: int("Nummer des Bauteils"),
      kennung: str("Alternativ: Kennung"),
      freimeldung: str("Was wurde gemacht?"),
    },
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const freimeldung = String(args.freimeldung ?? "");
    if (args.mangel) {
      const vorher = await mangelLesen(ctx.env.DB, String(args.mangel));
      if (!vorher) throw new Error(`Mangel '${args.mangel}' gibt es nicht.`);
      zugriffPruefen(ctx.nutzer.benutzer, vorher.objekt_id);
      const m = await mangelSchliessen(
        ctx.env.DB, vorher.id, freimeldung, ctx.nutzer.benutzer,
      );
      return { geschlossen: 1, maengel: [mangelAnsicht(m!)] };
    }
    const objekt = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const b = await holeBauteil(ctx, objekt, args);
    const offene = await maengelZuBauteil(ctx.env.DB, b.id, true);
    const out = [];
    for (const m of offene) {
      out.push(
        mangelAnsicht((await mangelSchliessen(ctx.env.DB, m.id, freimeldung, ctx.nutzer.benutzer))!),
      );
    }
    return {
      geschlossen: out.length,
      bauteil_nr: b.nr,
      maengel: out,
      hinweis: out.length ? undefined : `An Tür ${b.nr} war nichts offen.`,
    };
  },
};

/* ── Schreiben: Abschluss und Berichte ─────────────────────────────────────── */

/** Der Rückblick: was wurde geprüft, was weicht ab, was fehlt noch. */
async function rueckblick(ctx: Kontext, begehung: Begehung) {
  const objekt = (await objektLesen(ctx.env.DB, begehung.objekt_id))!;
  const geschosse = await geschosseListe(ctx.env.DB, objekt.id);
  const pruefungen = await pruefungenLesen(ctx.env.DB, begehung.id);
  const bauteile = inLaufreihenfolge(await bauteileMitStand(ctx.env.DB, objekt), geschosse);
  const geprueft = new Set(pruefungen.map((p) => p.bauteil_id));
  const fehlend = bauteile.filter((b) => istFaellig(b) && !geprueft.has(b.id));
  const reihenfolge = new Map(bauteile.map((b, i) => [b.id, i]));

  return {
    begehung: begehungAnsicht(begehung),
    objekt: objektAnsicht(objekt),
    link: `${ctx.origin}/objekt/${begehung.objekt_id}`,
    pruefungen_gesamt: pruefungen.length,
    mit_abweichungen: pruefungen.filter((p) => Object.keys(p.checks).length).length,
    nachbesserung: pruefungen.filter((p) => p.ergebnis === "Nachbesserung").length,
    rueckblick: pruefungen
      .sort((a, b) => (reihenfolge.get(a.bauteil_id) ?? 0) - (reihenfolge.get(b.bauteil_id) ?? 0))
      .map((p) => ({
        nr: p.bauteil.nr,
        ort:
          [p.bauteil.raumnummer, p.bauteil.raum, p.bauteil.flur].filter(Boolean).join(" · ") ||
          undefined,
        ergebnis: p.ergebnis,
        abweichungen: abweichungenKlartext(p.bauteil.art, p.checks),
        hinweise: p.hinweise || undefined,
      })),
    fehlende_faellige_bauteile: fehlend.map((b) => ({
      nr: b.nr,
      ort: [b.raumnummer, b.raum, b.flur].filter(Boolean).join(" · ") || undefined,
      faellig_am: b.stand.faellig_am || "sofort",
    })),
  };
}

const begehungAbschliessen: ToolDef = {
  name: "begehung_abschliessen",
  title: "Begehung abschließen und Berichte erzeugen",
  description:
    "Schließt die Erfassung ab UND erzeugt gleich die Berichte — ein Aufruf statt drei. Liest " +
    "zuerst alles zurück (je Bauteil Ort, Abweichungen im Klartext, Ergebnis) und nennt die " +
    "fälligen Bauteile, die noch fehlen ('3 Türen im 2. OG fehlen noch — absichtlich?'). " +
    "Danach entstehen die Einzelberichte und, sobald keiner mehr offen ist, der Sammelbericht. " +
    "Kommt 'fertig: false' zurück, reichte die Rechenzeit nicht: einfach noch einmal aufrufen. " +
    "Erzeugt wird nur, wo sich etwas geändert hat — zweimal aufrufen macht keine zweite " +
    "Version. Mit berichte=false nur abschließen. Rücknehmbar über 'begehung_aendern' mit " +
    "status=laufend.",
  inputSchema: {
    type: "object",
    properties: {
      begehung: str("Kennung der Begehung oder Name des Objekts"),
      berichte: bool("false schließt nur ab, ohne Berichte zu erzeugen. Standard true."),
      alle_neu: bool("true erzwingt eine neue Version aller Berichte. Standard false."),
    },
    required: ["begehung"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const begehung = await holeBegehung(ctx, pflicht<string>(args, "begehung"));
    const neu = (await begehungAendern(ctx.env.DB, begehung.id, { status: "abgeschlossen" }))!;
    const zurueck = await rueckblick(ctx, neu);
    if (args.berichte === false) return zurueck;
    /* Ein Termin ohne Prüfung hat nichts zu berichten — das ist kein Fehler, nur nichts zu tun. */
    if (!(await pruefungenLesen(ctx.env.DB, neu.id)).length) {
      return { ...zurueck, berichte: { erzeugt: 0, offen: 0, fertig: true }, sammelbericht: null };
    }

    /*
     * Der Abschluss ist ein Vorgang, kein Dreisprung. Früher musste der Agent danach noch
     * 'berichte_erzeugen' (mehrfach, bis fertig) und 'sammelbericht_erzeugen' rufen — drei
     * Aufrufe für eine Absicht. Jetzt läuft das hier mit, im selben Zeitbudget wie zuvor.
     */
    const lauf = await berichteErzeugen(ctx.env, neu.id, {
      alle: args.alle_neu === true,
      nutzer: ctx.nutzer.benutzer,
    });
    let sammel: { version: number; link: string } | null = null;
    if (lauf.fertig) {
      const sb = await sammelberichtErzeugen(ctx.env, neu.id, ctx.nutzer.benutzer);
      sammel = { version: sb.version, link: `${ctx.origin}/datei/${sb.schluessel}` };
    }
    return {
      ...zurueck,
      berichte: {
        erzeugt: lauf.erzeugt,
        offen: lauf.offen,
        fertig: lauf.fertig,
        hinweis: lauf.fertig
          ? undefined
          : "Rechenzeit war knapp — 'begehung_abschliessen' noch einmal aufrufen.",
      },
      sammelbericht: sammel,
      alle_als_zip: lauf.fertig ? `${ctx.origin}/begehung/${neu.id}/paket.zip` : undefined,
    };
  },
};

const begehungAbbrechenTool: ToolDef = {
  name: "begehung_abbrechen",
  title: "Begehung abbrechen",
  description:
    "Bricht einen Termin ab — der Monteur wird weggerufen, das Objekt war das falsche, der " +
    "Termin platzt. Hängt noch keine Prüfung daran, verschwindet die Begehung ganz. Hängen " +
    "Prüfungen daran, bleiben sie erhalten und die Begehung geht auf 'abgebrochen'; über " +
    "'begehung_aendern' mit status=laufend ist das zurückzunehmen.",
  inputSchema: {
    type: "object",
    properties: { begehung: str("Kennung der Begehung oder Name des Objekts") },
    required: ["begehung"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const begehung = await holeBegehung(ctx, pflicht<string>(args, "begehung"));
    const objekt = await objektLesen(ctx.env.DB, begehung.objekt_id);
    const e = await begehungAbbrechen(ctx.env.DB, begehung.id);
    return {
      abgebrochen: true,
      geloescht: e.geloescht,
      erhaltene_pruefungen: e.pruefungen,
      objekt: objekt?.name,
      hinweis: e.geloescht
        ? "Die Begehung war leer und ist weg."
        : `${e.pruefungen} bereits erfasste ${e.pruefungen === 1 ? "Prüfung bleibt" : "Prüfungen bleiben"} erhalten.`,
    };
  },
};

const berichteErzeugenTool: ToolDef = {
  name: "berichte_erzeugen",
  title: "Berichte erzeugen",
  description:
    "Füllt für jede Prüfung die Vorlage aus und legt das PDF ab. Erzeugt wird nur, wo sich seit " +
    "der letzten Version etwas geändert hat — zweimal hintereinander aufgerufen entsteht keine " +
    "zweite Version. Läuft in Stücken: kommt 'fertig: false' zurück, einfach erneut aufrufen.",
  inputSchema: {
    type: "object",
    properties: {
      begehung: str("Kennung der Begehung oder Name des Objekts"),
      alle_neu: bool("true erzeugt für jede Prüfung eine neue Version"),
    },
    required: ["begehung"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const begehung = await holeBegehung(ctx, pflicht<string>(args, "begehung"));
    const lauf = await berichteErzeugen(ctx.env, begehung.id, {
      alle: args.alle_neu === true,
      nutzer: ctx.nutzer.benutzer,
    });
    return {
      ...lauf,
      link: `${ctx.origin}/objekt/${begehung.objekt_id}/berichte`,
      alle_als_zip: lauf.fertig
        ? `${ctx.origin}/begehung/${begehung.id}/paket.zip`
        : undefined,
    };
  },
};

const sammelberichtErzeugenTool: ToolDef = {
  name: "sammelbericht_erzeugen",
  title: "Sammelbericht erzeugen",
  description:
    "Deckblatt mit allen geprüften Bauteilen plus die neuesten Einzelberichte in einem PDF — " +
    "das Dokument für den Betreiber. Vorher 'berichte_erzeugen' laufen lassen.",
  inputSchema: {
    type: "object",
    properties: { begehung: str("Kennung der Begehung oder Name des Objekts") },
    required: ["begehung"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const begehung = await holeBegehung(ctx, pflicht<string>(args, "begehung"));
    const s = await sammelberichtErzeugen(ctx.env, begehung.id, ctx.nutzer.benutzer);
    return {
      version: s.version,
      seiten: s.seiten,
      enthaltene_berichte: s.berichte,
      link: `${ctx.origin}/datei/${s.schluessel}`,
    };
  },
};




const vorgabenSpeichern: ToolDef = {
  name: "vorgaben_speichern",
  title: "Eigene Vorgaben speichern",
  description:
    "Speichert die Standardwerte des angemeldeten Nutzers dauerhaft. Sie füllen künftige " +
    "Begehungen vor, sodass Prüfer, Befähigungsnachweis, Rechtsgrundlagen und Ort nicht jedes " +
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

/* ── Lagebild ──────────────────────────────────────────────────────────────── */

/**
 * Alles, was liegen geblieben ist, in einem Aufruf.
 *
 * Vorher brauchte „was ist zu tun?" vier Abfragen — `faellig`, `maengel_auflisten`, je Objekt
 * `berichte_auflisten` und ein Blick auf hängende Termine — und der Agent musste daraus selbst
 * einen Plan bauen. Das ist Arbeit, die der Server billiger erledigt: er rechnet ohnehin mit
 * diesen Zahlen. `naechste_schritte` nennt zu jedem Punkt gleich das Tool, das ihn erledigt,
 * damit Claude handeln kann statt zu recherchieren.
 */
const lageTool: ToolDef = {
  name: "lage",
  title: "Was ist zu tun?",
  description:
    "Das Lagebild in einem Aufruf: überfällige und bald fällige Objekte, Mängel über ihrer " +
    "Frist, Berichte die noch ausstehen oder nicht mehr dem Stand entsprechen, und Termine die " +
    "offen hängen. Dazu 'naechste_schritte' " +
    "— konkrete Vorschläge mit dem Tool, das sie erledigt. Das ist die Antwort auf 'was ist " +
    "los?', 'was steht an?' oder 'womit fange ich an?'. Ersetzt den Rundruf über 'faellig', " +
    "'maengel_auflisten' und 'berichte_auflisten'.",
  inputSchema: {
    type: "object",
    properties: { tage: int("Vorlauf für 'bald fällig' in Tagen, Standard 30") },
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const tage = Math.min(Math.max(Number(args.tage ?? 30), 1), 365);
    const heuteIso = heute();
    const grenze = new Date(Date.now() + tage * 86_400_000).toISOString().slice(0, 10);

    const objekte = await objekteListe(ctx.env.DB, { limit: 500 });
    const ueberfaellig = objekte.filter(
      (o) => o.stand.zustand === "ueberfaellig" || o.stand.nie_geprueft,
    );
    const bald = objekte.filter(
      (o) =>
        o.stand.zustand !== "ueberfaellig" &&
        !o.stand.nie_geprueft &&
        o.stand.faellig_am &&
        o.stand.faellig_am <= grenze,
    );

    /* Mängel über ihrer Frist — die kippen still, wenn niemand hinsieht. */
    const maengel = await maengelListe(ctx.env.DB, { status: "offen", limit: 500 });
    const ueberFrist = maengel.filter((m) => m.frist && m.frist < heuteIso);

    /*
     * Ausstehende Berichte ohne PDF-Arbeit zählen: eine Prüfung ohne Bericht-Zeile ist offen.
     * Veraltete Versionen bleiben hier außen vor — die erkennt erst der Stand-Hash, und dafür
     * lohnt der Aufwand in einer Übersicht nicht.
     */
    const { results: offeneBerichte } = await ctx.env.DB.prepare(
      `SELECT b.id, b.objekt_id, b.datum, o.name AS objekt_name, b.status,
              COUNT(p.id) AS pruefungen,
              SUM(CASE WHEN r.id IS NULL THEN 1 ELSE 0 END) AS ohne_bericht
         FROM begehungen b
         JOIN objekte o ON o.id = b.objekt_id
         JOIN pruefungen p ON p.begehung_id = b.id
         LEFT JOIN berichte r ON r.pruefung_id = p.id
        WHERE b.status != 'abgebrochen'
        GROUP BY b.id
       HAVING ohne_bericht > 0
        ORDER BY b.datum DESC
        LIMIT 50`,
    ).all<{
      id: string;
      objekt_id: string;
      datum: string;
      objekt_name: string;
      status: string;
      pruefungen: number;
      ohne_bericht: number;
    }>();

    /*
     * Veraltete Berichte: beim Kunden liegt dann ein PDF, das nicht mehr dem Stand entspricht —
     * der stillste Fehler, den diese Anwendung machen kann. Zweistufig, damit es billig bleibt:
     * erst per Zeitstempel die Verdächtigen suchen (etwas wurde nach dem letzten Erzeugen
     * geändert), dann nur bei denen den Stand-Hash rechnen, der es genau weiß.
     */
    const { results: verdaechtig } = await ctx.env.DB.prepare(
      `SELECT b.id, b.objekt_id, b.datum, o.name AS objekt_name
         FROM begehungen b
         JOIN objekte o ON o.id = b.objekt_id
         JOIN pruefungen p ON p.begehung_id = b.id
         JOIN berichte r ON r.pruefung_id = p.id
        WHERE b.status != 'abgebrochen'
        GROUP BY b.id
       HAVING MAX(MAX(p.geaendert_am), b.geaendert_am) > MAX(r.erzeugt_am)
        ORDER BY b.datum DESC
        LIMIT 20`,
    ).all<{ id: string; objekt_id: string; datum: string; objekt_name: string }>();

    const veraltet: { begehung_id: string; objekt: string; datum: string; berichte: number }[] = [];
    for (const v of verdaechtig ?? []) {
      const b = await begehungLesen(ctx.env.DB, v.id);
      const o = b ? await objektLesen(ctx.env.DB, b.objekt_id) : null;
      if (!b || !o) continue;
      const anzahl = (await berichtsUebersicht(ctx.env, b, o)).filter((p) => p.veraltet).length;
      if (anzahl) {
        veraltet.push({
          begehung_id: v.id,
          objekt: v.objekt_name,
          datum: v.datum,
          berichte: anzahl,
        });
      }
    }

    /* Termine, an denen etwas erfasst wurde, die aber seit gestern offen hängen. */
    const haengend = (offeneBerichte ?? []).filter(
      (b) => b.status !== "abgeschlossen" && b.datum < heuteIso,
    );

    const schritte: { was: string; womit: string; wo?: string }[] = [];
    for (const b of (offeneBerichte ?? []).slice(0, 10)) {
      schritte.push({
        was: `${b.objekt_name} (${b.datum}): ${b.ohne_bericht} von ${b.pruefungen} Prüfungen ohne Bericht`,
        womit: "begehung_abschliessen",
        wo: b.id,
      });
    }
    for (const v of veraltet.slice(0, 10)) {
      schritte.push({
        was: `${v.objekt} (${v.datum}): ${v.berichte} ${
          v.berichte === 1 ? "Bericht ist" : "Berichte sind"
        } nicht mehr auf dem Stand`,
        womit: "begehung_abschliessen",
        wo: v.begehung_id,
      });
    }
    for (const m of ueberFrist.slice(0, 10)) {
      schritte.push({
        was: `${m.objekt_name}, Tür ${m.bauteil_nr}: Frist ${m.frist} verstrichen — ${
          m.beschreibung || "ohne Beschreibung"
        }`,
        womit: "mangel_schliessen",
        wo: m.id,
      });
    }

    const kurz = schritte.length
      ? `${schritte.length} ${schritte.length === 1 ? "Sache" : "Sachen"} offen.`
      : "Nichts liegt an.";

    return {
      stand: heuteIso,
      zusammenfassung:
        `${kurz} ${ueberfaellig.length} überfällig, ${bald.length} in ${tage} Tagen fällig, ` +
        `${ueberFrist.length} Mängel über der Frist, ${(offeneBerichte ?? []).length} Termine ` +
        `mit ausstehenden Berichten, ${veraltet.length} mit veralteten.`,
      ueberfaellig: ueberfaellig.map(objektZeile),
      bald_faellig: bald.map(objektZeile),
      maengel_ueber_frist: ueberFrist.slice(0, 30).map((m) => ({
        id: m.id,
        objekt: m.objekt_name,
        bauteil_nr: m.bauteil_nr,
        frist: m.frist,
        beschreibung: m.beschreibung,
        zustaendig: m.zustaendig,
      })),
      berichte_veraltet: veraltet,
      berichte_ausstehend: (offeneBerichte ?? []).map((b) => ({
        begehung_id: b.id,
        objekt: b.objekt_name,
        datum: b.datum,
        status: b.status,
        ohne_bericht: Number(b.ohne_bericht),
        von: Number(b.pruefungen),
      })),
      termine_offen: haengend.map((b) => ({
        begehung_id: b.id,
        objekt: b.objekt_name,
        datum: b.datum,
      })),
      naechste_schritte: schritte,
    };
  },
};

/** Eine Objektzeile im Lagebild — knapp genug, dass 500 davon nicht das Fenster sprengen. */
function objektZeile(o: {
  id: string;
  name: string;
  adresse: string;
  plz: string;
  faellige_bauteile: number;
  bauteile: number;
  offene_maengel: number;
  stand: { faellig_am: string; zustand: string; nie_geprueft: boolean };
}) {
  return {
    id: o.id,
    name: o.name,
    adresse: o.adresse,
    plz: o.plz,
    faellige_bauteile: o.faellige_bauteile,
    bauteile: o.bauteile,
    offene_maengel: o.offene_maengel,
    faellig_am: o.stand.nie_geprueft ? "nie geprüft" : o.stand.faellig_am,
  };
}

export const TOOLS: ToolDef[] = [
  ...TUERTYP_TOOLS,
  lageTool,
  objekteAuflisten,
  objektLesenTool,
  bauteilLesenTool,
  faellig,
  begehungLesenTool,
  berichteAuflisten,
  pruefpunkte,
  vorlagenAuflisten,
  vorgabenLesen,
  objektEinrichtenTool,
  objektAnlegenTool,
  objektAendernTool,
  bauteilAnlegenTool,
  bauteileAnlegenTool,
  bauteilAendernTool,
  begehungStarten,
  begehungAendernTool,
  pruefungErfassenTool,
  pruefungenErfassenTool,
  mangelSchliessenTool,
  begehungAbschliessen,
  begehungAbbrechenTool,
  berichteErzeugenTool,
  sammelberichtErzeugenTool,
  vorgabenSpeichern,
  ...IMPORT_TOOLS,
];

export const ANLEITUNG =
  "Türwerk — Türenwartung für Seehafer Elemente. Objekte tragen ihren Bestand, Begehungen " +
  "prüfen ihn, Berichte fallen hinten heraus. " +
  "Vor allem anderen stehen die **Türtypen** (Stammdaten): ein Türtyp wählt die Vorlage, trägt " +
  "die Angaben, die für alle Türen dieser Art gleich sind, und bringt **seine Checkliste** mit " +
  "— umbenannt, ausgeblendet, um eigene Punkte ergänzt. 'tuertypen_auflisten' zeigt sie, " +
  "'tuertyp_anlegen' legt einen an, 'checkliste_anpassen' legt die Punkte zurecht. "
  +
  "Eine Tür wird mit 'tuer_einrichten' aufgesetzt: Türtyp nennen, dann fragt das Tool nach dem, " +
  "was dieser Typ verlangt — EINE Frage je Aufruf, Antwort im nächsten mitgeben, bis " +
  "'bereit: true'. Vorher kann nicht geprüft werden. Steht eine Ident-Nummer nur auf einem " +
  "Typenschild-Foto: das Bild selbst lesen und den Wert mitgeben, nicht abtippen lassen. " +
  "Ablauf: (1) 'checkliste_lesen' des Türtyps, damit Punkt-Nummern verständlich sind. " +
  "(2) 'begehung_starten' mit dem Objekt — einmal je Termin. Kennt der Server das Objekt nicht, " +
  "legt 'begehung_starten' es an: die erste Begehung ist die Bestandsaufnahme. Die Antwort " +
  "nennt die fälligen Bauteile in Laufreihenfolge und die offenen Mängel. " +
  "(3) Nach JEDER diktierten Tür sofort 'pruefung_erfassen' und kurz quittieren; nicht im " +
  "Gespräch puffern, damit bei Abbruch nichts verloren geht. 'Tür 12' meint das Bauteil Nr. 12 " +
  "des Objekts, nicht die zwölfte Tür des Tages; unbekannte Nummern werden angelegt ('Tür 12 " +
  "ist neu — lege ich an'). Standard ist: alles in Ordnung — nur Abweichungen als checks " +
  "nennen, z. B. {\"8\":\"nio\"}. Sagt der Monteur 'wie davor', wie_davor=true setzen. " +
  "Eine Abweichung heißt: die Tür hat NICHT bestanden — das Ergebnis folgt den Kreuzen, ohne " +
  "dass es jemand extra sagt. Stuf sie dabei ein: 'prioritaet' hoch | " +
  "mittel | niedrig, danach richtet sich die Frist (7 / 28 / 90 Tage). Das ist deine Aufgabe, " +
  "nicht die des Monteurs — hör auf das, was er sagt: eine Brandschutztür, die nicht schließt, " +
  "ist 'hoch'; eine spröde Dichtung 'mittel'; eine Schramme 'niedrig'. Sagt er, der Betreiber " +
  "müsse ran, 'zustaendig' auf 'Betreiber' setzen. " +
  "(4) Kommt 'offene_maengel_vorjahr' zurück, vorlesen und nachfragen ('an dieser Tür ist seit " +
  "2025 die Dichtung offen — behoben?'); bestätigt er es, 'mangel_schliessen' aufrufen. " +
  "(5) Auf 'Fertig' 'begehung_abschliessen' — das liest zurück UND erzeugt die Berichte samt " +
  "Sammelbericht in einem Zug; bei 'fertig: false' einfach noch einmal aufrufen. Den Rückblick " +
  "kompakt vorlesen, samt der fälligen Bauteile, die noch fehlen. " +
  "Ein neues Objekt: 'objekt_einrichten' führt durch die Stammdaten — es nennt genau EINE " +
  "nächste Frage, die du stellst; die Antwort im nächsten Aufruf mitgeben, bis 'fertig'. Nicht " +
  "die ganze Liste vorlesen. " +
  "Eine Türenliste oder ein Bauplan: 'import_anleitung' lesen, dann die Datei selbst lesen und " +
  "mit 'bauplan_uebernehmen' abgeben — Türtypen, Geschosse und Nummern legt der Server dabei " +
  "an. Liste zuerst, Plan danach: bekannte Kennungen werden an den vorhandenen Türen verortet, " +
  "ohne zweite Freigabe. Den 'bericht' aus der Antwort vorlesen und die Freigabe einholen; erst " +
  "'vorschlaege_annehmen' macht Bauteile daraus, danach schließt sich der Import selbst. " +
  "Selbst rechnen lassen statt nachfragen: 'lage' beantwortet 'was ist zu tun?' in einem " +
  "Aufruf (überfällige Objekte, Mängel über der Frist, ausstehende Berichte, dazu konkrete " +
  "nächste Schritte). Die Etage eines Bauteils erkennt der Server selbst aus Raumnummer, " +
  "ETAGE oder Flur — danach nicht fragen. " +
  "Kurz antworten, der Monteur hat die Hände voll und schaut nicht aufs Display.";
