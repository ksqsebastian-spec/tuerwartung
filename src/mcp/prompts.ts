/**
 * Prompts und Ressourcen — die zwei MCP-Fähigkeiten, die der Server bisher versprach und leer
 * ließ.
 *
 * Beide dienen demselben Zweck: **weniger tippen, weniger raten, weniger Rückfragen.** Ein
 * Prompt ist ein fertiger Gesprächsanfang, den Claude als Schrägstrich-Befehl anbietet — er
 * trägt den Ablauf schon in sich, statt darauf zu warten, dass jemand ihn formuliert. Eine
 * Ressource ist Nachschlagewissen, das der Client anhängen kann, ohne dass ein Tool-Aufruf im
 * Gespräch auftaucht.
 *
 * Beides ist bewusst dünn gehalten: der Ablauf steht in den Server-Instructions und im Skill,
 * hier stehen nur die Einstiege.
 */
import type { Kontext, PromptDef, RessourceDef } from "./protokoll";
import { VORLAGEN, vorlage } from "../vorlagen";
import { objekteListe } from "../daten/objekte";
import ANLEITUNG_IMPORT from "../import/anleitung.md";

const arg = (name: string, description: string, required = false) => ({
  name,
  description,
  required,
});

/* ── Prompts ───────────────────────────────────────────────────────────────── */

const wartung: PromptDef = {
  name: "wartung",
  title: "Wartung aufnehmen",
  description:
    "Startet die freihändige Erfassung vor Ort: Objekt nennen, dann Tür für Tür diktieren.",
  arguments: [arg("objekt", "Name oder Adresse des Objekts, z. B. „Kita Heselstücken“", true)],
  bauen: ({ objekt }) =>
    `Ich stehe an „${objekt}“ und fange mit der Wartung an.\n\n` +
    "Geh so vor: erst `pruefpunkte` der passenden Vorlage lesen, dann `begehung_starten` mit " +
    `„${objekt}“ — kennst du das Objekt nicht, legt der Server es an, und diese Begehung ist ` +
    "die Bestandsaufnahme. Nenn mir kurz, wie viele Türen fällig sind und ob noch etwas offen " +
    "ist, dann höre einfach zu.\n\n" +
    "Nach jeder diktierten Tür sofort `pruefung_erfassen` und eine kurze Quittung ('Tür 3 " +
    "gespeichert'). Standard ist: alles in Ordnung — ich nenne nur die Abweichungen. Antworte " +
    "in ganzen Sätzen, kurz, ohne Listen: ich habe die Hände voll und schaue nicht aufs Display.",
};

const tag: PromptDef = {
  name: "tag",
  title: "Was ist heute zu tun?",
  description:
    "Lagebild und ein geplanter Fahrtag — überfällige Objekte, Mängel über der Frist, " +
    "ausstehende Berichte.",
  arguments: [
    arg("datum", "Tag, für den geplant werden soll (YYYY-MM-DD). Standard heute."),
    arg("anzahl", "Wie viele Objekte der Tag haben soll. Standard 4."),
  ],
  bauen: ({ datum, anzahl }) =>
    "Was steht an?\n\n" +
    "Ruf `lage` auf und fasse in ein paar Sätzen zusammen, was liegen geblieben ist — " +
    "zuerst das Dringendste. Schlag mir dann mit `tour_vorschlagen`" +
    (datum ? ` für ${datum}` : "") +
    (anzahl ? ` mit anzahl=${anzahl}` : "") +
    " einen Fahrtag vor, aber übernimm ihn noch nicht: sag mir die Reihenfolge und warum, " +
    "und setz ihn erst auf mein Wort mit `uebernehmen=true`.\n\n" +
    "Wenn Berichte ausstehen, frag, ob du sie gleich erzeugen sollst.",
};

const abschluss: PromptDef = {
  name: "abschluss",
  title: "Begehung abschließen",
  description: "Rücklesen, abschließen, Berichte und Sammelbericht erzeugen.",
  arguments: [arg("objekt", "Objekt oder Kennung der Begehung. Ohne Angabe fragst du nach.")],
  bauen: ({ objekt }) =>
    (objekt ? `Ich bin fertig an „${objekt}“.` : "Ich bin fertig.") +
    "\n\nRuf `begehung_abschliessen` auf — das liest zurück und erzeugt die Berichte in einem " +
    "Zug. Lies mir den Rückblick kompakt vor: je Tür Ort, Abweichungen, Ergebnis. Nenn " +
    "besonders die fälligen Türen, die noch fehlen, und frag, ob das Absicht war.\n\n" +
    "Kommt `fertig: false` zurück, ruf einfach noch einmal auf, bis nichts mehr offen ist. " +
    "Am Ende ein Satz: wie viele Berichte, wie viele mit Nachbesserung, und der Link.",
};

