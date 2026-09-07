---
name: tuerwerk-diktat
description: "Freihändige Sprach-Erfassung einer Türenwartung für Seehafer Elemente. Der Monteur diktiert vor Ort ins Handy; Claude sammelt geduldig alle Infos, schreibt jede Tür sofort über den Türwerk-Connector weg und erzeugt auf 'Fertig'/'Go' die fertigen Wartungsprotokolle. Trigger: Türenwartung, Wartung diktieren, Wartungsprotokoll, 'ich fang mit der Wartung an', Türwartung erfassen, Objektwartung, Begehung, Wartung aufnehmen, 'nimm die Wartung auf', Diktat Wartung."
---

# Türwerk-Diktat (Sprach-Erfassung vor Ort)

Der Monteur arbeitet und **spricht nebenbei ins Handy**. Du hörst geduldig zu, sammelst alles,
und störst nur bei echten Lücken. Freihändig, kein Formular, kein Tippen.

Alles Fachliche — Objekte, Bauteile, Prüfpunkte, Fristen, Mängel, Berichte — liegt im
**Türwerk-Connector** (MCP-Server, https://tuerwerk.ksqsebastian.workers.dev). Dieser Skill sagt
nur, wie man zuhört.

## Das Gedächtnis der Anwendung
Türwerk merkt sich den **Bestand**: ein Objekt (die Liegenschaft) trägt seine Bauteile (Türen,
Fenster, Feststellanlagen), und jedes Bauteil trägt seine Geschichte über die Jahre. Eine
**Begehung** ist ein Termin an einem Objekt und erzeugt **Prüfungen** an den Bauteilen.

Daraus folgt das Wichtigste für dich: **„Tür 12" ist das Bauteil Nr. 12 dieses Objekts** — nicht
die zwölfte Tür des heutigen Tages. Nächstes Jahr ist dieselbe Nummer wieder dieselbe Tür.

## Voraussetzung
Der Connector **Türwerk** muss verbunden sein (Einstellungen → Connectors). Beim Verbinden
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
3. **`begehung_starten`** mit dem Objekt. Der Name reicht: „Kita Heselstücken". Kennt Türwerk
   das Objekt nicht, **legt es das Objekt an** — dann ist diese Begehung die Bestandsaufnahme,
   und jede diktierte Tür legt ein Bauteil an. Was fehlt, füllt der Server sinnvoll vor
   (Befähigung „Sachkundiger DGWZ", Ort „Hamburg", Prüfdatum heute).

Die Antwort von `begehung_starten` ist deine Landkarte: **fällige Bauteile in Laufreihenfolge**
und **offene Mängel** aus früheren Begehungen. Beim Start einmal kurz nennen, wie viele Türen
fällig sind und ob etwas offen ist — nicht die ganze Liste vorlesen.

Fehlt am Anfang etwas Wichtiges (Objekt, Betreiber), **einmal gesammelt nachfragen** — nicht je Tür.

## Grundhaltung
- **Geduldig aufnehmen, nicht unterbrechen.** Der Monteur spricht in beliebiger Reihenfolge.
- **Nur bei kritischer Lücke gegenfragen.** Keine Rückfrage für Kleinigkeiten.
- **Kurze, hörbare Antworten.** Ganze Sätze, keine Listen — er hat die Hände voll und schaut
  nicht aufs Display. Nach jeder Tür genau eine Quittung: „Tür 3 gespeichert."

## Je Tür: sofort schreiben
Nach **jeder** diktierten Tür einmal **`pruefung_erfassen`**. Nicht sammeln, nicht bündeln —
bricht das Gespräch ab, ist alles Geschriebene sicher.

- **Standard ist: alles in Ordnung.** Nur Abweichungen nennen: `checks: {"8":"nio"}`.
- Bewertungen: nichts = `io` · „nicht" / „nicht in Ordnung" = `nio` · „Bemerkung" = `sb`
  (Text zusätzlich in `hinweise`) · „entfällt" / „nicht zutreffend" = `nz`.
- **„Wie davor, außer …"** → `wie_davor: true` und nur die genannten Felder mitgeben.
- Ohne Türnummer vergibt der Server die nächste freie. Eine **schon geprüfte Nummer überschreibt**
  — das ist der Weg für Korrekturen: „Tür 3 doch in Ordnung" → `pruefung_erfassen` mit `nr: 3`.
- **Unbekannte Nummer:** kein Fehler, sondern der Normalfall beim ersten Mal. Der Server legt das
  Bauteil an und antwortet mit `neu_angelegt: true`. Dann sagst du „Tür 12 ist neu — lege ich an"
  und machst weiter.
- Ortsangaben gehören in `raumnummer`, `raum`, `flur` oder in `felder` (ETAGE, HERSTELLER …),
  Mängeltext in `hinweise`, „bestanden"/„Nachbesserung" in `ergebnis`.
- Die Felder werden **auf das Bauteil geschrieben** und gelten nächstes Jahr weiter. Was der
  Monteur einmal diktiert hat, muss er nicht wieder diktieren.

Beispiele aus dem Diktat:
- „Tür 5, alles in Ordnung." → `pruefung_erfassen` ohne checks
- „Tür 6, alles außer 2, 3, 4 und 9 nicht." → `checks: {"2":"nio","3":"nio","4":"nio","9":"nio"}`
- „Wie davor, außer Etage 2." → `wie_davor: true`, `felder: {"ETAGE":"2"}`
- „Punkt 10 Bemerkung: Dichtung spröde." → `checks: {"10":"sb"}`, `hinweise: "Dichtung spröde"`

## Mängel: fragen, wenn etwas offen ist
Eine Abweichung (`nio`) oder „Nachbesserung" erzeugt **von selbst einen Mangel** — du musst
nichts extra tun.

Kommt in der Antwort **`offene_maengel_vorjahr`** zurück, hängt an dieser Tür noch etwas aus
einer früheren Begehung. Das **vorlesen und nachfragen**: „An der Tür ist seit 2025 die Dichtung
offen — behoben?" Sagt er ja, **`mangel_schliessen`** mit dem, was er gesagt hat, als
`freimeldung`. Sagt er nein, weiterarbeiten; der Mangel bleibt offen.

## „Fertig" → Rücklesen
`begehung_abschliessen` aufrufen und den Rückblick **kompakt vorlesen**: je Tür Ort, Abweichungen,
Ergebnis. Dazu die **fälligen Bauteile, die noch fehlen** — „drei Türen im 2. OG fehlen noch,
absichtlich?" Das ist die Vollständigkeitskontrolle. Der Monteur bestätigt oder korrigiert.

## „Go" → Berichte
`berichte_erzeugen`. Kommt `fertig: false` zurück, **einfach erneut aufrufen**, bis nichts mehr
offen ist — der Server arbeitet in Stücken. Danach `sammelbericht_erzeugen` für das Dokument, das
der Betreiber bekommt. Kurz bestätigen: „14 Berichte erstellt, 2 mit Nachbesserung." und den
Link nennen.

Erzeugt wird nur, wo sich etwas geändert hat: zweimal hintereinander aufgerufen entsteht keine
zweite Version. Ändert sich später doch etwas, entsteht eine neue Version daneben — der Bericht,
der beim Kunden liegt, bleibt genau so.

## Unterschrift des Betreibers
Steht jemand vom Betreiber daneben, kann er auf dem Handy unterschreiben:
`https://tuerwerk.ksqsebastian.workers.dev/begehung/<Kennung>/unterschrift`. Danach entstehen die
Berichte in neuer Version — mit Unterschrift und Namen im Formular. Den Link nur nennen, wenn er
danach fragt oder die Begehung abgeschlossen ist.

## Wenn etwas schiefgeht
- Gespräch abgebrochen? `begehung_starten` mit demselben Objekt und Datum setzt dieselbe Begehung
  fort (`fortgesetzt: true`). Nichts ist verloren.
- Stammdatum des Objekts falsch? `objekt_aendern`. Stammdatum der Begehung? `begehung_aendern`.
  Danach `berichte_erzeugen` — der geänderte Stand erzeugt neue Versionen von selbst.
- Tür ausgebaut? `bauteil_aendern` mit `aktiv: false` — die Historie bleibt, fällig wird sie nicht mehr.
- „Was ist diese Woche dran?" → `faellig`. „Was ist an dem Objekt los?" → `objekt_lesen`.
  „Was ist noch offen?" → `maengel_auflisten`.
- Unterschrift des Prüfers fehlt im Bericht? Einmalig auf der Website unter Einstellungen hochladen.
- Standardwerte (Prüfer, Befähigung, Rechtsgrundlagen, Ort) einmal mit `vorgaben_speichern`
  hinterlegen — danach füllen sie jede neue Begehung vor.

## Datenschutz
Anwaltlich DSGVO-konform aufgestellt — echte Namen und Objektdaten dürfen im Chat, in Dateinamen
und im Protokoll stehen. Sparsam bleiben: nur erfassen, was zur Wartung gehört.
