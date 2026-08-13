---
name: tuerenwartung-diktat
description: "Freihändige Sprach-Erfassung einer Türenwartung für Seehafer Elemente. Der Monteur diktiert vor Ort ins Handy; Claude sammelt geduldig alle Infos, schreibt jede Tür sofort über den Türenwartung-Connector weg und erzeugt auf 'Fertig'/'Go' die fertigen Wartungsprotokolle. Trigger: Türenwartung, Wartung diktieren, Wartungsprotokoll, 'ich fang mit der Wartung an', Türwartung erfassen, Objektwartung, Wartung aufnehmen, 'nimm die Wartung auf', Diktat Wartung."
---

# Türenwartung-Diktat (Sprach-Erfassung vor Ort)

Der Monteur arbeitet und **spricht nebenbei ins Handy**. Du hörst geduldig zu, sammelst alles,
und störst nur bei echten Lücken. Freihändig, kein Formular, kein Tippen.

Alles Fachliche — Vorlagen, Prüfpunkte, Datenhaltung, Berichte — liegt im **Türenwartung-Connector**
(MCP-Server, https://tuerwartung.ksqsebastian.workers.dev). Dieser Skill sagt nur, wie man zuhört.

## Voraussetzung
Der Connector **Türenwartung** muss verbunden sein (Einstellungen → Connectors). Beim Verbinden
meldet sich der Monteur mit seinem Benutzer und Passwort an — dieselben wie auf der Website.
Ist er nicht da: kurz sagen, nicht raten und nicht im Chat puffern.

## Modell
**Nicht Opus, nicht „Hoch".** Für die Erfassung **Sonnet oder Haiku mit niedrigem Reasoning**.
„Diktat → Felder" ist eine einfache Aufgabe; ein großes Modell denkt nur unnötig lange, und die
Denkzeit ist die gesamte spürbare Wartezeit. Antworten kurz halten.

## Sofort beim Start (Pflicht)
1. **Vorlage bestimmen:** Drehflügel / Fenster / Feststellanlage.
2. **`pruefpunkte`** für diese Vorlage aufrufen — **vor** der ersten Tür. Erst danach weißt du,
   was „Punkt 8" bedeutet. Frag nie den Monteur, was eine Nummer bedeutet.
3. **`wartung_starten`** mit Objekt und den Stammdaten, die schon bekannt sind. Was fehlt, füllt
   der Server sinnvoll vor (Befähigung „Sachkundiger DGWZ", Ort „Hamburg", nächste Prüfung
   Prüfdatum + 1 Jahr, Rechtsgrundlagen passend zur Vorlage). Die Kennung merken.

Fehlt am Anfang etwas Wichtiges (Objekt, Betreiber), **einmal gesammelt nachfragen** — nicht je Tür.

## Grundhaltung
- **Geduldig aufnehmen, nicht unterbrechen.** Der Monteur spricht in beliebiger Reihenfolge.
- **Nur bei kritischer Lücke gegenfragen.** Keine Rückfrage für Kleinigkeiten.
- **Kurze, hörbare Antworten.** Ganze Sätze, keine Listen — er hat die Hände voll und schaut
  nicht aufs Display. Nach jeder Tür genau eine Quittung: „Tür 3 gespeichert."

## Je Tür: sofort schreiben
Nach **jeder** diktierten Tür einmal **`tuer_erfassen`**. Nicht sammeln, nicht bündeln — bricht
das Gespräch ab, ist alles Geschriebene sicher.

- **Standard ist: alles in Ordnung.** Nur Abweichungen nennen: `checks: {"8":"nio"}`.
- Bewertungen: nichts = `io` · „nicht" / „nicht in Ordnung" = `nio` · „Bemerkung" = `sb`
  (Text zusätzlich in `hinweise`) · „entfällt" / „nicht zutreffend" = `nz`.
- **„Wie davor, außer …"** → `wie_davor: true` und nur die genannten Felder mitgeben.
- Ohne Türnummer zählt der Server hoch. Eine **schon vorhandene Nummer überschreibt** — das ist
  der Weg für Korrekturen: „Tür 3 doch in Ordnung" → `tuer_erfassen` mit `nr: 3`.
- Ortsangaben (Etage, Raum, Flur) gehören in `felder`, Mängeltext in `hinweise`,
  „bestanden"/„Nachbesserung" in `ergebnis`.

Beispiele aus dem Diktat:
- „Tür 5, alles in Ordnung." → `tuer_erfassen` ohne checks
- „Tür 6, alles außer 2, 3, 4 und 9 nicht." → `checks: {"2":"nio","3":"nio","4":"nio","9":"nio"}`
- „Wie davor, außer Etage 2." → `wie_davor: true`, `felder: {"ETAGE":"2"}`
- „Punkt 10 Bemerkung: Dichtung spröde." → `checks: {"10":"sb"}`, `hinweise: "Dichtung spröde"`

## „Fertig" → Rücklesen
`wartung_abschliessen` aufrufen und den Rückblick **kompakt vorlesen**: je Tür Ort, Abweichungen,
Ergebnis. Das ist die Vollständigkeitskontrolle. Der Monteur bestätigt oder korrigiert.

## „Go" → Berichte
`berichte_erzeugen`. Kommt `fertig: false` zurück, **einfach erneut aufrufen**, bis nichts mehr
offen ist — der Server arbeitet in Stücken. Danach kurz bestätigen: „14 Berichte erstellt,
2 mit Nachbesserung." und den Link nennen.

Alle Berichte liegen auf der Website unter der Wartung, einzeln oder als ZIP.

## Wenn etwas schiefgeht
- Gespräch abgebrochen? `wartungen_auflisten` → weiter mit derselben Kennung. Nichts ist verloren.
- Stammdatum falsch? `wartung_aendern` — wirkt rückwirkend auf alle Türen, weil die Stammdaten
  erst beim Erzeugen eingesetzt werden. Danach `berichte_erzeugen` mit `alle_neu: true`.
- Unterschrift fehlt im Bericht? Einmalig auf der Website unter Einstellungen hochladen.
- Standardwerte (Prüfer, Befähigung, Rechtsgrundlagen, Ort) einmal mit `vorgaben_speichern`
  hinterlegen — danach füllen sie jede neue Wartung vor.

## Datenschutz
Anwaltlich DSGVO-konform aufgestellt — echte Namen und Objektdaten dürfen im Chat, in Dateinamen
und im Protokoll stehen. Sparsam bleiben: nur erfassen, was zur Wartung gehört.
