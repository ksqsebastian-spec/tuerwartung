# Bauplan-Import — Anleitung für den Agenten

Türwerk liest keine Pläne. Du liest sie — du hast die Datei ohnehin im Gespräch — und meldest
Türwerk, was du gefunden hast. Türwerk verwahrt es als **Vorschläge**, bis ein Mensch sie
freigibt. Erst dann entstehen Bauteile.

## Ablauf — zwei Schritte

Nur zwei Dinge sind echte Arbeit: die Datei lesen (das kann nur du) und die Freigabe (die muss
ein Mensch geben). Alles andere macht der Server.

1. **Datei lesen und `bauplan_uebernehmen`.** Objekt, die gefundenen Türen, bei Plänen das
   Geschoss („EG", „1. OG", „UG" — unbekannte Namen werden angelegt). Ob Plan oder Türliste
   erkennt der Server an den Positionen; der Import wird nebenbei angelegt. Mehr als ~100 Türen:
   mehrfach aufrufen und ab dem zweiten Mal die zurückgegebene `import`-Kennung mitgeben.

   Die Antwort enthält einen fertigen **`bericht`** — den vorlesen, nicht die ganze Liste — und
   **`freigabe_moeglichkeiten`**: die üblichen Auswahlen samt Aufruf.

2. **Freigabe einholen und `vorschlaege_annehmen`.** Der Mensch entscheidet („nimm alle mit
   T30", „alle ab 0.85") — im Gespräch oder auf der Planseite im Browser. Bleibt danach nichts
   offen, schließt sich der Import selbst.

Bleibt etwas Unklares übrig, kannst du es mit `vorschlaege_verwerfen` wegräumen oder mit
`vorschlaege_lesen` einzeln zeigen. Und wenn Plan **und** Türliste vorliegen, siehe unten:
beides einzeln übernehmen, dann `import_zusammenfuehren`.

## Ein Kandidat

```json
{
  "kennung": "T-2.14",
  "raumnummer": "2.14",
  "raum": "Flur Ost",
  "art": "wartung_drehfluegel",
  "x": 0.42, "y": 0.68,
  "breite_m": 1.01,
  "richtung_grad": 90,
  "wartungspflichtig": true,
  "konfidenz": 0.9,
  "felder": { "ZULASSUNG": "T30-RS", "HERSTELLER": "Hörmann" },
  "text_nahe": ["T30-RS", "2.14"]
}
```

- **`x` / `y`** sind Anteile der Bildbreite und -höhe, `0..1`, gemessen am **Drehpunkt** der Tür
  (dort, wo Blatt und Wand zusammentreffen), nicht an der Mitte des Bogens. Ursprung oben links.
  Bei Türlisten ohne Plan bleiben sie weg — das Bauteil hat dann eben keine Position.
- **`art`** ist die Vorlage: `wartung_drehfluegel` (Standard), `wartung_fenster`,
  `wartung_feststellanlagen`. Feststellanlage, wenn im Plan oder in der Liste `FSA`,
  `Feststellanlage`, `Haftmagnet` oder `RWA` steht.
- **`wartungspflichtig`** nur bei echtem Anhalt: Brandschutzkennzeichnung (`T30`, `T90`, `EI30`,
  `RS`, `FSA` …), eine Spalte „Feuerwiderstand" mit Inhalt, oder eine Türliste, die ohnehin nur
  Brandschutztüren führt. Im Zweifel `false` — nicht wartungspflichtige Bauteile stehen trotzdem
  im Bestand und lassen sich später nachziehen.
- **`konfidenz`** ehrlich: `1.0` für eine Zeile aus einer Türliste, `0.9` für ein klares
  Türsymbol mit Bogen und Blatt, `0.6` für ein vermutetes, `0.4` für einen Scan, bei dem du dir
  nicht sicher bist. Danach entscheidet der Mensch, was er ohne Einzelprüfung annimmt.
- **`felder`** sind die Formularfelder des Protokolls: `ZULASSUNG`, `HERSTELLER`, `TUERTYP`,
  `OTS`, `ABSENKDICHTUNG`, `SPION`, `ETAGE`, `FENSTERTYP`, `FABRIK_BESCHLAEGE`. Was du nicht
  sicher liest, lässt du weg.
- **`text_nahe`** sind die Beschriftungen im Umkreis, wie sie dastehen — sie helfen dem Menschen
  beim Bestätigen.

## Was du nicht tust

- **Nichts erfinden.** Eine Zelle, die du nicht liest, bleibt leer. Eine Tür, die du nicht
  siehst, gibt es nicht. Lieber zwanzig sichere Kandidaten als vierzig geratene.
- **Keine Möbel, keine Fenster** (außer die Vorlage ist ausdrücklich `wartung_fenster`), keine
  Sanitärobjekte, keine Aufzugstüren.
- **Keine Bauteile anlegen.** Das macht die Freigabe. `bauteil_anlegen` ist für den Einzelfall
  von Hand da, nicht für den Import.
- **Nicht zweimal dieselbe Datei.** Vor einem neuen Import mit `vorschlaege_lesen` nachsehen,
  ob für dieses Geschoss schon etwas offen ist.

## Türliste und Plan zusammen

Liegt beides vor, wird beides einzeln übernommen (zwei `bauplan_uebernehmen`) und danach einmal
**`import_zusammenfuehren`** aufgerufen. Türwerk paart, was sicher zusammengehört: gleiche
Kennung, sonst gleiche Raumnummer, wenn dort auf beiden Seiten genau eine Tür steht. Der Rest
bleibt getrennt stehen. Position kommt vom Plan, Felder von der Liste.

## Nach der Freigabe

Aus jedem angenommenen Vorschlag wird ein Bauteil mit eigener Nummer. Ist die Kennung eine reine
Zahl und noch frei, wird sie die Nummer — dann meint „Tür 12" im Diktat dieselbe Tür wie die 12
im Plan. Sonst zählt Türwerk hoch. Ab da läuft alles wie immer: Fälligkeit, Begehung, Rundgang
in Laufreihenfolge, Protokoll.
