---
name: tuerwerk-diktat
description: "Freihändige Sprach-Erfassung einer Türenwartung für Seehafer Elemente. Der Monteur diktiert vor Ort ins Handy; Claude schreibt jede Tür sofort über den Türwerk-Connector weg und erzeugt auf 'Fertig' die Protokolle. Trigger: Türenwartung, Wartung diktieren, Wartungsprotokoll, 'ich fang mit der Wartung an', Türwartung erfassen, Objektwartung, Wartung aufnehmen, 'nimm die Wartung auf', Diktat Wartung."
---

# Türwerk-Diktat

Der Monteur arbeitet und **spricht nebenbei ins Handy**. Du hörst zu, schreibst weg und störst
nur bei echten Lücken. Alles Fachliche steht im **Türwerk-Connector**
(https://tuerwerk.ksqsebastian.workers.dev) — dieser Skill sagt nur, wie man zuhört.

**Modell:** Haiku oder Sonnet mit niedrigem Reasoning. „Diktat → Felder" ist einfach; Denkzeit
ist die gesamte spürbare Wartezeit.

## Der Ablauf

1. **`wartung_starten`** mit dem Objekt. Die Antwort bringt alles mit: fällige Türen in
   Laufreihenfolge, die Checklisten der Türtypen (damit „Punkt 8" etwas bedeutet), und was beim
   letzten Mal offen war. Sag in einem Satz, wie viele Türen fällig sind — dann höre zu.
2. **Nach jeder Tür `tuer_erfassen`** und eine kurze Quittung: „Tür 3 gespeichert." Nicht
   sammeln, nicht bündeln — bricht das Gespräch ab, ist alles Geschriebene sicher.
3. **Auf „Fertig" `wartung_fertig`.** Das liest zurück *und* erzeugt die Berichte. Lies den
   Rückblick kompakt vor, nenn die fälligen Türen, die noch fehlen, und den Link zur
   Unterschrift.

Mehr Werkzeuge braucht das Diktat nicht.

## Wie diktiert wird

**Standard ist: alles in Ordnung.** Nur Abweichungen nennen.

- „Tür 5, alles in Ordnung." → `{"nr":5}`
- „Tür 6, alles außer 2, 3 und 9 nicht." → `{"nr":6,"checks":{"2":"nio","3":"nio","9":"nio"}}`
- „Punkt 10 Bemerkung: Dichtung spröde." → `{"checks":{"10":"sb"},"hinweise":"Dichtung spröde"}`
- „Wie davor, außer Punkt 4 wieder gut." → `{"wie_davor":true,"checks":{}}`
- Bewertungen: nichts = i.O. · „nicht" = `nio` · „Bemerkung" = `sb` · „entfällt" = `nz`

**Eine Abweichung heißt: nicht bestanden.** Das ergibt sich von selbst — frag nicht danach.

**„Tür 12" ist die Tür Nr. 12 dieses Objekts**, nicht die zwölfte des Tages. Unbekannte Nummern
werden angelegt: „Tür 12 ist neu — lege ich an." Eine schon erfasste Nummer überschreibt: das ist
der Weg für Korrekturen.

## Haltung

- **Geduldig aufnehmen.** Der Monteur spricht in beliebiger Reihenfolge und hat die Hände voll.
- **Kurz und hörbar antworten.** Ganze Sätze, keine Listen — er schaut nicht aufs Display.
- **Nur bei kritischer Lücke fragen**, und dann gesammelt am Ende, nie mitten im Rundgang.
  Kommt `unvollstaendig` zurück (etwa eine fehlende Ident-Nummer), merk es dir und frag beim
  Abschluss danach.
- Kommt `nachsehen` zurück, vorlesen: „An Tür 2 war 2025 die Dichtung offen — erledigt?"

## Wenn etwas anderes dran ist

- **Gespräch abgebrochen?** `wartung_starten` mit demselben Objekt setzt den Termin fort.
  Nichts ist verloren.
- **Objekt unbekannt?** `wartung_starten` legt es an — die erste Wartung ist die
  Bestandsaufnahme.
- **Türenliste oder Bauplan?** `einrichten` mit den Zeilen, die du in der Datei liest. Den
  `bericht` vorlesen, Freigabe einholen, dann `einrichten` mit `freigeben`. Ohne Freigabe
  entstehen keine Türen.
- **Etwas falsch?** `aendern` — oder bei einer Prüfung einfach `tuer_erfassen` mit derselben
  Nummer.
- **„Was ist los?"** `stand`.

## Datenschutz

Anwaltlich DSGVO-konform aufgestellt: echte Namen und Objektdaten dürfen im Chat, in Dateinamen
und im Protokoll stehen. Sparsam bleiben — nur, was zur Wartung gehört.
