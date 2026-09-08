/**
 * Türtypen und ihre Checklisten — die Stammdaten, die vor der ersten Prüfung stehen müssen.
 *
 * Der Ablauf kehrt sich damit um: nicht mehr „diktier los, der Rest ergibt sich", sondern erst
 * den Typ einrichten (Vorlage, Hersteller, Zulassung, was abgefragt werden soll), dann die
 * Checkliste zurechtlegen, dann Türen dieses Typs anlegen. Was einmal am Typ steht, muss an
 * keiner Tür wiederholt werden.
 */
import type { Kontext, ToolDef } from "./protokoll";
import { VORLAGEN, VORLAGEN_IDS, vorlage } from "../vorlagen";
import { TYPEN_VORRAT, vorratsTyp } from "../vorlagen/typenvorrat";
import {
  punkteAnpassen,
  punkteAusVorlage,
  tuertypAendern,
  tuertypAnlegen,
  tuertypAusVorrat,
  tuertypLesen,
  tuertypLoeschen,
  tuertypSuchen,
  tuertypenListe,
  typOderVorrat,
} from "../daten/tuertypen";
import type { Tuertyp, Zusatzfeld } from "../daten/tuertypen";
import { bauteilAendern, bauteilAnlegen, bauteilPerNr, bauteileMitStand } from "../daten/bauteile";
import { objektSuchen } from "../daten/objekte";
import type { Objekt } from "../daten/objekte";
import { zugriffPruefen } from "../daten/basis";

const NUR_LESEN = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const SCHREIBT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });

function pflicht<T>(args: Record<string, any>, name: string): T {
  const wert = args[name];
  if (wert === undefined || wert === null || wert === "") {
    throw new Error(`Pflichtargument '${name}' fehlt.`);
  }
  return wert as T;
}

async function holeTyp(ctx: Kontext, text: string): Promise<Tuertyp> {
  const t = await tuertypSuchen(ctx.env.DB, text);
  if (!t) {
    const alle = await tuertypenListe(ctx.env.DB);
    const nah = TYPEN_VORRAT.filter((v) =>
      v.name.toLowerCase().includes(text.trim().toLowerCase()),
    ).map((v) => v.name);
    throw new Error(
      `Türtyp '${text}' gibt es nicht.` +
        (alle.length ? ` Vorhanden: ${alle.map((x) => x.name).join(", ")}.` : "") +
        (nah.length ? ` Im Vorrat liegt: ${nah.join(", ")}.` : "") +
        (!alle.length && !nah.length
          ? " 'stand' zeigt den Vorrat der gängigen Typen."
          : ""),
    );
  }
  return t;
}

/**
 * Wie `holeTyp`, aber ein Name aus dem Vorrat entsteht dabei.
 *
 * Nur für Werkzeuge, die ohnehin schreiben. „Türtyp T30-RS, Raum 1.04" soll am Telefon
 * funktionieren, ohne dass vorher jemand eine Stammdatenseite geöffnet hat — das Anlegen ist
 * dann keine eigene Entscheidung mehr, sondern Teil derselben.
 */
async function holeTypOderVorrat(ctx: Kontext, text: string): Promise<Tuertyp> {
  const t = await tuertypSuchen(ctx.env.DB, text);
  if (t) return t;
  const neu = await tuertypAusVorrat(ctx.env.DB, text, ctx.nutzer.benutzer);
  if (neu) return neu;
  return holeTyp(ctx, text); // wirft mit der guten Meldung
}

async function holeObjekt(ctx: Kontext, text: string): Promise<Objekt> {
  const o = await objektSuchen(ctx.env.DB, text);
  if (!o) {
    throw new Error(
      `Objekt '${text}' gibt es nicht. Erst 'einrichten' — danach die Türen.`,
    );
  }
  zugriffPruefen(ctx.nutzer.benutzer, o.id);
  return o;
}

