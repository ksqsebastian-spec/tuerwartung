/**
 * Sechs Werkzeuge, mehr nicht.
 *
 * Vorher standen hier vierundvierzig. Für einen Menschen ist das ein Inhaltsverzeichnis; für
 * ein kleines Modell am Telefon ist jeder Name eine Abzweigung, an der es falsch abbiegen kann
 * — und achtundvierzig Kilobyte Beschreibung, die es vor jedem Wort mitliest. Der Ablauf hat
 * aber nur vier Schritte, und die tragen die Namen:
 *
 *   stand              was ist wo — Lagebild, ein Objekt, eine Tür
 *   wartung_starten    Termin am Objekt; bringt die Checklisten gleich mit
 *   tuer_erfassen      eine Tür oder ein Schwung, sofort geschrieben
 *   wartung_fertig     zurücklesen, Berichte und Sammelbericht in einem Zug
 *
 * Dazu zwei, die vorher im Büro gebraucht werden und nicht vor Ort:
 *
 *   einrichten         Objekt, Türtypen und Bestand — auch aus einer Türliste
 *   aendern            korrigieren, was schon steht
 *
 * Die Logik dahinter ist dieselbe geblieben; nur die Türen in den Raum sind weniger geworden.
 * Namen und Beschreibungen sind deutsch, weil diktiert wird und die Rückmeldungen vorgelesen
 * werden. `readOnlyHint` ist nicht Deko: der Hub sortiert Tools danach in Lesen/Schreiben.
 */
import type { Kontext, ToolDef } from "./protokoll";
import { TUERTYPEN, beschriftung } from "./tuertypen_werkzeuge";
import { IMPORT } from "./import_werkzeuge";
import { tuertypLesen, tuertypenListe } from "../daten/tuertypen";
import type { Tuertyp } from "../daten/tuertypen";
import { VORLAGEN, abweichungenKlartext } from "../vorlagen";
import { heute, zugriffPruefen } from "../daten/basis";
import { personLesen, personSpeichern } from "../daten/personen";
import {
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
  bauteilPerKennung,
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
  letztesMal,
  pruefungErfassen,
  pruefungenHistorie,
  pruefungenLesen,
} from "../daten/begehungen";
import type { Begehung } from "../daten/begehungen";
import { berichteErzeugen, berichtsUebersicht, sammelberichtErzeugen } from "../pdf/berichte";

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

/* ── Auflösung ─────────────────────────────────────────────────────────────── */

async function holeObjekt(ctx: Kontext, text: string): Promise<Objekt> {
  const o = await objektAufloesen(ctx.env.DB, text);
  zugriffPruefen(ctx.nutzer.benutzer, o.id);
  return o;
}

/**
 * Die Wartung finden, von der die Rede ist.
 *
 * Ohne Angabe: die jüngste, die noch läuft — es gibt im Alltag genau eine. Der Monteur sagt
 * „Tür 12", nicht eine 26-stellige Kennung, und soll die auch nicht mitschleppen müssen.
 */
async function holeWartung(ctx: Kontext, text?: string): Promise<Begehung> {
  if (text) {
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
    throw new Error(`Wartung '${text}' gibt es nicht — mit 'wartung_starten' beginnen.`);
  }
  const laufend = await begehungenListe(ctx.env.DB, { status: "laufend", limit: 2 });
  if (laufend.length === 1) return (await begehungLesen(ctx.env.DB, laufend[0].id))!;
  if (laufend.length > 1) {
    throw new Error(
      "Mehrere Wartungen laufen gerade. Objektnamen in 'wartung' mitgeben, damit klar ist, welche gemeint ist.",
    );
  }
  /*
   * Keine laufende — dann die von heute, auch wenn sie schon abgeschlossen ist. 'wartung_fertig'
   * schließt zuerst ab und erzeugt danach die Berichte; reicht die Rechenzeit nicht, wird
   * derselbe Aufruf wiederholt, und der muss dieselbe Wartung wiederfinden. Ebenso eine
   * Nachtragung, die dem Monteur zehn Minuten später einfällt.
   */
  const heutige = (await begehungenListe(ctx.env.DB, { limit: 5 })).filter(
    (b) => b.datum === heute() && b.status !== "abgebrochen",
  );
  if (heutige.length === 1) return (await begehungLesen(ctx.env.DB, heutige[0].id))!;
  if (heutige.length > 1) {
    throw new Error(
      "Heute gibt es mehrere Wartungen. Objektnamen in 'wartung' mitgeben, damit klar ist, welche gemeint ist.",
    );
  }
  throw new Error("Es läuft keine Wartung. Mit 'wartung_starten' anfangen.");
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
    /* Der wichtigste Satz für jemanden, der gleich hinfährt — deshalb steht er mit drin. */
    zugang: o.zugang || undefined,
    ident: o.ident || undefined,
    intervall_monate: o.intervall_monate,
  };
}

function ortText(b: { raumnummer: string; raum: string; bezeichnung: string; flur: string }) {
  return [b.raumnummer, b.raum || b.bezeichnung, b.flur].filter(Boolean).join(" · ") || undefined;
}

function bauteilAnsicht(b: BauteilMitStand) {
  return {
    nr: b.nr,
    kennung: b.kennung || undefined,
    ort: ortText(b),
    tuertyp: undefined as string | undefined,
    letzte_pruefung: b.letzte_pruefung || null,
    letztes_ergebnis: b.letztes_ergebnis || null,
    faellig_am: b.stand.faellig_am || "sofort",
    zustand: b.stand.zustand,
  };
}

