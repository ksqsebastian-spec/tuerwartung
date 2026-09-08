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
 * Zwei Befehle, nicht sieben: einer fängt die Wartung an, einer beendet sie. Alles andere war
 * ein Einstieg in etwas, das man ohnehin sagen kann — und jeder davon stand als Zeile im
 * Client, durch die man sich erst durchlesen musste.
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
    `Ruf \`wartung_starten\` mit „${objekt}“ auf. Die Antwort bringt die Checklisten schon mit ` +
    "— sag mir kurz, wie viele Türen fällig sind und was beim letzten Mal offen war, dann höre " +
    "einfach zu.\n\n" +
    "Nach jeder diktierten Tür sofort `tuer_erfassen` und eine kurze Quittung ('Tür 3 " +
    "gespeichert'). Standard ist: alles in Ordnung — ich nenne nur die Abweichungen. Antworte " +
    "in ganzen Sätzen, kurz, ohne Listen: ich habe die Hände voll und schaue nicht aufs Display.",
};

const fertig: PromptDef = {
  name: "fertig",
  title: "Wartung abschließen",
  description: "Rücklesen, Berichte und Sammelbericht erzeugen, Unterschrift holen.",
  arguments: [arg("objekt", "Objekt, falls mehrere Wartungen laufen")],
  bauen: ({ objekt }) =>
    (objekt ? `Ich bin fertig an „${objekt}“.` : "Ich bin fertig.") +
    "\n\nRuf `wartung_fertig` auf — das liest zurück und erzeugt die Berichte in einem Zug. " +
    "Lies mir den Rückblick kompakt vor: je Tür Ort, Abweichungen, Ergebnis. Nenn besonders die " +
    "fälligen Türen, die noch fehlen, und frag, ob das Absicht war.\n\n" +
    "Kommt `fertig: false` zurück, ruf einfach noch einmal auf. Am Ende ein Satz: wie viele " +
    "Berichte, wie viele mit Nachbesserung — und den Link zur Unterschrift, damit der Betreiber " +
    "gleich auf dem Handy unterschreiben kann.",
};

export const PROMPTS: PromptDef[] = [wartung, fertig];

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
      "Alle Objekte mit Adresse, Bestandsgröße, fälligen Türen und dem, was nicht bestanden " +
      "hat — der Stand, ohne dass ein Tool-Aufruf im Gespräch auftaucht.",
    mimeType: "text/markdown",
    lesen: async (ctx: Kontext) => {
      const liste = await objekteListe(ctx.env.DB, { limit: 500 });
      if (!liste.length) return "# Objekte\n\nNoch kein Objekt angelegt.\n";
      const zeilen = liste.map(
        (o) =>
          `| ${o.name} | ${o.adresse || "—"} | ${o.bauteile} | ${o.faellige_bauteile} | ` +
          `${o.nicht_bestanden} | ${o.stand.nie_geprueft ? "nie geprüft" : o.stand.faellig_am || "—"} |`,
      );
      return (
        "# Objekte\n\n| Objekt | Adresse | Türen | davon fällig | nicht bestanden | fällig am |\n" +
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
