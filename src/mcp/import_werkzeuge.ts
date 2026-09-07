/**
 * Die Tools des Bauplan-Imports (Abschnitt 7.0).
 *
 * Türwerk liest keine Pläne — der Agent liest sie und meldet, was er gefunden hat. Diese Tools
 * sind der Weg dafür: Import anlegen, Kandidaten melden, freigeben lassen, abschließen. Die
 * Freigabe ist der Punkt, an dem ein Mensch zustimmt; ohne sie entsteht kein einziges Bauteil.
 */
import type { Kontext, ToolDef } from "./protokoll";
import { VORLAGEN_IDS, vorlage } from "../vorlagen";
import { zugriffPruefen } from "../daten/basis";
import { geschossAnlegen, geschosseListe, objektAufloesen } from "../daten/objekte";
import type { Objekt } from "../daten/objekte";
import {
  importAendern,
  importAnlegen,
  importLesen,
  importeListe,
  vorschlaegeAnlegen,
  vorschlaegeAnnehmen,
  vorschlaegeLesen,
  vorschlaegeVerwerfen,
  vorschlagAendern,
  zaehlen,
} from "../daten/importe";
import type { Import, Vorschlag } from "../daten/importe";
import { verschmelzen, zusammenfuehren } from "../import/zusammenfuehren";
import anleitung from "../import/anleitung.md";

const NUR_LESEN = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const SCHREIBT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });

function pflicht<T>(args: Record<string, any>, name: string): T {
  const v = args[name];
  if (v === undefined || v === null || v === "") {
    throw new Error(`Pflichtargument '${name}' fehlt.`);
  }
  return v as T;
}

async function holeObjekt(ctx: Kontext, text: string): Promise<Objekt> {
  const o = await objektAufloesen(ctx.env.DB, text);
  zugriffPruefen(ctx.nutzer.benutzer, o.id);
  return o;
}

async function holeImport(ctx: Kontext, id: string): Promise<Import> {
  const i = await importLesen(ctx.env.DB, id);
  if (!i) throw new Error(`Import '${id}' gibt es nicht.`);
  zugriffPruefen(ctx.nutzer.benutzer, i.objekt_id);
  return i;
}

/** Geschoss über Name oder ID; ein unbekannter Name wird angelegt. */
async function holeGeschoss(
  ctx: Kontext,
  objekt: Objekt,
  wunsch: unknown,
): Promise<string | null> {
  if (wunsch === undefined || wunsch === null || String(wunsch).trim() === "") return null;
  const text = String(wunsch).trim();
  const geschosse = await geschosseListe(ctx.env.DB, objekt.id);
  const treffer =
    geschosse.find((g) => g.id === text) ??
    geschosse.find((g) => g.name.toLowerCase() === text.toLowerCase());
  if (treffer) return treffer.id;
  return (await geschossAnlegen(ctx.env.DB, objekt.id, text)).id;
}

function vorschlagAnsicht(v: Vorschlag) {
  return {
    id: v.id,
    kennung: v.kennung || undefined,
    raumnummer: v.raumnummer || undefined,
    raum: v.raum || undefined,
    art: v.art,
    position: v.x !== null && v.y !== null ? { x: v.x, y: v.y } : null,
    wartungspflichtig: v.wartungspflichtig === 1,
    konfidenz: v.konfidenz,
    herkunft: v.herkunft,
    felder: Object.keys(v.felder).length ? v.felder : undefined,
    text_nahe: v.text_nahe.length ? v.text_nahe : undefined,
    status: v.status,
  };
}

/* ── Anleitung ─────────────────────────────────────────────────────────────── */

const importAnleitung: ToolDef = {
  name: "import_anleitung",
  title: "Anleitung für den Bauplan-Import",
  description:
    "Wie ein Bauplan oder eine Türliste nach Türwerk kommt: der Ablauf, das Format eines " +
    "Kandidaten und was nicht geraten werden darf. VOR dem ersten Import lesen — Türwerk liest " +
    "keine Pläne, das tust du, und diese Anleitung sagt, was Türwerk davon erwartet.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: NUR_LESEN,
  async handler(_args, ctx) {
    return {
      anleitung,
      vorlagen: VORLAGEN_IDS,
      zum_nachlesen: `${ctx.origin}/anleitung/import`,
    };
  },
};