function typAnsicht(t: Tuertyp, ctx: Kontext) {
  return {
    id: t.id,
    name: t.name,
    vorlage: t.art,
    vorlage_label: VORLAGEN[t.art]?.label ?? t.art,
    beschreibung: t.beschreibung || undefined,
    felder: t.felder,
    pflichtfelder: t.pflicht,
    zusatzfelder: t.zusatz,
    punkte: t.punkte.filter((p) => p.aktiv).map((p) => ({ nr: p.nr, text: p.text, eigen: p.eigen })),
    ausgeblendet: t.punkte.filter((p) => !p.aktiv).map((p) => p.nr),
    link: `${ctx.origin}/checkliste/${t.id}`,
  };
}

/* ── Lesen ─────────────────────────────────────────────────────────────────── */

const tuertypenAuflisten: ToolDef = {
  name: "tuertypen_auflisten",
  title: "Türtypen auflisten",
  description:
    "Alle eingerichteten Türtypen mit Vorlage, Stammdaten und der Zahl ihrer Prüfpunkte — dazu " +
    "'vorrat': die gängigen Typen, die bereitliegen und beim ersten Gebrauch von selbst " +
    "entstehen. Das ist der erste Blick, bevor eine Tür angelegt wird; ein leerer Bestand ist " +
    "kein Hindernis, denn der Vorrat ist immer da. Stillgelegte bleiben außen vor, bis " +
    "'auch_stillgelegte' sie dazuholt.",
  inputSchema: {
    type: "object",
    properties: { auch_stillgelegte: bool("true zeigt auch die stillgelegten Typen") },
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const liste = await tuertypenListe(ctx.env.DB, {
      auch_stillgelegte: args.auch_stillgelegte === true,
    });
    return {
      tuertypen: liste.map((t) => ({
        id: t.id,
        name: t.name,
        stillgelegt: t.aktiv ? undefined : true,
        vorlage: t.art,
        vorlage_label: VORLAGEN[t.art]?.label ?? t.art,
        pruefpunkte: t.punkte.filter((p) => p.aktiv).length,
        pflichtfelder: t.pflicht,
        zusatzfelder: t.zusatz.map((z) => z.schluessel),
      })),
      /*
       * Der Vorrat gehört in dieselbe Antwort: sonst fragt der Agent den Monteur nach einem
       * Namen, den der Server längst kennt. Ein Vorratstyp lässt sich überall angeben, wo ein
       * Türtyp verlangt wird — angelegt wird er beim ersten Gebrauch.
       */
      vorrat: TYPEN_VORRAT.filter(
        (v) => !liste.some((t) => t.name.toLowerCase() === v.name.toLowerCase()),
      ).map((v) => ({
        name: v.name,
        vorlage: v.art,
        beschreibung: v.beschreibung,
        pflichtfelder: v.pflicht,
      })),
      hinweis: liste.length
        ? undefined
        : "Noch kein eigener Türtyp — nötig ist das auch nicht: nimm einen Namen aus 'vorrat', " +
          "er entsteht beim ersten Gebrauch. Nur wenn keiner passt, 'einrichten' mit tuertypen.",
      vorlagen: VORLAGEN_IDS.map((id) => ({ id, label: VORLAGEN[id].label })),
    };
  },
};

