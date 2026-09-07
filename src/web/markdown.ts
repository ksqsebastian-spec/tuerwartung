/**
 * Ein winziger Markdown-Umsetzer für die Texte, die Mensch und Agent gleichermaßen lesen:
 * die Import-Anleitung und die Cheatsheets der Vorlagen.
 *
 * Bewusst nur die Teilmenge, die in diesen Dateien vorkommt — Überschriften, Absätze, Listen,
 * Tabellen, Codeblöcke, fett und `code`. Eine Bibliothek dafür wäre mehr Abhängigkeit als
 * Nutzen; alles, was hier nicht vorgesehen ist, bleibt einfach Text.
 */
import { esc } from "./layout";

function zeileFormatieren(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function markdown(quelle: string): string {
  const aus: string[] = [];
  const zeilen = quelle.split("\n");
  let inListe = false;
  let inCode = false;
  let absatz: string[] = [];

  const absatzSchliessen = () => {
    if (absatz.length) {
      aus.push(`<p class="body">${zeileFormatieren(absatz.join(" "))}</p>`);
      absatz = [];
    }
  };
  const listeSchliessen = () => {
    if (inListe) {
      aus.push("</ul>");
      inListe = false;
    }
  };

  for (const zeile of zeilen) {
    if (zeile.trim().startsWith("```")) {
      absatzSchliessen();
      listeSchliessen();
      aus.push(inCode ? "</code></pre>" : '<pre class="code"><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      aus.push(esc(zeile));
      continue;
    }

    const ueberschrift = /^(#{1,4})\s+(.*)$/.exec(zeile);
    if (ueberschrift) {
      absatzSchliessen();
      listeSchliessen();
      const stufe = ueberschrift[1].length;
      const klasse = stufe === 1 ? ' class="seite"' : stufe === 2 ? ' class="abschnitt"' : "";
      aus.push(`<h${stufe}${klasse}>${zeileFormatieren(ueberschrift[2])}</h${stufe}>`);
      continue;
    }

    const punkt = /^\s*[-*]\s+(.*)$/.exec(zeile);
    if (punkt) {
      absatzSchliessen();
      if (!inListe) {
        aus.push('<ul class="points">');
        inListe = true;
      }
      aus.push(`<li>${zeileFormatieren(punkt[1])}</li>`);
      continue;
    }

    const nummer = /^\s*(\d+)\.\s+(.*)$/.exec(zeile);
    if (nummer) {
      absatzSchliessen();
      if (!inListe) {
        aus.push('<ul class="points nummern">');
        inListe = true;
      }
      aus.push(`<li><b>${esc(nummer[1])}.</b> ${zeileFormatieren(nummer[2])}</li>`);
      continue;
    }

    if (!zeile.trim()) {
      absatzSchliessen();
      listeSchliessen();
      continue;
    }
    /* Fortsetzungszeile einer Aufzählung gehört zum letzten Punkt. */
    if (inListe && /^\s{2,}/.test(zeile)) {
      aus[aus.length - 1] = aus[aus.length - 1].replace(
        /<\/li>$/,
        ` ${zeileFormatieren(zeile.trim())}</li>`,
      );
      continue;
    }
    absatz.push(zeile.trim());
  }
  absatzSchliessen();
  listeSchliessen();
  if (inCode) aus.push("</code></pre>");
  return aus.join("\n");
}
