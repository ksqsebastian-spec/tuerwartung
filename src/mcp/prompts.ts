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
    "Geh so vor: `begehung_starten` mit " +
    `„${objekt}“, dann checkliste_lesen für die Türtypen, die hier vorkommen — erst danach ` +
    "sind Punktnummern verständlich. Nenn mir kurz, wie viele Türen fällig sind und ob noch " +
    "etwas offen ist, dann höre einfach zu.\n\n" +
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
    `Hier sind die Unterlagen für „${objekt}“.\n\n` +
    "Lies zuerst `import_anleitung` — dort steht, wie Türen- und Fensterlisten aufgebaut sind " +
    "und welche Spalten wohin gehören. Dann:\n\n" +
    "1. **Liste zuerst**, falls eine dabei ist: die Zeilen mit `bauplan_uebernehmen` abgeben, " +
    "`geschoss` je Zeile, `tuertyp` aus Türtyp + RS/FS. Türtypen und Geschosse legt der Server " +
    "dabei selbst an. Bei mehr als ~100 Zeilen mehrfach rufen und die `import`-Kennung mitgeben.\n" +
    "2. Den `bericht` aus der Antwort vorlesen, nicht die ganze Liste, und die " +
    "`freigabe_moeglichkeiten` nennen. Erst auf mein Wort `vorschlaege_annehmen`: **ohne " +
    "Freigabe entstehen keine Bauteile.**\n" +
    "3. **Plan danach**: Textebene lesen (die Türnummern stehen dort meist als echter Text mit " +
    "Koordinaten), Positionen als Anteile 0..1 mitgeben. Bekannte Kennungen werden an den " +
    "vorhandenen Türen verortet — dafür braucht es keine Freigabe mehr.\n\n" +
    "Wenn du beim Lesen unsicher bist, sag es lieber — eine niedrige Konfidenz ist besser als " +
    "eine erfundene Tür.",
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

const tuertyp: PromptDef = {
  name: "tuertyp",
  title: "Türtyp einrichten",
  description:
    "Legt einen Türtyp an — Vorlage, gemeinsame Stammdaten, Pflichtangaben — und legt seine " +
    "Checkliste zurecht. Ohne Türtyp lässt sich keine Tür einrichten.",
  arguments: [arg("name", "Wie der Typ heißen soll, z. B. „T30 Flurtür Hörmann“", true)],
  bauen: ({ name }) =>
    `Ich will den Türtyp „${name}“ einrichten.\n\n` +
    "Frag mich der Reihe nach: welche Vorlage (Drehflügeltüren, Fenster, Feststellanlagen), " +
    "welche Angaben für alle Türen dieses Typs gleich sind (Hersteller, Zulassung), was an " +
    "jeder einzelnen Tür stehen muss, bevor geprüft werden darf (meist die Ident-Nummer), und " +
    "ob je Tür noch etwas erfasst werden soll — Geschoss, Kommentar.\n\n" +
    "Dann `tuertyp_anlegen`. Danach lies mir die erzeugte Checkliste vor und frag, was " +
    "umbenannt, ausgeblendet oder ergänzt werden soll — `checkliste_anpassen`.",
};

const tuer: PromptDef = {
  name: "tuer",
  title: "Tür einrichten",
  description:
    "Richtet eine einzelne Tür ein: Türtyp wählen, dann die Angaben, die dieser Typ verlangt.",
  arguments: [
    arg("objekt", "An welchem Objekt", true),
    arg("tuertyp", "Welcher Türtyp"),
  ],
  bauen: ({ objekt, tuertyp }) =>
    `Ich richte eine Tür an „${objekt}“ ein${tuertyp ? `, Türtyp „${tuertyp}“` : ""}.\n\n` +
    (tuertyp ? "" : "Zeig mir zuerst mit `tuertypen_auflisten`, welche Typen es gibt.\n\n") +
    "Dann `tuer_einrichten` und **immer nur die eine Frage** stellen, die in `naechste_frage` " +
    "steht — meine Antwort im nächsten Aufruf mitgeben, bis `bereit: true` kommt. Erst dann " +
    "kann geprüft werden.\n\n" +
    "Wenn ich dir ein Foto vom Typenschild schicke: lies die Ident-Nummer selbst ab und gib sie " +
    "mit. Abtippen will ich das nicht.",
};

export const PROMPTS: PromptDef[] = [wartung, tuertyp, tuer, tag, abschluss, einrichten, bauplan];

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
  {
    uri: "tuerwerk://checklisten",
    name: "checklisten",
    title: "Checklisten der Türtypen",
    description:
      "Die Prüfpunkte jedes eingerichteten Türtyps, so wie sie hier gelten — umbenannt, " +
      "ausgeblendet und um eigene ergänzt. Das ist die Liste, die vorgelesen wird.",
    mimeType: "text/markdown",
    lesen: async (ctx: Kontext) => {
      const { tuertypenListe } = await import("../daten/tuertypen");
      const typen = await tuertypenListe(ctx.env.DB);
      if (!typen.length) {
        return "# Checklisten\n\nNoch kein Türtyp eingerichtet.\n";
      }
      return typen
        .map(
          (t) =>
            `## ${t.name}\n\nVorlage: ${VORLAGEN[t.art]?.label ?? t.art}\n\n` +
            t.punkte
              .filter((p) => p.aktiv)
              .map((p) => `${p.nr}. ${p.text}${p.eigen ? " *(eigener Punkt)*" : ""}`)
              .join("\n") +
            (t.zusatz.length
              ? `\n\nZusätzlich je Tür: ${t.zusatz.map((z) => z.label).join(", ")}`
              : "") +
            "\n",
        )
        .join("\n");
    },
  },
  ...Object.keys(VORLAGEN).map((art) => ({
    uri: `tuerwerk://pruefpunkte/${art}`,
    name: `pruefpunkte-${art}`,
    title: `Prüfpunkte der Vorlage: ${VORLAGEN[art].label}`,
    description:
      `Die unveränderten Prüfpunkte der Vorlage „${VORLAGEN[art].label}“ — die Grundlage, aus ` +
      "der die Checkliste eines Türtyps entsteht.",
    mimeType: "text/markdown",
    lesen: () => pruefpunkteText(art),
  })),
];

export const RESSOURCEN: RessourceDef[] = ressourcen;