const checklisteLesen: ToolDef = {
  name: "checkliste_lesen",
  title: "Checkliste eines Türtyps lesen",
  description:
    "Die Prüfpunkte eines Türtyps in der Fassung, wie sie hier gelten — umbenannt, ausgeblendet " +
    "und um eigene ergänzt. Vor der ersten Tür dieses Typs einmal lesen, damit Punktnummern im " +
    "Diktat verständlich sind. Nennt außerdem die Zusatzfelder, die je Tür erfasst werden.",
  inputSchema: {
    type: "object",
    properties: { tuertyp: str("Name oder ID des Türtyps") },
    required: ["tuertyp"],
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const wunsch = pflicht<string>(args, "tuertyp");
    /* Auch die Checkliste eines Vorratstyps ist lesbar — ohne ihn dafür anzulegen. */
    const w = await typOderVorrat(ctx.env.DB, wunsch);
    if (w?.aus_vorrat) {
      return {
        tuertyp: w.name,
        aus_vorrat: true,
        vorlage: w.art,
        vorlage_label: VORLAGEN[w.art]?.label ?? w.art,
        beschreibung: vorratsTyp(w.name)?.beschreibung ?? "",
        felder: w.felder,
        pflichtfelder: w.pflicht,
        punkte: w.punkte.filter((p) => p.aktiv).map((p) => ({ nr: p.nr, text: p.text })),
        hinweis:
          "Dieser Typ liegt im Vorrat und ist noch nicht angelegt. Er entsteht beim ersten " +
          "Gebrauch — 'tuer_einrichten' oder 'checkliste_anpassen' mit diesem Namen genügt.",
      };
    }
    const t = await holeTyp(ctx, wunsch);
    return typAnsicht(t, ctx);
  },
};

/* ── Schreiben ─────────────────────────────────────────────────────────────── */