/**
 * Die Checklisten, die an diesem Objekt gebraucht werden — und zwar gleich, nicht auf Nachfrage.
 *
 * Vorher musste der Agent vor der ersten Tür `checkliste_lesen` rufen, damit „Punkt 8"
 * überhaupt etwas bedeutet: ein geschenkter Gesprächszug, während der Monteur schon vor der Tür
 * steht. Jetzt hängen sie an der Antwort, mit der die Wartung beginnt.
 */
async function checklisten(ctx: Kontext, typIds: (string | null)[]) {
  const ids = [...new Set(typIds.filter((x): x is string => Boolean(x)))];
  const typen: Tuertyp[] = [];
  for (const id of ids) {
    const t = await tuertypLesen(ctx.env.DB, id);
    if (t) typen.push(t);
  }
  return typen.map((t) => ({
    tuertyp: t.name,
    vorlage: VORLAGEN[t.art]?.label ?? t.art,
    punkte: t.punkte.filter((p) => p.aktiv).map((p) => `${p.nr} ${p.text}`),
    pflichtfelder: t.pflicht.length ? t.pflicht : undefined,
    zusatzfelder: t.zusatz.length ? t.zusatz.map((z) => z.schluessel) : undefined,
  }));
}

/**
 * Welche Angaben eine Tür ihrem Türtyp noch schuldig ist.
 *
 * Das blockiert nichts. Vorher verweigerte das Einrichten einer Tür den Abschluss, solange eine
 * Pflichtangabe fehlte — mitten im Rundgang, mit Handschuhen, vor einer Tür, deren Typenschild
 * hinter dem Türblatt klebt. Jetzt wird gespeichert und die Lücke am Ende gesammelt gemeldet.
 */
function fehlendeFelder(typ: Tuertyp | null, felder: Record<string, string>): string[] {
  if (!typ) return [];
  return typ.pflicht
    .filter((f) => !String(felder[f] ?? "").trim())
    .map((f) => beschriftung(f));
}

/* ── 1. stand ──────────────────────────────────────────────────────────────── */

const stand: ToolDef = {
  name: "stand",
  title: "Wo stehen wir?",
  description:
    "Die eine Auskunft. Ohne Angabe das Lagebild: was ist überfällig, was wird bald fällig, wo " +
    "stehen Berichte aus. Mit 'objekt' die Liegenschaft mit ihrem ganzen Bestand in " +
    "Laufreihenfolge, den Checklisten ihrer Türtypen und den letzten Terminen. Mit 'objekt' " +
    "und 'tuer' die Geschichte dieser einen Tür über die Jahre. Das ist die Antwort auf 'was " +
    "ist los?', 'gibt es das Objekt schon?' und 'was war letztes Mal an Tür 12?'.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse. Ohne das kommt das Lagebild über alle Objekte."),
      tuer: int("Nummer einer Tür an diesem Objekt — dann kommt ihre Geschichte."),
      tage: int("Vorlauf für 'bald fällig' in Tagen, Standard 30"),
    },
    additionalProperties: false,
  },
  annotations: NUR_LESEN,
  async handler(args, ctx) {
    if (!args.objekt) return lagebild(ctx, Number(args.tage ?? 30) || 30);

    const objekt = await holeObjekt(ctx, String(args.objekt));
    const geschosse = await geschosseListe(ctx.env.DB, objekt.id);
    const bauteile = inLaufreihenfolge(await bauteileMitStand(ctx.env.DB, objekt), geschosse);

    if (args.tuer !== undefined && args.tuer !== null) {
      const b = bauteile.find((x) => x.nr === Number(args.tuer));
      if (!b) throw new Error(`Tür ${args.tuer} gibt es an '${objekt.name}' nicht.`);
      const typ = b.tuertyp_id ? await tuertypLesen(ctx.env.DB, b.tuertyp_id) : null;
      const historie = await pruefungenHistorie(ctx.env.DB, b.id);
      return {
        objekt: objekt.name,
        tuer: { ...bauteilAnsicht(b), tuertyp: typ?.name, felder: b.felder },
        geprueft: historie.map((h) => ({
          datum: h.datum,
          ergebnis: h.ergebnis,
          abweichungen: abweichungenKlartext(b.art, h.checks, typ?.punkte),
          hinweise: h.hinweise || undefined,
        })),
        link: `${ctx.origin}/objekt/${objekt.id}/bauteil/${b.nr}`,
      };
    }

    const begehungen = await begehungenListe(ctx.env.DB, { objekt_id: objekt.id, limit: 5 });
    const typen = new Map<string, string | null>();
    for (const b of bauteile) typen.set(b.id, b.tuertyp_id);
    return {
      objekt: objektAnsicht(objekt),
      link: `${ctx.origin}/objekt/${objekt.id}`,
      geschosse: geschosse.map((g) => g.name),
      tueren_gesamt: bauteile.length,
      faellig: bauteile.filter(istFaellig).length,
      nicht_bestanden: bauteile.filter((b) => b.letztes_ergebnis === "Nachbesserung").length,
      tueren: bauteile.map((b) => bauteilAnsicht(b)),
      checklisten: await checklisten(ctx, [...typen.values()]),
      termine: begehungen.map((b) => ({
        id: b.id,
        datum: b.datum,
        status: b.status,
        pruefungen: b.pruefungen,
      })),
    };
  },
};