const bauplan: PromptDef = {
  name: "bauplan",
  title: "Bauplan oder Türliste einlesen",
  description:
    "Der Weg für einen Grundriss oder eine Türliste — du liest die Datei, Türwerk verwahrt " +
    "die Vorschläge, ein Mensch gibt frei.",
  arguments: [arg("objekt", "Name oder Adresse des Objekts", true)],
  bauen: ({ objekt }) =>
    `Hier ist ein Bauplan für „${objekt}“.\n\n` +
    "Zwei Schritte: lies die Datei und gib die gefundenen Türen mit `bauplan_uebernehmen` ab — " +
    "der Import legt sich dabei selbst an. Lies mir dann den `bericht` aus der Antwort vor, " +
    "nicht die ganze Liste, und nenn die `freigabe_moeglichkeiten`. Erst auf mein Wort " +
    "`vorschlaege_annehmen`: **ohne Freigabe entstehen keine Bauteile.**\n\n" +
    "Wenn du beim Lesen unsicher bist, sag es lieber — eine niedrige Konfidenz ist besser als " +
    "eine erfundene Tür. Details stehen in `import_anleitung`, falls du sie brauchst.",
};

const einrichten: PromptDef = {
  name: "einrichten",
  title: "Neues Objekt einrichten",
  description:
    "Führt durch die Stammdaten eines neuen Objekts — eine Frage nach der anderen, bis alles " +
    "steht, was der Bericht braucht und was eine vergebliche Anfahrt verhindert.",
  arguments: [arg("objekt", "Name des neuen Objekts", true)],
  bauen: ({ objekt }) =>
    `Ich möchte „${objekt}“ neu anlegen.\n\n` +
    "Ruf `objekt_einrichten` auf und stell mir **immer nur die eine Frage**, die in " +
    "`naechste_frage` steht — nicht die ganze Liste. Meine Antwort gibst du im nächsten Aufruf " +
    "mit, so lange, bis `fertig: true` kommt. Weiß ich etwas nicht und es ist freiwillig, nimm " +
    "es in `ueberspringen` auf statt noch einmal zu fragen.\n\n" +
    "Wenn es steht, sag mir kurz, was als Nächstes sinnvoll ist.",
};

export const PROMPTS: PromptDef[] = [wartung, tag, abschluss, einrichten, bauplan];

/* ── Ressourcen ────────────────────────────────────────────────────────────── */

/** Die Prüfpunkte einer Vorlage als Text — das, was beim Diktat vorgelesen wird. */
function pruefpunkteText(art: string): string {
  const v = vorlage(art);
  return (
    `# ${v.label}\n\n` +
    v.punkte.map((p) => `${p.nr}. ${p.text}`).join("\n") +
    "\n\nBewertungen: io = in Ordnung (Standard, muss nicht genannt werden) · nio = nicht in " +
    "Ordnung · sb = siehe Bemerkung · nz = nicht zutreffend.\n"
  );
}

const ressourcen: RessourceDef[] = [
  {
    uri: "tuerwerk://anleitung/import",
    name: "anleitung-import",
    title: "Anleitung: Bauplan-Import",
    description:
      "Wie ein Grundriss oder eine Türliste zu Bauteilen wird — der Weg, den der Agent geht.",
    mimeType: "text/markdown",
    lesen: () => ANLEITUNG_IMPORT as unknown as string,
  },
  {
    uri: "tuerwerk://bestand",
    name: "bestand",
    title: "Objekte mit Fälligkeit",
    description:
      "Alle Objekte mit Adresse, Bestandsgröße, fälligen Bauteilen und offenen Mängeln — " +
      "der Stand, ohne dass ein Tool-Aufruf im Gespräch auftaucht.",
    mimeType: "text/markdown",
    lesen: async (ctx: Kontext) => {
      const liste = await objekteListe(ctx.env.DB, { limit: 500 });
      if (!liste.length) return "# Objekte\n\nNoch kein Objekt angelegt.\n";
      const zeilen = liste.map(
        (o) =>
          `| ${o.name} | ${o.adresse || "—"} | ${o.bauteile} | ${o.faellige_bauteile} | ` +
          `${o.offene_maengel} | ${o.stand.nie_geprueft ? "nie geprüft" : o.stand.faellig_am || "—"} |`,
      );
      return (
        "# Objekte\n\n| Objekt | Adresse | Bauteile | davon fällig | offene Mängel | fällig am |\n" +
        "|---|---|---|---|---|---|\n" +
        zeilen.join("\n") +
        "\n"
      );
    },
  },
  ...Object.keys(VORLAGEN).map((art) => ({
    uri: `tuerwerk://pruefpunkte/${art}`,
    name: `pruefpunkte-${art}`,
    title: `Prüfpunkte: ${VORLAGEN[art].label}`,
    description: `Die nummerierten Prüfpunkte der Vorlage „${VORLAGEN[art].label}“ zum Vorlesen.`,
    mimeType: "text/markdown",
    lesen: () => pruefpunkteText(art),
  })),
];

export const RESSOURCEN: RessourceDef[] = ressourcen;