const tuertypAnlegenTool: ToolDef = {
  name: "einrichten",
  title: "Türtyp einrichten",
  description:
    "Legt einen **eigenen** Türtyp an. Vorher in 'stand' den 'vorrat' ansehen: " +
    "passt einer davon, nenn einfach seinen Namen, wo ein Türtyp verlangt wird — dann braucht " +
    "es dieses Werkzeug nicht. Sonst: Name, Vorlage (bestimmt Formular und Grund-Prüfpunkte) und die " +
    "Stammdaten, die für alle Türen dieses Typs gleich sind. Die Checkliste entsteht dabei aus " +
    "der Vorlage und lässt sich danach mit 'checkliste_anpassen' zurechtlegen. Mit " +
    "'pflichtfelder' festlegen, was beim Einrichten einer Tür stehen muss, bevor geprüft werden " +
    "darf — typisch IDENT.",
  inputSchema: {
    type: "object",
    properties: {
      name: str("Sprechender Name, z. B. 'T30 Flurtür Hörmann'"),
      vorlage: str(`Grundlage: ${VORLAGEN_IDS.join(" | ")}`),
      beschreibung: str("Wofür dieser Typ steht"),
      felder: {
        type: "object",
        description:
          "Stammdaten für alle Türen dieses Typs, z. B. {\"HERSTELLER\":\"Hörmann\"," +
          "\"ZULASSUNG\":\"T30-RS\"}. Sie stehen später im Bericht jeder Tür.",
        additionalProperties: { type: "string" },
      },
      pflichtfelder: {
        type: "array",
        description:
          "Felder, die je Tür stehen müssen, bevor geprüft werden darf — z. B. [\"IDENT\"]. " +
          "Ohne sie verweigert 'tuer_einrichten' den Abschluss.",
        items: { type: "string" },
      },
      zusatzfelder: {
        type: "array",
        description: "Was je Tür zusätzlich erfasst wird, z. B. Geschoss oder Kommentar.",
        items: {
          type: "object",
          properties: {
            schluessel: str("Kurzname, z. B. GESCHOSS oder KOMMENTAR"),
            label: str("Beschriftung für die Oberfläche"),
            pflicht: bool("true = muss gefüllt sein"),
          },
          required: ["schluessel"],
          additionalProperties: false,
        },
      },
    },
    required: ["name", "vorlage"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const art = String(pflicht<string>(args, "vorlage"));
    vorlage(art);
    const zusatz: Zusatzfeld[] = (Array.isArray(args.zusatzfelder) ? args.zusatzfelder : []).map(
      (z: Record<string, unknown>) => ({
        schluessel: String(z.schluessel).trim().toUpperCase(),
        label: String(z.label ?? z.schluessel).trim(),
        pflicht: z.pflicht === true,
      }),
    );
    const t = await tuertypAnlegen(ctx.env.DB, {
      name: pflicht<string>(args, "name"),
      art,
      beschreibung: String(args.beschreibung ?? ""),
      felder: (args.felder ?? {}) as Record<string, string>,
      pflicht: (Array.isArray(args.pflichtfelder) ? args.pflichtfelder : []).map((f: unknown) =>
        String(f).trim().toUpperCase(),
      ),
      zusatz,
      angelegt_von: ctx.nutzer.benutzer,
    });
    return {
      ...typAnsicht(t, ctx),
      weiter:
        "Die Checkliste steht mit den Punkten der Vorlage. Mit 'checkliste_anpassen' " +
        "umbenennen, ausblenden oder eigene Punkte ergänzen — danach 'tuer_einrichten'.",
    };
  },
};

const tuertypAendernTool: ToolDef = {
  name: "tuertyp_aendern",
  title: "Türtyp ändern",
  description:
    "Ändert Name, Beschreibung, Stammdaten, Pflicht- und Zusatzfelder eines Türtyps. Nur die " +
    "genannten Felder werden angefasst. 'aktiv: false' legt den Typ still, ohne die Historie " +
    "der Türen anzutasten. Die Prüfpunkte ändert 'checkliste_anpassen'.",
  inputSchema: {
    type: "object",
    properties: {
      tuertyp: str("Name oder ID"),
      name: str("Neuer Name"),
      beschreibung: str("Neue Beschreibung"),
      felder: {
        type: "object",
        description: "Stammdaten, ersetzt die bisherigen vollständig",
        additionalProperties: { type: "string" },
      },
      pflichtfelder: { type: "array", description: "ersetzt die bisherigen", items: { type: "string" } },
      zusatzfelder: {
        type: "array",
        description: "ersetzt die bisherigen",
        items: {
          type: "object",
          properties: {
            schluessel: str("Kurzname"),
            label: str("Beschriftung"),
            pflicht: bool("muss gefüllt sein"),
          },
          required: ["schluessel"],
          additionalProperties: false,
        },
      },
      aktiv: bool("false legt den Türtyp still"),
    },
    required: ["tuertyp"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const t = await holeTyp(ctx, pflicht<string>(args, "tuertyp"));
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = String(args.name);
    if (args.beschreibung !== undefined) patch.beschreibung = String(args.beschreibung);
    if (args.felder !== undefined) patch.felder = args.felder;
    if (args.pflichtfelder !== undefined) {
      patch.pflicht = (args.pflichtfelder as unknown[]).map((f) => String(f).trim().toUpperCase());
    }
    if (args.zusatzfelder !== undefined) {
      patch.zusatz = (args.zusatzfelder as Record<string, unknown>[]).map((z) => ({
        schluessel: String(z.schluessel).trim().toUpperCase(),
        label: String(z.label ?? z.schluessel).trim(),
        pflicht: z.pflicht === true,
      }));
    }
    if (args.aktiv !== undefined) patch.aktiv = args.aktiv === false ? 0 : 1;
    const neu = await tuertypAendern(ctx.env.DB, t.id, patch);
    return { ...typAnsicht(neu!, ctx), geaendert: Object.keys(patch) };
  },
};

/**
 * Ein Türtyp, an dem nie eine Tür hing, ist ein Vertipper — der darf ganz weg.
 *
 * Alles andere wird stillgelegt ('tuertyp_aendern' mit aktiv: false): die Historie einer
 * geprüften Tür ist der Wert der ganzen Anwendung und wird nicht durch ein Aufräumen weggewischt.
 */
const tuertypLoeschenTool: ToolDef = {
  name: "tuertyp_loeschen",
  title: "Türtyp löschen",
  description:
    "Löscht einen Türtyp endgültig — nur, solange keine Tür und kein Vorschlag daran hängt. " +
    "Für alles andere ist 'tuertyp_aendern' mit 'aktiv: false' der Weg: der Typ verschwindet " +
    "aus der Auswahl, die Türen behalten ihre Historie.",
  inputSchema: {
    type: "object",
    properties: { tuertyp: str("Name oder ID") },
    required: ["tuertyp"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const t = await holeTyp(ctx, pflicht<string>(args, "tuertyp"));
    const weg = await tuertypLoeschen(ctx.env.DB, t.id);
    if (weg.geloescht) return { geloescht: true, name: t.name };
    const zahl = weg.tueren + weg.vorschlaege;
    return {
      geloescht: false,
      name: t.name,
      haengt_dran: zahl,
      hinweis:
        `An '${t.name}' ${zahl === 1 ? "hängt noch eine Tür" : `hängen noch ${zahl} Türen`} — ` +
        "deshalb nicht gelöscht. Stilllegen geht: 'tuertyp_aendern' mit aktiv: false.",
    };
  },
};

const checklisteAnpassenTool: ToolDef = {
  name: "checkliste_anpassen",
  title: "Checkliste anpassen",
  description:
    "Legt die Prüfpunkte eines Türtyps zurecht. Je Eintrag: 'nr' + 'text' benennt um, " +
    "'nr' + 'aktiv: false' blendet aus, 'text' ohne 'nr' hängt einen eigenen Punkt an, " +
    "'nr' + 'entfernen: true' entfernt einen eigenen (Punkte aus der Vorlage werden dabei nur " +
    "ausgeblendet, denn ihr Kästchen gibt es im Formular weiterhin). " +
    "Mit 'zuruecksetzen: true' steht wieder die Vorlage. " +
    "Eigene Punkte tragen Nummern ab 900 und erscheinen im Bericht unter 'Hinweise', weil das " +
    "Formular für sie kein Kästchen hat.",
  inputSchema: {
    type: "object",
    properties: {
      tuertyp: str("Name oder ID des Türtyps"),
      punkte: {
        type: "array",
        description: "Die Änderungen, der Reihe nach angewendet",
        items: {
          type: "object",
          properties: {
            nr: str("Nummer des Punkts; weglassen legt einen neuen an"),
            text: str("Neuer Text"),
            aktiv: bool("false blendet den Punkt aus"),
            entfernen: bool("true entfernt einen eigenen Punkt"),
          },
          additionalProperties: false,
        },
      },
      zuruecksetzen: bool("true stellt die Punkte der Vorlage wieder her"),
    },
    required: ["tuertyp"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const t = await holeTypOderVorrat(ctx, pflicht<string>(args, "tuertyp"));
    const punkte =
      args.zuruecksetzen === true
        ? punkteAusVorlage(t.art)
        : punkteAnpassen(t.punkte, Array.isArray(args.punkte) ? args.punkte : []);
    const neu = await tuertypAendern(ctx.env.DB, t.id, { punkte });
    return typAnsicht(neu!, ctx);
  },
};

/** Aus einem Feldschlüssel eine Benennung bauen, die sich vorlesen lässt. */
export function beschriftung(schluessel: string): string {
  const bekannt: Record<string, string> = {
    IDENT: "die Ident-Nummer",
    HERSTELLER: "der Hersteller",
    ZULASSUNG: "die Zulassung",
    TUERTYP: "der Türtyp",
    ETAGE: "die Etage",
    RAUM: "der Raum",
    OTS: "der Obentürschließer",
    ABSENKDICHTUNG: "die Absenkdichtung",
    SPION: "der Spion",
    KOMMENTAR: "der Kommentar",
    GESCHOSS: "das Geschoss",
  };
  return bekannt[schluessel] ?? schluessel.toLowerCase();
}

/**
 * Nach außen sind das keine eigenen Werkzeuge mehr, sondern die Handgriffe, die `stand`,
 * `einrichten` und `aendern` benutzen. Die Logik bleibt, die 44 Namen im Werkzeugkasten
 * verschwinden — für ein kleines Modell am Telefon war jeder davon eine Abzweigung.
 */
export const TUERTYPEN = {
  auflisten: tuertypenAuflisten.handler,
  checkliste: checklisteLesen.handler,
  anlegen: tuertypAnlegenTool.handler,
  aendern: tuertypAendernTool.handler,
  loeschen: tuertypLoeschenTool.handler,
  checklisteAnpassen: checklisteAnpassenTool.handler,
};