/** Das Lagebild über alle Objekte — kurz genug zum Vorlesen. */
async function lagebild(ctx: Kontext, tage: number) {
  const liste = await objekteListe(ctx.env.DB, { limit: 500 });
  const ueberfaellig = liste.filter((o) => o.stand.nie_geprueft || (o.stand.tage ?? 1e9) <= 0);
  const bald = liste.filter(
    (o) => !ueberfaellig.includes(o) && (o.stand.tage ?? 1e9) <= tage,
  );

  /* Termine, an denen etwas erfasst wurde, deren Berichte aber noch fehlen. */
  const offen: { objekt: string; datum: string; wartung: string; fehlt: number }[] = [];
  for (const o of liste) {
    for (const b of await begehungenListe(ctx.env.DB, { objekt_id: o.id, limit: 3 })) {
      if (!b.pruefungen || b.status === "abgebrochen") continue;
      const voll = await begehungLesen(ctx.env.DB, b.id);
      if (!voll) continue;
      const posten = await berichtsUebersicht(ctx.env, voll, o);
      const fehlt = b.pruefungen - posten.length + posten.filter((p) => p.veraltet).length;
      if (fehlt > 0) offen.push({ objekt: o.name, datum: b.datum, wartung: b.id, fehlt });
    }
  }

  const zeile = (o: (typeof liste)[number]) => ({
    objekt: o.name,
    adresse: o.adresse || undefined,
    tueren: o.bauteile,
    faellig: o.faellige_bauteile,
    nicht_bestanden: o.nicht_bestanden || undefined,
    faellig_am: o.stand.nie_geprueft ? "noch nie geprüft" : o.stand.faellig_am,
    zugang: undefined as string | undefined,
  });

  return {
    stand: heute(),
    zusammenfassung:
      ueberfaellig.length || bald.length || offen.length
        ? `${ueberfaellig.length} überfällig, ${bald.length} in ${tage} Tagen fällig, ` +
          `${offen.length} Termine mit offenen Berichten.`
        : "Nichts liegt an.",
    ueberfaellig: ueberfaellig.map(zeile),
    bald_faellig: bald.map(zeile),
    berichte_offen: offen,
    objekte_gesamt: liste.length,
  };
}

/* ── 2. wartung_starten ────────────────────────────────────────────────────── */

const wartungStarten: ToolDef = {
  name: "wartung_starten",
  title: "Wartung starten",
  description:
    "Beginnt den Termin an einem Objekt — einmal, ganz am Anfang. Kennt der Server das Objekt " +
    "nicht, legt er es an: die erste Wartung ist die Bestandsaufnahme. Läuft am selben Tag " +
    "schon eine, wird sie fortgesetzt statt verdoppelt; ein abgebrochenes Gespräch kostet also " +
    "nichts. Die Antwort bringt alles mit, was zum Diktieren nötig ist: die fälligen Türen in " +
    "Laufreihenfolge, die Checklisten der hier vorkommenden Türtypen (damit 'Punkt 8' etwas " +
    "bedeutet) und was beim letzten Mal nicht in Ordnung war. Danach nur noch 'tuer_erfassen'.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("ID, Name oder Adresse des Objekts"),
      datum: str("Prüfdatum YYYY-MM-DD, Standard heute"),
      pruefer: str("Name des Prüfers, sonst der angemeldete Nutzer bzw. seine Vorgabe"),
      beteiligte: str("Beteiligte Personen oder Messgeräte, falls zu nennen"),
      adresse: str("Adresse, falls das Objekt neu angelegt wird"),
      betreiber: str("Betreiber, falls das Objekt neu angelegt wird"),
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
    let neuAngelegt = false;
    if (!objekt) {
      objekt = await objektAnlegen(ctx.env.DB, {
        name: String(args.objekt).trim(),
        adresse: args.adresse ?? "",
        betreiber: args.betreiber ?? "",
        angelegt_von: ctx.nutzer.benutzer,
      });
      neuAngelegt = true;
    }
    zugriffPruefen(ctx.nutzer.benutzer, objekt.id);

    const { begehung, fortgesetzt } = await begehungFuerTag(ctx.env.DB, objekt.id, datum, {
      pruefer: args.pruefer ?? v.pruefer ?? ctx.nutzer.name,
      befaehigung: v.befaehigung,
      ort: v.ort,
      beteiligte: args.beteiligte,
      angelegt_von: ctx.nutzer.benutzer,
    });

    const geschosse = await geschosseListe(ctx.env.DB, objekt.id);
    const bauteile = inLaufreihenfolge(await bauteileMitStand(ctx.env.DB, objekt), geschosse);
    const faellige = bauteile.filter(istFaellig);

    /* Was beim letzten Mal offen blieb, gehört an den Anfang — danach wird gefragt. */
    const nachsehen: { nr: number; seit: string; punkte: string[]; hinweise?: string }[] = [];
    for (const b of faellige) {
      const alt = await letztesMal(ctx.env.DB, b.id, begehung.id);
      if (alt) {
        nachsehen.push({
          nr: b.nr,
          seit: alt.datum,
          punkte: alt.punkte,
          hinweise: alt.hinweise || undefined,
        });
      }
    }

    return {
      wartung: begehung.id,
      objekt: objektAnsicht(objekt),
      datum: begehung.datum,
      pruefer: begehung.pruefer,
      fortgesetzt,
      objekt_neu_angelegt: neuAngelegt || undefined,
      link: `${ctx.origin}/objekt/${objekt.id}`,
      faellige_tueren: faellige.map((b) => ({
        nr: b.nr,
        ort: ortText(b),
        kennung: b.kennung || undefined,
      })),
      tueren_gesamt: bauteile.length,
      checklisten: await checklisten(ctx, bauteile.map((b) => b.tuertyp_id)),
      nachsehen,
      naechste_nr: await naechsteNr(ctx.env.DB, objekt.id),
      hinweis: neuAngelegt
        ? "Neues Objekt — diese Wartung ist die Bestandsaufnahme. Jede diktierte Tür legt eine an."
        : undefined,
    };
  },
};

