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
import { geschossAnlegen, geschosseListe, geschossZuordnen, objektAufloesen } from "../daten/objekte";
import { tuertypAnlegen, tuertypAusVorrat, tuertypPerName } from "../daten/tuertypen";
import { bauteilAendern, bauteilPerKennung } from "../daten/bauteile";
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
  /*
   * "1.OG" und "OG" sind dasselbe Stockwerk -- die Tuerenliste schreibt das eine, die
   * Fensterliste das andere. 'geschossZuordnen' kennt die kanonische Schreibweise und findet
   * eine bereits angelegte Etage derselben Hoehe wieder; nur was gar nicht nach Geschoss
   * aussieht ("Haus A", "Halle"), wird unveraendert angelegt.
   */
  const zugeordnet = await geschossZuordnen(ctx.env.DB, objekt.id, text);
  if (zugeordnet) return zugeordnet;
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

/* ── Import ────────────────────────────────────────────────────────────────── */

const KANDIDAT = {
  type: "object",
  properties: {
    kennung: str("Türnummer aus Plan oder Liste, z. B. T-2.14"),
    raumnummer: str("Raumnummer, z. B. 2.14 — treibt später die Laufreihenfolge"),
    raum: str("Raumbezeichnung, z. B. 'Flur Ost'"),
    art: str(`Vorlage: ${VORLAGEN_IDS.join(", ")} — Standard wartung_drehfluegel`),
    tuertyp: str(
      "Name des Türtyps aus der Liste, z. B. 'FS 30 RD' oder 'Alu-Rohrrahmen T30 RS'. Gibt es " +
      "den Typ noch nicht, legt der Import ihn an — gleiche Schreibweise heißt gleicher Typ.",
    ),
    geschoss: str("Etage dieser Zeile, z. B. 'EG', '1. OG', 'DG'. Sticht das Geschoss des Imports."),
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

/**
 * Der Bauplan-Import in einem Aufruf bis zur Freigabe.
 *
 * Sechs Schritte waren es: starten, lesen, melden, berichten, freigeben, abschließen. Vier davon
 * sind Buchhaltung, die der Server selbst erledigen kann — nur zwei sind echte Arbeit: die Datei
 * lesen (das kann nur der Agent) und die Freigabe (die muss ein Mensch geben, Leitsatz 6).
 *
 * Also: dieses Tool nimmt die gefundenen Türen entgegen, legt den Import nebenbei an und
 * antwortet mit dem, was man vorlesen kann — samt fertiger Vorschläge, wie freigegeben werden
 * kann. Danach nur noch 'einrichten' mit freigeben; das schließt den Import selbst ab.
 */
const bauplanUebernehmenTool: ToolDef = {
  name: "bauplan_uebernehmen",
  title: "Bauplan oder Türliste übernehmen",
  description:
    "Der ganze Import in einem Aufruf: du liest den Grundriss oder die Türliste und gibst hier " +
    "die gefundenen Türen ab. Der Import wird nebenbei angelegt. Daraus werden noch KEINE " +
    "Bauteile — die Antwort sagt dir, was du berichten und wie du die Freigabe einholen sollst " +
    "(Leitsatz: kein Import legt Bauteile ohne Menschen an). Danach nur noch " +
    "'einrichten' mit freigeben. Bei mehr als ~100 Türen mehrfach aufrufen und ab dem zweiten Mal " +
    "die zurückgegebene 'import'-Kennung mitgeben. Nichts erfinden: eine Zelle, die du nicht " +
    "liest, bleibt leer; eine Tür, die du nicht siehst, gibt es nicht.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse des Objekts"),
      tueren: {
        type: "array",
        description: "Die gefundenen Türen, höchstens ~100 je Aufruf.",
        items: KANDIDAT,
      },
      art: str("plan | tuerliste — Standard 'plan', wenn Positionen dabei sind, sonst 'tuerliste'"),
      geschoss: str("Bei Plänen: Geschoss, z. B. 'EG' oder '1. OG'. Unbekannte Namen werden angelegt."),
      dateiname: str("Name der Datei, die du gelesen hast — steht später in der Herkunft"),
      import: str("Nur beim Nachreichen weiterer Stapel: die Kennung aus dem ersten Aufruf"),
    },
    required: ["objekt", "tueren"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const objekt = await holeObjekt(ctx, pflicht<string>(args, "objekt"));
    const tueren = pflicht<Record<string, any>[]>(args, "tueren");
    if (!Array.isArray(tueren) || !tueren.length) throw new Error("Keine Türen dabei.");
    if (tueren.length > 200) {
      throw new Error(
        `${tueren.length} Türen auf einmal sind zu viele. In Stapeln von höchstens 100 abgeben ` +
          "und ab dem zweiten Aufruf die 'import'-Kennung mitgeben.",
      );
    }
    for (const t of tueren) if (t.art) vorlage(String(t.art));

    /* Die Art muss niemand nennen: Positionen im Bild heißen Plan, sonst ist es eine Liste. */
    const art =
      String(args.art ?? "").toLowerCase() ||
      (tueren.some((t) => t.x !== undefined && t.y !== undefined) ? "plan" : "tuerliste");
    if (!["plan", "tuerliste"].includes(art)) {
      throw new Error(`Art '${art}' gibt es nicht. Möglich: plan, tuerliste.`);
    }

    /*
     * Der Import entsteht erst weiter unten, wenn feststeht, dass es etwas zu verwahren gibt.
     * Ein zweiter Lauf derselben Datei soll keine leere Zeile hinterlassen, die dann jemand
     * wegräumen muss.
     */
    let imp = args.import ? await holeImport(ctx, String(args.import)) : null;

    /*
     * Die Türtypen stehen in der Liste — eine Türenliste führt je Zeile „FS 30 RD", „Vollspan",
     * „Alu-Rohrrahmen". Daraus leiten wir sie ab, statt sie hinterher von Hand nachzupflegen:
     * gleicher Name heißt gleicher Typ, und die Stammdaten der ersten Zeile (Zulassung,
     * Hersteller, OTS …) gelten für alle. Ebenso das Geschoss je Zeile, denn eine Liste
     * umfasst das ganze Haus, nicht ein Stockwerk.
     */
    const typen = new Map<string, string>();
    const typenNeu: string[] = [];
    for (const t of tueren) {
      const name = String(t.tuertyp ?? "").trim();
      if (name && !typen.has(name.toLowerCase())) {
        /*
         * Steht der Name im Vorrat, gilt der Vorrat: „Kunststofffenster DK" verlangt keine
         * Ident-Nummer, eine T30 schon. Sonst entstünde beim Import ein gleichnamiger Typ mit
         * pauschalen Pflichtangaben, und jedes Fenster meldete danach eine fehlende Ident-Nummer.
         */
        const bekannt = await tuertypPerName(ctx.env.DB, name);
        const vorhanden =
          bekannt ?? (await tuertypAusVorrat(ctx.env.DB, name, ctx.nutzer.benutzer));
        if (vorhanden) {
          typen.set(name.toLowerCase(), vorhanden.id);
          if (!bekannt) typenNeu.push(name);
        } else {
          const neuerTyp = await tuertypAnlegen(ctx.env.DB, {
            name,
            art: String(t.art ?? "wartung_drehfluegel"),
            beschreibung: `Aus ${art === "plan" ? "dem Plan" : "der Liste"} übernommen`,
            /* Was an dieser Zeile steht, gilt für alle Türen des Typs. */
            felder: { ...((t.felder ?? {}) as Record<string, string>) },
            pflicht: ["IDENT"],
            angelegt_von: ctx.nutzer.benutzer,
          });
          typen.set(name.toLowerCase(), neuerTyp.id);
          typenNeu.push(name);
        }
      }
      const typId = name ? typen.get(name.toLowerCase()) : undefined;
      if (typId) t.tuertyp_id = typId;
      if (t.geschoss) t.geschoss_id = await holeGeschoss(ctx, objekt, t.geschoss);
    }

    /*
     * Kennt das Objekt die Kennung schon, ist das keine neue Tür, sondern eine Ergänzung an
     * einer bekannten: der Grundriss trägt die Position nach, nachdem die Liste den Bestand
     * gelegt hat. Das wandert direkt ans Bauteil — Leitsatz 6 verlangt eine Freigabe für neue
     * Bauteile, nicht für die Koordinate einer Tür, die längst freigegeben ist.
     */
    const verortet: string[] = [];
    const neue: typeof tueren = [];
    for (const t of tueren) {
      const kennung = String(t.kennung ?? "").trim();
      const treffer = kennung ? await bauteilPerKennung(ctx.env.DB, objekt.id, kennung) : [];
      if (treffer.length === 1 && (t.x !== undefined || t.geschoss_id)) {
        const patch: Record<string, unknown> = {};
        if (t.x !== undefined && t.y !== undefined) {
          patch.x = t.x;
          patch.y = t.y;
        }
        if (t.richtung_grad !== undefined) patch.richtung_grad = t.richtung_grad;
        if (t.breite_m !== undefined) patch.breite_m = t.breite_m;
        if (t.geschoss_id && !treffer[0].geschoss_id) patch.geschoss_id = t.geschoss_id;
        if (Object.keys(patch).length) {
          await bauteilAendern(ctx.env.DB, treffer[0].id, patch);
          verortet.push(kennung);
          continue;
        }
      }
      neue.push(t);
    }

    /*
     * Dieselbe Datei ein zweites Mal zu lesen ist keine Seltenheit -- das Gespraech reisst ab,
     * der Agent faengt von vorn an. Ohne Schutz stuenden danach 148 Vorschlaege fuer 74 Fenster
     * da, und das faellt erst beim Freigeben auf. Also: eine Kennung, die schon als offener
     * Vorschlag dieses Objekts liegt, kommt kein zweites Mal dazu. Der Aufruf darf sich damit
     * gefahrlos wiederholen.
     */
    const schonOffen = new Set(
      (await vorschlaegeLesen(ctx.env.DB, { objekt_id: objekt.id, status: "offen" }))
        .map((v) => String(v.kennung ?? "").trim().toUpperCase())
        .filter(Boolean),
    );
    const doppelt: string[] = [];
    const frisch = neue.filter((t) => {
      const k = String(t.kennung ?? "").trim().toUpperCase();
      if (!k || !schonOffen.has(k)) return true;
      doppelt.push(k);
      return false;
    });

    if (!imp && (frisch.length || verortet.length)) {
      imp = await importAnlegen(ctx.env.DB, {
        objekt_id: objekt.id,
        art,
        dateiname: String(args.dateiname ?? "").trim() || "ohne Dateinamen",
        geschoss_id: art === "plan" ? await holeGeschoss(ctx, objekt, args.geschoss) : null,
        angelegt_von: ctx.nutzer.benutzer,
      });
    }
    if (!imp) {
      return {
        objekt: objekt.name,
        gefunden: 0,
        schon_offen: doppelt.length,
        bericht:
          `Diese Datei liegt schon offen im Objekt — alle ${doppelt.length} Kennungen sind ` +
          "bereits als Vorschlag da. Nichts doppelt angelegt.",
        weiter:
          "Nicht noch einmal einlesen. Mit 'stand' den offenen Import suchen und " +
          "ihn freigeben.",
      };
    }

    if (frisch.length) await vorschlaegeAnlegen(ctx.env.DB, imp, frisch);
    const alle = await vorschlaegeLesen(ctx.env.DB, { import_id: imp.id });
    const zahlen = zaehlen(alle);
    await importAendern(ctx.env.DB, imp.id, {
      status: "ausgewertet",
      ergebnis: { gefunden: alle.length, gemeldet_am: Date.now() },
    });

    const typenGesamt = new Set(alle.map((v) => v.tuertyp_id).filter(Boolean)).size;
    const offene = alle.filter((v) => v.status === "offen");
    const sicher = offene.filter((v) => v.konfidenz >= 0.85).length;
    const pflichtig = offene.filter((v) => v.wartungspflichtig === 1).length;
    const unsicher = offene.filter((v) => v.konfidenz < 0.6).length;

    return {
      import: imp.id,
      objekt: objekt.name,
      art,
      gefunden: alle.length + verortet.length,
      /* Türen, die es schon gab und die jetzt ihre Position im Plan haben. */
      verortet: verortet.length,
      /* Kennungen, die schon als offener Vorschlag lagen — übersprungen, nicht verdoppelt. */
      schon_offen: doppelt.length || undefined,
      /* Über den ganzen Import gezählt, nicht nur über diesen Stapel. */
      tuertypen: typenGesamt,
      tuertypen_neu: typenNeu,
      zahlen,
      /* Ein Satz, den man vorlesen kann — nicht die ganze Liste. */
      bericht: [
        doppelt.length
          ? `${doppelt.length} ${doppelt.length === 1 ? "Kennung lag" : "Kennungen lagen"} schon ` +
            "als offener Vorschlag vor — nicht doppelt angelegt."
          : "",
        verortet.length
          ? `${verortet.length} bekannte ${
              verortet.length === 1 ? "Tür" : "Türen"
            } im Plan verortet — die brauchen keine Freigabe.`
          : "",
        offene.length
          ? `${offene.length} neue ${offene.length === 1 ? "Tür" : "Türen"}` +
            (typenGesamt
              ? `, ${typenGesamt} ${typenGesamt === 1 ? "Türtyp" : "Türtypen"}` +
                (typenNeu.length ? ` (${typenNeu.length} davon neu)` : "")
              : "") +
            `, davon ${pflichtig} wartungspflichtig` +
            (unsicher
              ? `; ${unsicher} ${unsicher === 1 ? "ist" : "sind"} unsicher und würde ich ` +
                "einzeln zeigen."
              : ".")
          : verortet.length
            ? "Nichts Neues dabei."
            : "Nichts gefunden.",
      ]
        .filter(Boolean)
        .join(" "),
      freigabe_moeglichkeiten: !offene.length
        ? []
        : [
        { was: `alle ${offene.length} übernehmen`, aufruf: { alle: true } },
        ...(sicher
          ? [{ was: `nur die ${sicher} sicheren (ab 0.85)`, aufruf: { ab_konfidenz: 0.85 } }]
          : []),
        ...(pflichtig
          ? [
              {
                was: `nur die ${pflichtig} wartungspflichtigen`,
                aufruf: { nur_wartungspflichtige: true },
              },
            ]
          : []),
      ],
      link: `${ctx.origin}/objekt/${objekt.id}/import/${imp.id}`,
      weiter: offene.length
        ? "Den Bericht vorlesen und fragen, was übernommen werden soll. Dann " +
          "'einrichten' mit freigeben mit dieser Import-Kennung — mehr ist nicht nötig, der Import " +
          "schließt sich danach selbst."
        : "Fertig, nichts freizugeben. Kurz berichten, was verortet wurde.",
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
    const zahlenRest = zaehlen(rest);
    /*
     * Bleibt nichts offen, ist der Import fertig — dann muss ihn niemand eigens abschließen.
     * Bleibt etwas offen, bleibt er offen: dort steckt noch eine Entscheidung.
     */
    const offenDanach = rest.filter((v) => v.status === "offen").length;
    await importAendern(ctx.env.DB, imp.id, {
      status: offenDanach ? undefined : "bestaetigt",
      ergebnis: { angenommen: zahlenRest.angenommen },
    });
    /*
     * Ein ganzes Haus sind schnell 140 Bauteile. Die alle einzeln zurueckzugeben hiesse, dem
     * Agenten eine Liste vorzulegen, die niemand vorliest -- gebraucht wird ein Satz. Also: der
     * Satz, dazu die ersten paar Nummern zur Probe, der Rest als Zahl.
     */
    const probe = angelegt.slice(0, 12);
    const nummern = angelegt.map((b) => b.nr);
    const spanne =
      nummern.length > 1 ? `Nr. ${Math.min(...nummern)}-${Math.max(...nummern)}` : `Nr. ${nummern[0]}`;
    return {
      angelegt: angelegt.length,
      bericht: `${angelegt.length} Bauteile angelegt (${spanne}).`,
      bauteile: probe.map((b) => ({ nr: b.nr, kennung: b.kennung || undefined, art: b.art })),
      weitere: angelegt.length > probe.length ? angelegt.length - probe.length : undefined,
      zahlen: zahlenRest,
      noch_offen: offenDanach,
      import_abgeschlossen: offenDanach === 0,
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

/** Die Handgriffe des Imports — benutzt von `einrichten`, nicht mehr einzeln im Werkzeugkasten. */
export const IMPORT = {
  uebernehmen: bauplanUebernehmenTool.handler,
  freigeben: vorschlaegeAnnehmenTool.handler,
  verwerfen: vorschlaegeVerwerfenTool.handler,
  offene: vorschlaegeLesenTool.handler,
};

export { anleitung };
