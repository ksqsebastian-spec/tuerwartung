# Bauplan-Import — Anleitung für den Agenten

Türwerk liest keine Pläne. Du liest sie — du hast die Datei ohnehin im Gespräch — und meldest
Türwerk, was du gefunden hast. Türwerk verwahrt es als **Vorschläge**, bis ein Mensch sie
freigibt. Erst dann entstehen Bauteile.

## Ablauf — zwei Schritte

Nur zwei Dinge sind echte Arbeit: die Datei lesen (das kann nur du) und die Freigabe (die muss
ein Mensch geben). Alles andere macht der Server — Türtypen, Geschosse, Nummern, Laufreihenfolge.

**Liegen Liste und Plan vor, nimm die Liste zuerst.** Sie trägt Türtypen und Stammdaten; der Plan
trägt nur Positionen und wird danach an den vorhandenen Bestand gehängt.

1. **Datei lesen und `einrichten` mit `tueren`.** Objekt, die gefundenen Türen, bei Plänen das
   Geschoss („EG", „1. OG", „UG" — unbekannte Namen werden angelegt). Ob Plan oder Türliste
   erkennt der Server an den Positionen; der Import wird nebenbei angelegt. Mehr als ~100 Türen:
   mehrfach aufrufen und ab dem zweiten Mal die zurückgegebene `import`-Kennung mitgeben.

   Die Antwort enthält einen fertigen **`bericht`** — den vorlesen, nicht die ganze Liste — und
   **`freigabe_moeglichkeiten`**: die üblichen Auswahlen samt Aufruf.

2. **Freigabe einholen und `einrichten` mit `freigeben`.** Der Mensch entscheidet („nimm alle mit
   T30", „alle ab 0.85") — im Gespräch oder auf der Planseite im Browser. Bleibt danach nichts
   offen, schließt sich der Import selbst.

Bleibt etwas Unklares übrig, kannst du es mit `vorschlaege_verwerfen` wegräumen oder mit
`stand` einzeln zeigen. Und wenn Plan **und** Türliste vorliegen, siehe unten:
beides einzeln übernehmen, dann ein zweiter `einrichten`-Aufruf.

## Was in einer echten Türen- oder Fensterliste steht

Die Listen aus dem Bauvorhaben sind breit (dreihundert Spalten sind normal), aber immer gleich
gebaut: ein paar Kopfzeilen, dann eine Zeile mit den Spaltenüberschriften, dann die Daten. Diese
Spalten brauchst du, alles andere kannst du überspringen:

| Was in der Liste steht | Wohin |
|---|---|
| **Ebene** („EG", „OG", „DG", „1. OG") | `geschoss` |
| **Tür Nummer AG** / Fenster Nummer AG („IT0.01", „AT0.11") | `kennung` |
| **Raum Nr** („0.02") | `raumnummer` — treibt die Laufreihenfolge |
| **Raumbezeichnung** („Abst. R.", „Krippe 2") | `raum` |
| **Türtyp** („FS 30 RD", „Vollspan", „Alu-Rohrrahmen") | `tuertyp` |
| **RS/FS** („T30 RS", „DS", „-") | siehe unten |
| **Zulassung** („AbZ Z-6.20-2095") | `felder.ZULASSUNG` |
| **OTS** („GEZE TS 5000") | `felder.OTS` |
| **Absenkdichtung** | `felder.ABSENKDICHTUNG` |

**Wartungspflichtig** ist eine Zeile, wenn in **RS/FS** etwas steht, das kein Strich ist: `T30`,
`T30 RS`, `RS`, `DS`, `EI30`. Ein `-` oder eine leere Zelle heißt: nicht wartungspflichtig. Das
ist die verlässlichste Regel — verlass dich nicht auf den Türtyp allein.

**Den Türtyp aus Türtyp + RS/FS bilden**, wenn die Zeile wartungspflichtig ist: aus „FS 30 RD"
und „T30 RS" wird der Türtyp `FS 30 RD T30 RS`. Sonst genügt der Türtyp. Gleiche Schreibweise
heißt gleicher Typ — Türwerk legt ihn beim ersten Vorkommen an, mit den Feldern dieser Zeile als
gemeinsame Stammdaten, und hängt alle weiteren Zeilen daran. Aus 67 Zeilen werden so etwa ein
Dutzend Typen, jeder mit eigener Checkliste.

**Konfidenz 1.0** bei Listenzeilen. Du hast sie gelesen, nicht geraten.

Eine Liste umfasst das ganze Haus. Gib deshalb `geschoss` **je Zeile** mit, nicht als Argument
des Imports — das ist nur für Pläne gedacht, die ein Stockwerk zeigen.

## Fensterlisten sind anders gebaut

Eine Fensterliste desselben Bauvorhabens sieht auf den ersten Blick aus wie die Türenliste, hat
aber drei Eigenheiten, an denen ein unbedachter Import scheitert:

**Die Kennung steht in Spalte „Nr.", nicht in „Fenster Nummer AG".** Die AG-Spalte ist in echten
Listen oft über alle Zeilen leer — der Bauherr hat nie eine Nummer vergeben. Die laufende Nummer
links (`A`, `B`, … `Z`, `AA` … `BV`) ist dann die einzige Kennung, die es gibt, und sie ist
eindeutig. Nimm sie. Sie ist keine Zahl, also bleibt die Türnummer die des Servers; das ist
richtig so.

**Es gibt keine Türtyp-Spalte.** Der Typ steht verteilt über die Zeile und wird von dir gebildet:

| Was in der Liste steht | Wohin |
|---|---|
| **Nr.** („A", „AA", „BV") | `kennung` |
| **Ebene** („EG", „1.OG", „DG") | `geschoss` |
| **Raum Nr** / **Raumbezeichnung** | `raumnummer`, `raum` |
| **Material** (`K`, `H`, `HA`, `A`) | Kunststoff, Holz, Holz-Alu, Alu |
| **Farbe** („weiß", „RAL 7016") | zweiter Teil des Namens |
| **Öffnungsart** — schmale Spalten, in denen eine Zahl steht: `DK`, `D`, `HSK`, `PSK`, `F/FF`, `OL` | dritter Teil des Namens, in dieser Reihenfolge mit `/` verbunden |

Die Öffnungsart-Spalten stehen zu zweit oder zu dritt unter einer gemeinsamen Überschrift eine
Zeile höher („bis 1x2 m" / „größer 1x2 m" / „Elektr." unter `OL`) — es zählt die Überschrift,
nicht die Einzelspalte, sonst zerfällt ein Typ in drei. Nur `Elektr.` sagt zusätzlich etwas über
das Fenster und hängt sich hinten an: aus `K` + `weiß` + `DK`, `F/FF`, `OL` (elektrisch) wird der
Türtyp `Kunststoff weiß DK/F/FF/OL elektr.`, und dieselbe Kombination in der nächsten Zeile fällt
auf denselben Typ. Schreib den
Namen jedes Mal **zeichengleich** — Türwerk vergleicht genau und nicht ungefähr, damit
„Kunststoff weiß" und „Kunststoff weiß DK/F/FF/OL elektr." zwei Typen bleiben und nicht einer.

**Es gibt keine RS/FS-Spalte.** Die Regel von oben greift hier nicht: eine Fensterliste führt
Fenster, die gewartet werden — alle Zeilen sind `wartungspflichtig: true`, und alle bekommen
`art: "wartung_fenster"`. Die gebildete Öffnungsart gehört zusätzlich nach `felder.FENSTERTYP`.

**Unvollständige Zeilen bleiben unvollständig.** In echten Listen ist ein ganzer Block schon
angelegt, aber noch nicht ausgefüllt — Farbe steht da, Material und Öffnungsart nicht. Bau daraus
keinen Typ namens „weiß": das ist kein Fenster, das ist eine Lücke. Nimm dann den Typ, den die
Zeile hergibt (`Kunststoff weiß`, wenn wenigstens das Material dasteht), sonst lass `tuertyp`
weg. Setz bei jeder solchen Zeile die Konfidenz auf `0.5` — dann meldet Türwerk sie von selbst
als unsicher, und du musst nichts extra erklären. Der Mensch entscheidet, ob so eine Zeile
schon in den Bestand soll.

**Türen und Fenster wohnen im selben Objekt.** Beide Listen nacheinander übernehmen; die Nummern
laufen einfach weiter, und der Rundgang mischt sie nach Geschoss und Raumnummer. Schreibt die eine
Liste „OG" und die andere „1.OG", ist das dieselbe Etage — Türwerk führt sie zusammen, du musst
nichts angleichen.

## Ein Grundriss hat die Türnummern meist als Text

Bevor du auf das Bild schaust: **lies die Textebene des PDFs.** Bei Plänen aus einem CAD-Programm
stehen die Türnummern dort als echter Text mit Koordinaten — „IT0.05" an Position x/y. Das ist
exakt, kostet nichts und trifft nicht daneben. Rechne die Koordinaten auf Anteile der Seitenbreite
und -höhe um (0..1) und gib sie als `x` / `y` mit, Konfidenz 1.0.

Erst wenn die Textebene leer ist (gescannter Plan, reines Bild), schaust du hin und schätzt — dann
mit ehrlicher Konfidenz.

**Kommt der Plan nach der Liste**, ist das kein zweiter Bestand: Türwerk erkennt die Kennungen
wieder und trägt die Position an der vorhandenen Tür nach. Dafür braucht es keine Freigabe, und es
entstehen keine Dubletten. Der Bericht sagt dir, wie viele verortet wurden.

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
- **Keine Bauteile anlegen.** Das macht die Freigabe. `einrichten` ist für den Einzelfall
  von Hand da, nicht für den Import.
- **Nicht zweimal dieselbe Datei.** Vor einem neuen Import mit `stand` nachsehen,
  ob für dieses Geschoss schon etwas offen ist.

## Türliste und Plan zusammen

Liegt beides vor, wird beides einzeln übernommen (zwei `einrichten` mit `tueren`) und danach einmal
**ein zweiter `einrichten`-Aufruf** aufgerufen. Türwerk paart, was sicher zusammengehört: gleiche
Kennung, sonst gleiche Raumnummer, wenn dort auf beiden Seiten genau eine Tür steht. Der Rest
bleibt getrennt stehen. Position kommt vom Plan, Felder von der Liste.

## Nach der Freigabe

Aus jedem angenommenen Vorschlag wird ein Bauteil mit eigener Nummer. Ist die Kennung eine reine
Zahl und noch frei, wird sie die Nummer — dann meint „Tür 12" im Diktat dieselbe Tür wie die 12
im Plan. Sonst zählt Türwerk hoch. Ab da läuft alles wie immer: Fälligkeit, Begehung, Rundgang
in Laufreihenfolge, Protokoll.