/* ── 3. tuer_erfassen ──────────────────────────────────────────────────────── */

const tuerErfassen: ToolDef = {
  name: "tuer_erfassen",
  title: "Tür erfassen",
  description:
    "Schreibt eine diktierte Tür sofort weg — nach JEDER Tür einmal aufrufen, nichts im " +
    "Gespräch puffern: bricht es ab, ist alles Geschriebene sicher. Mehrere Türen dürfen in " +
    "einem Aufruf stehen, wenn sie in einem Zug diktiert wurden.\n\n" +
    "Standard ist: alles in Ordnung. Nur Abweichungen als 'checks' nennen, z. B. " +
    "{\"8\":\"nio\"}. Bewertungen: nio = nicht in Ordnung · sb = siehe Bemerkung (Text nach " +
    "'hinweise') · nz = nicht zutreffend. Eine Abweichung heißt: die Tür hat NICHT bestanden — " +
    "das ergibt sich von selbst, niemand muss es extra sagen.\n\n" +
    "'Tür 12' meint die Tür Nr. 12 dieses Objekts, nicht die zwölfte des Tages; eine " +
    "unbekannte Nummer wird angelegt ('Tür 12 ist neu — lege ich an'). Eine schon erfasste " +
    "Nummer wird überschrieben, das ist der Weg für Korrekturen. Fehlt einer neuen Tür eine " +
    "Pflichtangabe ihres Türtyps, wird trotzdem gespeichert und die Lücke gemeldet — gefragt " +
    "wird am Ende, nicht mitten im Rundgang.",
  inputSchema: {
    type: "object",
    properties: {
      wartung: str("Kennung der Wartung. Ohne Angabe die eine, die gerade läuft."),
      tueren: {
        type: "array",
        description: "Die diktierten Türen, in der Reihenfolge, in der sie genannt wurden.",
        items: {
          type: "object",
          properties: {
            nr: int("Türnummer des Objekts. Ohne Angabe zählt der Server hoch."),
            kennung: str("Türnummer aus Plan oder Liste, z. B. 'T-2.14'"),
            tuertyp: str(
              "Name des Türtyps — nur nötig, wenn die Tür neu ist oder der Typ wechselt. " +
                "Ein Name aus dem Vorrat genügt, er entsteht beim ersten Gebrauch.",
            ),
            checks: {
              type: "object",
              description: "Nur die Abweichungen: {\"8\":\"nio\",\"10\":\"sb\"}",
              additionalProperties: { type: "string" },
            },
            hinweise: str("Bemerkung im Klartext, z. B. 'Dichtung spröde'"),
            raumnummer: str("z. B. '1.04' — daraus erkennt der Server auch die Etage"),
            raum: str("Raumbezeichnung, z. B. 'Gruppenraum Ost'"),
            flur: str("Flur oder Bauteil des Hauses"),
            geschoss: str("Etage, falls sie nicht aus der Raumnummer hervorgeht"),
            felder: {
              type: "object",
              description:
                "Stammdaten dieser einen Tür: IDENT, HERSTELLER, ZULASSUNG … Was für alle " +
                "Türen des Typs gilt, steht am Türtyp und muss hier nicht wiederholt werden.",
              additionalProperties: { type: "string" },
            },
            ergebnis: str("'bestanden' | 'Nachbesserung' — nur wenn es den Kreuzen widerspricht"),
            wie_davor: bool("true übernimmt Kreuze und Felder der zuletzt erfassten Tür"),
          },
          additionalProperties: false,
        },
      },
    },
    required: ["tueren"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const begehung = await holeWartung(ctx, args.wartung ? String(args.wartung) : undefined);
    const objekt = (await objektLesen(ctx.env.DB, begehung.objekt_id))!;
    const liste = (Array.isArray(args.tueren) ? args.tueren : []) as Record<string, any>[];
    if (!liste.length) throw new Error("'tueren' ist leer — nichts zu erfassen.");

    const gespeichert: string[] = [];
    const neu: number[] = [];
    const nachsehen: { nr: number; seit: string; punkte: string[]; hinweise?: string }[] = [];
    const unvollstaendig: { nr: number; fehlt: string[] }[] = [];

    for (const e of liste) {
      const erf = await pruefungErfassen(ctx.env.DB, objekt, begehung, e, ctx.nutzer.benutzer);
      const ort = [erf.geschoss?.name, ortText(erf.bauteil)].filter(Boolean).join(" · ");
      const abw = abweichungenKlartext(
        erf.bauteil.art,
        erf.pruefung.checks,
        erf.tuertyp?.punkte,
      );
      gespeichert.push(
        `Tür ${erf.bauteil.nr}${ort ? ` · ${ort}` : ""} · ${erf.pruefung.ergebnis}` +
          (abw.length ? ` (${abw.join("; ")})` : ""),
      );
      if (erf.neu_angelegt) neu.push(erf.bauteil.nr);
      if (erf.letztes_mal) {
        nachsehen.push({
          nr: erf.bauteil.nr,
          seit: erf.letztes_mal.datum,
          punkte: erf.letztes_mal.punkte,
          hinweise: erf.letztes_mal.hinweise || undefined,
        });
      }
      const typ = erf.bauteil.tuertyp_id
        ? await tuertypLesen(ctx.env.DB, erf.bauteil.tuertyp_id)
        : null;
      const fehlt = fehlendeFelder(typ, erf.bauteil.felder);
      if (fehlt.length) unvollstaendig.push({ nr: erf.bauteil.nr, fehlt });
    }

    /* Wie viele fällige Türen noch fehlen — der Satz, der am Ende die Vollständigkeit trägt. */
    const geprueft = new Set((await pruefungenLesen(ctx.env.DB, begehung.id)).map((p) => p.bauteil_id));
    const alle = await bauteileMitStand(ctx.env.DB, objekt);
    const offen = alle.filter((b) => istFaellig(b) && !geprueft.has(b.id)).length;

    return {
      gespeichert,
      neu_angelegt: neu.length ? neu : undefined,
      nachsehen: nachsehen.length ? nachsehen : undefined,
      unvollstaendig: unvollstaendig.length ? unvollstaendig : undefined,
      noch_offen: offen,
      naechste_nr: await naechsteNr(ctx.env.DB, objekt.id),
    };
  },
};

/* ── 4. wartung_fertig ─────────────────────────────────────────────────────── */

const wartungFertig: ToolDef = {
  name: "wartung_fertig",
  title: "Wartung abschließen",
  description:
    "Auf 'Fertig': liest alles zurück (je Tür Ort, Abweichungen im Klartext, Ergebnis), nennt " +
    "die fälligen Türen, die noch fehlen, UND erzeugt in demselben Zug die Berichte und den " +
    "Sammelbericht. Ein Aufruf, kein Dreisprung. Kommt 'fertig: false' zurück, reichte die " +
    "Rechenzeit nicht: einfach noch einmal aufrufen. Erzeugt wird nur, wo sich etwas geändert " +
    "hat — zweimal aufrufen macht keine zweite Version. Die Berichte liegen danach getrennt " +
    "nach bestanden und Nachbesserung auf der Objektseite. Mit 'abbrechen' platzt der Termin " +
    "stattdessen; bereits erfasste Türen bleiben erhalten.",
  inputSchema: {
    type: "object",
    properties: {
      wartung: str("Kennung der Wartung. Ohne Angabe die eine, die gerade läuft."),
      abbrechen: bool("true bricht den Termin ab, statt ihn abzuschließen"),
      alle_neu: bool("true erzwingt eine neue Version aller Berichte"),
    },
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const begehung = await holeWartung(ctx, args.wartung ? String(args.wartung) : undefined);
    const objekt = (await objektLesen(ctx.env.DB, begehung.objekt_id))!;

    if (args.abbrechen === true) {
      const e = await begehungAbbrechen(ctx.env.DB, begehung.id);
      return {
        abgebrochen: true,
        objekt: objekt.name,
        erhaltene_pruefungen: e.pruefungen,
        hinweis: e.geloescht
          ? "Der Termin war leer und ist weg."
          : `${e.pruefungen} bereits erfasste bleiben erhalten.`,
      };
    }

    const neu = (await begehungAendern(ctx.env.DB, begehung.id, { status: "abgeschlossen" }))!;
    const geschosse = await geschosseListe(ctx.env.DB, objekt.id);
    const pruefungen = await pruefungenLesen(ctx.env.DB, neu.id);
    const bauteile = inLaufreihenfolge(await bauteileMitStand(ctx.env.DB, objekt), geschosse);
    const geprueft = new Set(pruefungen.map((p) => p.bauteil_id));
    const reihenfolge = new Map(bauteile.map((b, i) => [b.id, i]));
    const fehlend = bauteile.filter((b) => istFaellig(b) && !geprueft.has(b.id));

    const rueckblick = pruefungen
      .sort((a, b) => (reihenfolge.get(a.bauteil_id) ?? 0) - (reihenfolge.get(b.bauteil_id) ?? 0))
      .map((p) => ({
        nr: p.bauteil.nr,
        ort: ortText(p.bauteil),
        ergebnis: p.ergebnis,
        abweichungen: abweichungenKlartext(p.bauteil.art, p.checks),
        hinweise: p.hinweise || undefined,
      }));

    const kopf = {
      wartung: neu.id,
      objekt: objekt.name,
      datum: neu.datum,
      link: `${ctx.origin}/objekt/${objekt.id}/berichte`,
      geprueft: pruefungen.length,
      nachbesserung: pruefungen.filter((p) => p.ergebnis === "Nachbesserung").length,
      rueckblick,
      fehlende_faellige_tueren: fehlend.map((b) => ({ nr: b.nr, ort: ortText(b) })),
      unterschrift: `${ctx.origin}/begehung/${neu.id}/unterschrift`,
    };

    if (!pruefungen.length) {
      return { ...kopf, berichte: { erzeugt: 0, fertig: true }, sammelbericht: null };
    }

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
      ...kopf,
      berichte: {
        erzeugt: lauf.erzeugt,
        offen: lauf.offen,
        fertig: lauf.fertig,
        hinweis: lauf.fertig ? undefined : "Rechenzeit war knapp — noch einmal aufrufen.",
      },
      sammelbericht: sammel,
      alle_als_zip: lauf.fertig ? `${ctx.origin}/begehung/${neu.id}/paket.zip` : undefined,
    };
  },
};