/* ── Import ────────────────────────────────────────────────────────────────── */

const importStarten: ToolDef = {
  name: "import_starten",
  title: "Import starten",
  description:
    "Legt einen Import an — einen Plan oder eine Türliste. Liegt beides vor, wird beides " +
    "einzeln importiert und danach 'import_zusammenfuehren' aufgerufen. Bei Plänen das Geschoss " +
    "angeben; ein unbekannter Name legt es an.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse des Objekts"),
      art: str("plan | tuerliste"),
      dateiname: str("Name der Datei, die du gelesen hast — steht später in der Herkunft"),
      geschoss: str("Bei Plänen: Name oder ID des Geschosses, z. B. 'EG' oder '1. OG'"),
    },
    required: ["objekt", "art"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const objekt = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const art = String(pflicht<string>(args, "art")).toLowerCase();
    if (!["plan", "tuerliste"].includes(art)) {
      throw new Error(`Art '${art}' gibt es nicht. Möglich: plan, tuerliste.`);
    }
    const geschossId = art === "plan" ? await holeGeschoss(ctx, objekt, args.geschoss) : null;
    const i = await importAnlegen(ctx.env.DB, {
      objekt_id: objekt.id,
      art,
      dateiname: String(args.dateiname ?? "").trim() || "ohne Dateinamen",
      geschoss_id: geschossId,
      angelegt_von: ctx.nutzer.benutzer,
    });
    return {
      import: i.id,
      objekt: objekt.name,
      art: i.art,
      geschoss: geschossId,
      link: `${ctx.origin}/objekt/${objekt.id}/import`,
      weiter:
        "Jetzt die Datei lesen und die Kandidaten mit 'vorschlaege_anlegen' melden — " +
        "in Stapeln von höchstens 100.",
    };
  },
};

const KANDIDAT = {
  type: "object",
  properties: {
    kennung: str("Türnummer aus Plan oder Liste, z. B. T-2.14"),
    raumnummer: str("Raumnummer, z. B. 2.14 — treibt später die Laufreihenfolge"),
    raum: str("Raumbezeichnung, z. B. 'Flur Ost'"),
    art: str(`Vorlage: ${VORLAGEN_IDS.join(", ")} — Standard wartung_drehfluegel`),
    x: num("Anteil der Bildbreite, 0..1, am Drehpunkt der Tür gemessen"),
    y: num("Anteil der Bildhöhe, 0..1, Ursprung oben links"),
    breite_m: num("Lichte Breite in Metern, falls ablesbar"),
    richtung_grad: num("Anschlagsrichtung in Grad, falls ablesbar"),
    wartungspflichtig: bool("true nur bei echtem Anhalt (T30, EI30, RS, FSA, Feuerwiderstand)"),
    konfidenz: num("0..1, ehrlich: 1.0 Türliste, 0.9 klares Symbol, 0.6 vermutet, 0.4 unsicher"),
    felder: {
      type: "object",
      description: "Formularfelder: ZULASSUNG, HERSTELLER, TUERTYP, OTS, ABSENKDICHTUNG, ETAGE …",
      additionalProperties: { type: "string" },
    },
    text_nahe: { type: "array", description: "Beschriftungen im Umkreis", items: { type: "string" } },
  },
  additionalProperties: false,
};