/* ── 5. einrichten ─────────────────────────────────────────────────────────── */

const einrichten: ToolDef = {
  name: "einrichten",
  title: "Objekt einrichten",
  description:
    "Der Weg vor der Wartung, am besten im Büro. Ein Aufruf nimmt entgegen, was schon bekannt " +
    "ist, und meldet zurück, was noch fehlt — es wird nicht Frage für Frage abgefragt, das " +
    "Fragen ist deine Sache.\n\n" +
    "• Stammdaten: Adresse, Betreiber, Ansprechpartner mit Telefon, Intervall und vor allem " +
    "'zugang' — wie man reinkommt ('Schlüssel beim Hausmeister'). Das ist das Feld, das die " +
    "vergebliche Anfahrt verhindert.\n" +
    "• Türtypen: was für alle Türen einer Art gleich ist, samt eigener Checkliste. Die " +
    "gängigen liegen im Vorrat und entstehen beim ersten Gebrauch — 'stand' zeigt sie.\n" +
    "• Bestand: die Türen. Aus einer Türenliste oder einem Grundriss liest DU die Zeilen und " +
    "gibst sie hier ab; Türtypen, Geschosse, Nummern und Laufreihenfolge legt der Server dabei " +
    "selbst an. Daraus werden noch keine Türen: erst 'freigeben' macht welche daraus, und " +
    "genau das muss ein Mensch entschieden haben. Den 'bericht' aus der Antwort vorlesen und " +
    "die Freigabe einholen. Der Aufruf darf sich wiederholen — schon Bekanntes kommt nicht " +
    "doppelt.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("Name, Adresse oder ID. Gibt es das Objekt nicht, wird es angelegt."),
      stammdaten: {
        type: "object",
        description:
          "Was am Objekt gilt: adresse, plz, betreiber, betreiber_kontakt, telefon, email, " +
          "zugang, vertrag, objektart, ident, intervall_monate, rechtsgrundlagen, notizen.",
        additionalProperties: true,
      },
      tuertypen: {
        type: "array",
        description: "Türtypen, die es hier braucht — nur, wenn keiner aus dem Vorrat passt.",
        items: {
          type: "object",
          properties: {
            name: str("Sprechender Name, z. B. 'T30 Flurtür Hörmann'"),
            vorlage: str("wartung_drehfluegel | wartung_fenster | wartung_feststellanlagen"),
            beschreibung: str("Wofür dieser Typ steht"),
            felder: {
              type: "object",
              description: "Stammdaten für alle Türen dieses Typs, z. B. {\"HERSTELLER\":\"Hörmann\"}",
              additionalProperties: { type: "string" },
            },
            pflichtfelder: {
              type: "array",
              description: "Was je Tür stehen sollte, meist [\"IDENT\"]",
              items: { type: "string" },
            },
          },
          required: ["name", "vorlage"],
          additionalProperties: false,
        },
      },
      tueren: {
        type: "array",
        description:
          "Was du in der Türenliste oder im Grundriss gefunden hast. Je Zeile: kennung, " +
          "tuertyp, art, geschoss, raumnummer, raum, flur, felder, konfidenz (0..1), bei einem " +
          "Plan zusätzlich x und y als Anteile 0..1. Alles aus einer Türenliste gilt als " +
          "wartungspflichtig; was es nicht ist (Festverglasung, ausgenommene Zimmertür), " +
          "bekommt wartungspflichtig: false.",
        items: { type: "object", additionalProperties: true },
      },
      dateiname: str("Woher die Zeilen stammen — steht später in der Herkunft"),
      art: str("'tuerliste' (Standard) oder 'plan', wenn Koordinaten dabei sind"),
      freigeben: {
        type: "object",
        description:
          "Die Freigabe, wenn der Mensch zugestimmt hat: {\"alle\": true} oder " +
          "{\"ab_konfidenz\": 0.85}. Erst damit entstehen Türen.",
        additionalProperties: true,
      },
    },
    required: ["objekt"],
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    /* Das Objekt zuerst — alles Weitere hängt daran. */
    let objekt = await objektSuchen(ctx.env.DB, pflicht<string>(args, "objekt"));
    let neuAngelegt = false;
    if (!objekt) {
      objekt = await objektAnlegen(ctx.env.DB, {
        name: String(args.objekt).trim(),
        ...(args.stammdaten as Record<string, unknown>),
        angelegt_von: ctx.nutzer.benutzer,
      } as never);
      neuAngelegt = true;
    } else if (args.stammdaten && Object.keys(args.stammdaten).length) {
      zugriffPruefen(ctx.nutzer.benutzer, objekt.id);
      objekt = (await objektAendern(ctx.env.DB, objekt.id, args.stammdaten as never))!;
    }
    zugriffPruefen(ctx.nutzer.benutzer, objekt.id);

    const angelegteTypen: string[] = [];
    for (const t of (args.tuertypen ?? []) as Record<string, any>[]) {
      await TUERTYPEN.anlegen(t, ctx);
      angelegteTypen.push(String(t.name));
    }

    let vorschlaege: unknown = undefined;
    if (Array.isArray(args.tueren) && args.tueren.length) {
      const art = String(args.art ?? "tuerliste");
      /*
       * Eine Türenliste ist der Bestand, den jemand für dieses Haus aufgeschrieben hat — was
       * darin steht, wird gewartet, sofern nicht ausdrücklich das Gegenteil dabeisteht. Ohne
       * diese Vorgabe landeten alle Türen mit `wartungspflichtig = 0` im Bestand und tauchten
       * danach in keiner Fälligkeit auf: der Bestand stand da und die Wartung sah ihn nicht.
       * Bei einem Plan bleibt es beim ausdrücklichen Vermerk — dort rät der Agent.
       */
      const tueren = (args.tueren as Record<string, unknown>[]).map((t) =>
        art === "plan" || t.wartungspflichtig !== undefined
          ? t
          : { ...t, wartungspflichtig: true },
      );
      vorschlaege = await IMPORT.uebernehmen(
        { objekt: objekt.id, tueren, art, dateiname: args.dateiname },
        ctx,
      );
    }

    let freigabe: unknown = undefined;
    if (args.freigeben) {
      /*
       * Die Freigabe braucht den Import, zu dem sie gehört. Im Regelfall ist das der, den
       * derselbe Aufruf gerade angelegt hat; kommt sie später („nimm alle ab 0.85"), wird der
       * offene Import dieses Objekts gesucht — es gibt im Alltag genau einen.
       */
      const importId =
        (args.freigeben as Record<string, unknown>).import ??
        (vorschlaege as { import?: string } | undefined)?.import ??
        (await offenerImport(ctx, objekt.id));
      if (!importId) throw new Error("Es liegt nichts zur Freigabe bereit.");
      freigabe = await IMPORT.freigeben({ ...(args.freigeben as object), import: importId }, ctx);
    }

    /* Was am Objekt noch fehlt — als Liste, nicht als Frage. Gefragt wird im Gespräch. */
    const wichtig: [keyof Objekt, string][] = [
      ["adresse", "Adresse"],
      ["betreiber", "Betreiber"],
      ["betreiber_kontakt", "Ansprechpartner vor Ort"],
      ["telefon", "Telefonnummer"],
      ["zugang", "Wie man reinkommt"],
    ];
    const fehlt = wichtig.filter(([f]) => !String(objekt![f] ?? "").trim()).map(([, l]) => l);
    const bestand = await bauteileMitStand(ctx.env.DB, objekt);

    return {
      objekt: objektAnsicht(objekt),
      objekt_neu_angelegt: neuAngelegt || undefined,
      link: `${ctx.origin}/objekt/${objekt.id}`,
      tuertypen_angelegt: angelegteTypen.length ? angelegteTypen : undefined,
      vorschlaege,
      freigabe,
      tueren_im_bestand: bestand.length,
      fehlt_noch: fehlt.length ? fehlt : undefined,
      weiter: fehlt.length
        ? `Frag nach: ${fehlt.join(", ")}. Was er nicht weiß, bleibt leer.`
        : bestand.length
          ? "Das Objekt steht. Vor Ort dann 'wartung_starten'."
          : "Stammdaten stehen. Es fehlt noch der Bestand — Türenliste einlesen oder vor Ort diktieren.",
    };
  },
};

/** Der offene Import eines Objekts — der, aus dem die Freigabe Türen machen soll. */
async function offenerImport(ctx: Kontext, objektId: string): Promise<string | undefined> {
  const zeile = await ctx.env.DB.prepare(
    `SELECT DISTINCT v.import_id FROM vorschlaege v
       WHERE v.objekt_id = ? AND v.status = 'offen'
       ORDER BY v.import_id DESC LIMIT 1`,
  )
    .bind(objektId)
    .first<{ import_id: string }>();
  return zeile?.import_id;
}

/* ── 6. aendern ────────────────────────────────────────────────────────────── */

const aendern: ToolDef = {
  name: "aendern",
  title: "Korrigieren",
  description:
    "Berichtigt, was schon steht — Objekt, eine einzelne Tür, einen Türtyp samt Checkliste " +
    "oder die eigenen Standardwerte. Nur die genannten Felder werden angefasst. " +
    "Stammdatenänderungen wirken auf alle Berichte, die danach neu erzeugt werden; um sie in " +
    "bestehende zu bekommen, danach 'wartung_fertig' mit alle_neu.\n\n" +
    "Eine falsch diktierte Prüfung braucht das hier nicht: 'tuer_erfassen' mit derselben " +
    "Nummer überschreibt sie.",
  inputSchema: {
    type: "object",
    properties: {
      objekt: str("Objekt, auf das sich die Änderung bezieht"),
      stammdaten: {
        type: "object",
        description: "Felder des Objekts, wie bei 'einrichten'",
        additionalProperties: true,
      },
      tuer: int("Nummer der Tür, die geändert werden soll"),
      tuer_felder: {
        type: "object",
        description:
          "Was sich an dieser Tür ändert: kennung, tuertyp, raumnummer, raum, flur, geschoss, " +
          "felder (wird gemischt), intervall_monate, wartungspflichtig, aktiv (false legt still).",
        additionalProperties: true,
      },
      tuertyp: str("Name oder ID eines Türtyps, der geändert werden soll"),
      tuertyp_felder: {
        type: "object",
        description: "name, beschreibung, felder, pflichtfelder, zusatzfelder, aktiv",
        additionalProperties: true,
      },
      checkliste: {
        type: "array",
        description:
          "Punkte des Türtyps zurechtlegen. Je Eintrag: {nr, text} benennt um, {nr, aus: true} " +
          "blendet aus, {text} ohne nr ergänzt einen eigenen Punkt.",
        items: { type: "object", additionalProperties: true },
      },
      tuertyp_loeschen: bool("true löscht den genannten Türtyp — nur, solange keine Tür daran hängt"),
      vorgaben: {
        type: "object",
        description:
          "Eigene Standardwerte für künftige Wartungen: pruefer, befaehigung, ort, " +
          "rechtsgrundlagen. Sie füllen jede neue Wartung vor.",
        additionalProperties: true,
      },
    },
    additionalProperties: false,
  },
  annotations: SCHREIBT,
  async handler(args, ctx) {
    const getan: string[] = [];

    if (args.vorgaben) {
      const person = await personLesen(ctx.env.DB, ctx.nutzer.benutzer);
      await personSpeichern(ctx.env.DB, ctx.nutzer.benutzer, {
        vorgaben: { ...(person?.vorgaben ?? {}), ...(args.vorgaben as object) },
      });
      getan.push("Standardwerte gespeichert");
    }

    if (args.tuertyp && args.tuertyp_loeschen === true) {
      await TUERTYPEN.loeschen({ tuertyp: args.tuertyp }, ctx);
      getan.push(`Türtyp '${args.tuertyp}' gelöscht`);
    } else if (args.tuertyp && args.tuertyp_felder) {
      await TUERTYPEN.aendern({ tuertyp: args.tuertyp, ...(args.tuertyp_felder as object) }, ctx);
      getan.push(`Türtyp '${args.tuertyp}' geändert`);
    }

    if (args.tuertyp && Array.isArray(args.checkliste)) {
      await TUERTYPEN.checklisteAnpassen({ tuertyp: args.tuertyp, punkte: args.checkliste }, ctx);
      getan.push("Checkliste angepasst");
    }

    let objekt: Objekt | null = null;
    if (args.objekt) {
      objekt = await holeObjekt(ctx, String(args.objekt));
      if (args.stammdaten && Object.keys(args.stammdaten).length) {
        objekt = (await objektAendern(ctx.env.DB, objekt.id, args.stammdaten as never))!;
        getan.push(`Stammdaten von '${objekt.name}' geändert`);
      }
      if (args.tuer !== undefined && args.tuer !== null && args.tuer_felder) {
        const alle = await bauteileMitStand(ctx.env.DB, objekt, { auch_stillgelegte: true });
        const b = alle.find((x) => x.nr === Number(args.tuer));
        if (!b) throw new Error(`Tür ${args.tuer} gibt es an '${objekt.name}' nicht.`);
        const f = args.tuer_felder as Record<string, any>;
        const patch: Record<string, unknown> = { ...f };
        if (f.felder) patch.felder = { ...b.felder, ...f.felder };
        if (f.tuertyp) {
          const t = await tuertypLesen(ctx.env.DB, String(f.tuertyp));
          const gefunden = t ?? (await tuertypenListe(ctx.env.DB)).find(
            (x) => x.name.toLowerCase() === String(f.tuertyp).toLowerCase(),
          );
          if (!gefunden) throw new Error(`Türtyp '${f.tuertyp}' gibt es nicht.`);
          patch.tuertyp_id = gefunden.id;
          patch.art = gefunden.art;
          delete patch.tuertyp;
        }
        if (f.aktiv === false) patch.aktiv = 0;
        if (f.aktiv === true) patch.aktiv = 1;
        if (f.wartungspflichtig === false) patch.wartungspflichtig = 0;
        if (f.wartungspflichtig === true) patch.wartungspflichtig = 1;
        await bauteilAendern(ctx.env.DB, b.id, patch);
        getan.push(`Tür ${b.nr} geändert`);
      }
    }

    if (!getan.length) throw new Error("Nichts zu ändern — was genau soll anders werden?");
    return {
      geaendert: getan,
      link: objekt ? `${ctx.origin}/objekt/${objekt.id}` : `${ctx.origin}/stammdaten`,
    };
  },
};