const vorschlaegeAnlegenTool: ToolDef = {
  name: "vorschlaege_anlegen",
  title: "Gefundene Türen melden",
  description:
    "Meldet, was du im Plan oder in der Liste gefunden hast. Daraus werden noch keine Bauteile " +
    "— erst die Freigabe durch einen Menschen macht welche daraus. Nichts erfinden: eine Zelle, " +
    "die du nicht liest, bleibt leer; eine Tür, die du nicht siehst, gibt es nicht.",
  inputSchema: {
    type: "object",
    properties: {
      import: str("Kennung aus 'import_starten'"),
      kandidaten: {
        type: "array",
        description: "Die gefundenen Türen, höchstens ~100 je Aufruf.",
        items: KANDIDAT,
      },
    },
    required: ["import", "kandidaten"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const imp = await holeImport(ctx, pflicht<string>(args, "import"));
    const kandidaten = pflicht<Record<string, any>[]>(args, "kandidaten");
    if (!Array.isArray(kandidaten) || !kandidaten.length) {
      throw new Error("Keine Kandidaten dabei.");
    }
    if (kandidaten.length > 200) {
      throw new Error(
        `${kandidaten.length} Kandidaten auf einmal sind zu viele. In Stapeln von höchstens 100 melden.`,
      );
    }
    for (const k of kandidaten) {
      if (k.art) vorlage(String(k.art));
    }
    const angelegt = await vorschlaegeAnlegen(ctx.env.DB, imp, kandidaten);
    const alle = await vorschlaegeLesen(ctx.env.DB, { import_id: imp.id });
    await importAendern(ctx.env.DB, imp.id, {
      status: "ausgewertet",
      ergebnis: { gefunden: alle.length, gemeldet_am: Date.now() },
    });
    return {
      angelegt: angelegt.length,
      im_import: alle.length,
      zahlen: zaehlen(alle),
      link: `${ctx.origin}/objekt/${imp.objekt_id}/import/${imp.id}`,
      weiter:
        "Kurz berichten, was gefunden wurde, und die Freigabe einholen. Dann " +
        "'vorschlaege_annehmen' — im Gespräch oder über die Planseite.",
    };
  },
};

const vorschlaegeLesenTool: ToolDef = {
  name: "vorschlaege_lesen",
  title: "Vorschläge eines Imports lesen",
  description:
    "Was ein Import gefunden hat und was davon noch offen ist. Vor einem neuen Import damit " +
    "nachsehen, ob für dieses Geschoss schon etwas offen ist.",
  inputSchema: {
    type: "object",
    properties: {
      import: str("Kennung des Imports"),
      objekt: str("Alternativ: alle Vorschläge eines Objekts"),
      status: str("offen (Standard) | angenommen | verworfen | alle"),
      limit: int("Höchstzahl (Standard 100)"),
    },
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    let filter: { import_id?: string; objekt_id?: string; status?: string } = {};
    if (args.import) {
      const imp = await holeImport(ctx, String(args.import));
      filter = { import_id: imp.id };
    } else if (args.objekt) {
      const objekt = await holeObjekt(ctx, String(args.objekt));
      filter = { objekt_id: objekt.id };
    } else {
      throw new Error("Entweder 'import' oder 'objekt' angeben.");
    }
    filter.status = args.status ?? "offen";
    const alle = await vorschlaegeLesen(ctx.env.DB, filter);
    const limit = Math.min(Number(args.limit ?? 100), 300);
    return {
      zahlen: zaehlen(await vorschlaegeLesen(ctx.env.DB, { ...filter, status: "alle" })),
      vorschlaege: alle.slice(0, limit).map(vorschlagAnsicht),
      mehr: alle.length > limit ? alle.length - limit : undefined,
    };
  },
};

const vorschlaegeAnnehmenTool: ToolDef = {
  name: "vorschlaege_annehmen",
  title: "Vorschläge freigeben",
  description:
    "Macht aus Vorschlägen Bauteile — der Schritt, den ein Mensch entschieden haben muss. " +
    "Entweder einzelne 'ids', oder eine Auswahl: 'ab_konfidenz' (z. B. 0.85), " +
    "'nur_wartungspflichtige', 'alle'. Ist die Kennung eine freie Zahl, wird sie die Türnummer.",
  inputSchema: {
    type: "object",
    properties: {
      import: str("Kennung des Imports"),
      ids: { type: "array", description: "Einzelne Vorschlag-IDs", items: { type: "string" } },
      ab_konfidenz: num("Alle offenen ab dieser Konfidenz, z. B. 0.85"),
      nur_wartungspflichtige: bool("Nur die als wartungspflichtig gemeldeten"),
      alle: bool("Alle offenen Vorschläge des Imports"),
    },
    required: ["import"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const imp = await holeImport(ctx, pflicht<string>(args, "import"));
    const offene = await vorschlaegeLesen(ctx.env.DB, { import_id: imp.id, status: "offen" });
    let auswahl: Vorschlag[] = [];
    if (Array.isArray(args.ids) && args.ids.length) {
      const gesucht = new Set(args.ids.map(String));
      auswahl = offene.filter((v) => gesucht.has(v.id));
    } else if (args.alle === true) {
      auswahl = offene;
    } else if (args.ab_konfidenz !== undefined || args.nur_wartungspflichtige === true) {
      const schwelle = Number(args.ab_konfidenz ?? 0);
      auswahl = offene.filter(
        (v) =>
          v.konfidenz >= schwelle &&
          (args.nur_wartungspflichtige === true ? v.wartungspflichtig === 1 : true),
      );
    } else {
      throw new Error(
        "Auswahl fehlt: 'ids', 'ab_konfidenz', 'nur_wartungspflichtige' oder 'alle'.",
      );
    }
    if (!auswahl.length) return { angelegt: 0, hinweis: "Nichts passte auf diese Auswahl." };

    const { angelegt } = await vorschlaegeAnnehmen(ctx.env.DB, auswahl);
    const rest = await vorschlaegeLesen(ctx.env.DB, { import_id: imp.id, status: "alle" });
    await importAendern(ctx.env.DB, imp.id, {
      ergebnis: { angenommen: zaehlen(rest).angenommen },
    });
    return {
      angelegt: angelegt.length,
      bauteile: angelegt.map((b) => ({ nr: b.nr, kennung: b.kennung || undefined, art: b.art })),
      zahlen: zaehlen(rest),
      link: `${ctx.origin}/objekt/${imp.objekt_id}`,
    };
  },
};

const vorschlaegeVerwerfenTool: ToolDef = {
  name: "vorschlaege_verwerfen",
  title: "Vorschläge verwerfen",
  description:
    "Wirft Vorschläge weg, die keine Tür sind — einzeln über 'ids' oder alle unter einer " +
    "Konfidenz. Rücknehmbar, solange der Import nicht abgeschlossen ist.",
  inputSchema: {
    type: "object",
    properties: {
      import: str("Kennung des Imports"),
      ids: { type: "array", description: "Einzelne Vorschlag-IDs", items: { type: "string" } },
      unter_konfidenz: num("Alle offenen unter dieser Konfidenz, z. B. 0.5"),
    },
    required: ["import"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const imp = await holeImport(ctx, pflicht<string>(args, "import"));
    const offene = await vorschlaegeLesen(ctx.env.DB, { import_id: imp.id, status: "offen" });
    let auswahl: Vorschlag[] = [];
    if (Array.isArray(args.ids) && args.ids.length) {
      const gesucht = new Set(args.ids.map(String));
      auswahl = offene.filter((v) => gesucht.has(v.id));
    } else if (args.unter_konfidenz !== undefined) {
      auswahl = offene.filter((v) => v.konfidenz < Number(args.unter_konfidenz));
    } else {
      throw new Error("Auswahl fehlt: 'ids' oder 'unter_konfidenz'.");
    }
    const n = await vorschlaegeVerwerfen(ctx.env.DB, auswahl.map((v) => v.id));
    const rest = await vorschlaegeLesen(ctx.env.DB, { import_id: imp.id, status: "alle" });
    return { verworfen: n, zahlen: zaehlen(rest) };
  },
};

const importZusammenfuehrenTool: ToolDef = {
  name: "import_zusammenfuehren",
  title: "Türliste und Plan zusammenführen",
  description:
    "Paart die Vorschläge einer Türliste mit denen eines Plans: gleiche Kennung, sonst gleiche " +
    "Raumnummer, wenn dort auf beiden Seiten genau eine Tür steht. Position kommt vom Plan, " +
    "Felder von der Liste. Was nicht sicher zusammenpasst, bleibt getrennt stehen.",
  inputSchema: {
    type: "object",
    properties: {
      tuerliste: str("Kennung des Türlisten-Imports"),
      plan: str("Kennung des Plan-Imports"),
    },
    required: ["tuerliste", "plan"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const listenImport = await holeImport(ctx, pflicht<string>(args, "tuerliste"));
    const planImport = await holeImport(ctx, pflicht<string>(args, "plan"));
    if (listenImport.objekt_id !== planImport.objekt_id) {
      throw new Error("Die beiden Importe gehören zu verschiedenen Objekten.");
    }
    const liste = await vorschlaegeLesen(ctx.env.DB, {
      import_id: listenImport.id,
      status: "offen",
    });
    const plan = await vorschlaegeLesen(ctx.env.DB, { import_id: planImport.id, status: "offen" });
    const ergebnis = zusammenfuehren(liste, plan);

    for (const paar of ergebnis.paare) {
      await vorschlagAendern(ctx.env.DB, paar.plan.id, verschmelzen(paar));
      /* Die Listenzeile ist in den Plankandidaten aufgegangen — sie steht nicht mehr für sich. */
      await ctx.env.DB.prepare("DELETE FROM vorschlaege WHERE id = ?").bind(paar.liste.id).run();
    }
    return {
      zusammengefuehrt: ergebnis.paare.length,
      ueber_kennung: ergebnis.paare.filter((p) => p.grund === "kennung").length,
      ueber_raumnummer: ergebnis.paare.filter((p) => p.grund === "raumnummer").length,
      nur_in_der_liste: ergebnis.nur_liste.length,
      nur_im_plan: ergebnis.nur_plan.length,
      hinweis:
        "Was getrennt blieb, ist nicht falsch — es fehlt nur die Entsprechung. " +
        "Listenzeilen ohne Plan werden Bauteile ohne Position.",
    };
  },
};

const importAbschliessenTool: ToolDef = {
  name: "import_abschliessen",
  title: "Import abschließen",
  description:
    "Setzt den Import auf 'bestaetigt'. Was dann noch offen war, gilt als verworfen; die " +
    "angelegten Bauteile bleiben natürlich.",
  inputSchema: {
    type: "object",
    properties: { import: str("Kennung des Imports") },
    required: ["import"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const imp = await holeImport(ctx, pflicht<string>(args, "import"));
    const alle = await vorschlaegeLesen(ctx.env.DB, { import_id: imp.id, status: "alle" });
    const zahl = zaehlen(alle);
    await importAendern(ctx.env.DB, imp.id, {
      status: "bestaetigt",
      ergebnis: { ...zahl, abgeschlossen_am: Date.now() },
    });
    return {
      import: imp.id,
      status: "bestaetigt",
      zahlen: zahl,
      link: `${ctx.origin}/objekt/${imp.objekt_id}`,
    };
  },
};

const importeAuflistenTool: ToolDef = {
  name: "importe_auflisten",
  title: "Importe eines Objekts auflisten",
  description: "Welche Pläne und Türlisten für dieses Objekt schon eingelesen wurden.",
  inputSchema: {
    type: "object",
    properties: { objekt: str("ID, Name oder Adresse") },
    required: ["objekt"],
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    const objekt = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const liste = await importeListe(ctx.env.DB, objekt.id);
    const out = [];
    for (const i of liste) {
      const v = await vorschlaegeLesen(ctx.env.DB, { import_id: i.id, status: "alle" });
      out.push({
        id: i.id,
        art: i.art,
        dateiname: i.dateiname,
        status: i.status,
        angelegt_am: i.angelegt_am,
        zahlen: zaehlen(v),
      });
    }
    return { objekt: objekt.name, importe: out };
  },
};

const geschossAnlegenTool: ToolDef = {
  name: "geschoss_anlegen",
  title: "Geschoss anlegen",
  description:
    "Legt ein Geschoss an. Die Reihenfolge kommt aus dem Namen (UG −1, EG 0, '2. OG' 2) und " +
    "bestimmt, wie das Haus abgegangen wird.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse"),
      name: str("Name des Geschosses, z. B. '1. OG'"),
      reihenfolge: int("Eigene Reihenfolge, sonst aus dem Namen"),
    },
    required: ["objekt", "name"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const objekt = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const g = await geschossAnlegen(
      ctx.env.DB,
      objekt.id,
      pflicht<string>(args, "name"),
      args.reihenfolge,
    );
    return { geschoss: { id: g.id, name: g.name, reihenfolge: g.reihenfolge } };
  },
};

export const IMPORT_TOOLS: ToolDef[] = [
  importAnleitung,
  importeAuflistenTool,
  vorschlaegeLesenTool,
  geschossAnlegenTool,
  importStarten,
  vorschlaegeAnlegenTool,
  vorschlaegeAnnehmenTool,
  vorschlaegeVerwerfenTool,
  importZusammenfuehrenTool,
  importAbschliessenTool,
];

export { anleitung };