export const TOOLS: ToolDef[] = [
  stand,
  wartungStarten,
  tuerErfassen,
  wartungFertig,
  einrichten,
  aendern,
];

export const ANLEITUNG =
  "Türwerk — Türenwartung für Seehafer Elemente. Ein Objekt trägt seine Türen, eine Wartung " +
  "prüft sie, die Berichte fallen hinten heraus, getrennt nach bestanden und Nachbesserung.\n\n" +
  "Vor Ort sind es drei Schritte: (1) 'wartung_starten' mit dem Objekt — die Antwort bringt " +
  "die fälligen Türen, die Checklisten und das, was letztes Mal offen war. Kennt der Server " +
  "das Objekt nicht, legt er es an. (2) Nach JEDER diktierten Tür 'tuer_erfassen' und kurz " +
  "quittieren; nicht im Gespräch puffern. Standard ist: alles in Ordnung — nur Abweichungen " +
  "als checks nennen, z. B. {\"8\":\"nio\"}. Eine Abweichung heißt: nicht bestanden, ohne dass " +
  "es jemand extra sagt. 'Tür 12' meint die Tür Nr. 12 des Objekts; unbekannte Nummern werden " +
  "angelegt. (3) Auf 'Fertig' 'wartung_fertig' — das liest zurück UND erzeugt die Berichte " +
  "samt Sammelbericht. Den Rückblick kompakt vorlesen, dazu die fälligen Türen, die noch " +
  "fehlen, und den Link zur Unterschrift.\n\n" +
  "Kommt 'nachsehen' zurück, vorlesen und nachfragen ('an der Tür war 2025 Punkt 10 offen — " +
  "erledigt?'). Kommt 'unvollstaendig' zurück, erst am Ende sammeln, nie mitten im Rundgang.\n\n" +
  "Im Büro: 'einrichten' für Stammdaten, Türtypen und den Bestand — eine Türenliste oder einen " +
  "Grundriss liest du selbst und gibst die Zeilen als 'tueren' ab; erst 'freigeben' macht " +
  "Türen daraus. 'stand' beantwortet 'was ist los?' in einem Aufruf. 'aendern' korrigiert.\n\n" +
  "Kurz antworten, in ganzen Sätzen, ohne Listen: der Monteur hat die Hände voll und schaut " +
  "nicht aufs Display.";
