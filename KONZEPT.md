# Türwerk — Datenmodell und Entscheidungen

Die Spezifikation, aus der Türwerk 2 entstanden ist, nachgeführt auf den heutigen Stand.
Was gebaut ist, steht im README; hier steht, **warum** es so aussieht — das Datenmodell, die
Regeln der Erfassung, die Versionierung der Berichte und alles, was der Bauplan-Import an
echten Unterlagen gelernt hat.

Herausgenommen, weil es die Sache nicht mehr beschreibt: der Rundgang ohne Netz, die Fotos, die
Mängel als eigene Ebene, die Tagestour, die Liste der damals vierundvierzig Tools und die
Web-Routen. Der Werkzeugkasten hat heute sechs Namen und steht im README; die Oberfläche ändert
sich schneller als dieses Papier.

---

## 0. Leitsätze

1. **Das Bauteil ist die feste Größe, nicht der Termin.** Eine Tür existiert einmal und trägt
   ihre Geschichte. Eine Begehung ist ein Ereignis, das Prüfungen an Bauteilen erzeugt.
2. **Das Diktat bleibt der Regelweg.** Alles, was Türwerk 1 vor Ort kann, kann Türwerk 2
   genauso — die Sprache des Monteurs ändert sich nicht („Tür 12, Punkt 8 nicht").
3. **Das erste Mal ist die Bestandsaufnahme.** Ein Objekt ohne Bestand wird durch die erste
   Begehung angelegt. Der Bauplan-Import ist ein Beschleuniger, keine Voraussetzung.
4. **Nichts geht still verloren, nichts wird still überschrieben.** Protokolle sind versioniert.
   Was nicht in Ordnung war, bleibt an der Tür stehen, bis eine spätere Prüfung es aufhebt.
5. **KI dort, wo Sprache oder Bilder zu deuten sind — Geometrie und Sortierung sind Rechnung.**
6. **Der Mensch bestätigt den Bestand.** Kein Import legt Bauteile ohne Freigabe an.
7. **Die Website ist nicht die zweite Bedienung.** Die Intelligenz sitzt im Agenten am Diktat;
   die Seiten sind zum Nachsehen und für den einen Griff, der gerade dran ist. Wo eine Seite
   einen Zustand hat, sagt sie ihn in einem Satz und bietet genau einen Knopf an — der Rest
   steht leise darunter. Doppelte Wege zum selben Ziel werden entfernt, nicht ergänzt.
8. **Was der Mensch nicht denkt, steht nicht auf dem Schirm.** Der Monteur denkt „ich bin an der
   Kita", nicht „ich setze eine Begehung fort". Interne Größen — die Begehung, das Geschoss —
   bleiben im Datenmodell und entstehen aus dem, was ohnehin gesagt wird; sie werden nicht zu
   Knöpfen und Verwaltungsseiten.
9. **Erst die Stammdaten, dann die Arbeit.** Ein Türtyp trägt, was für alle Türen seiner Art
   gilt, und bringt die Checkliste mit. Eine Tür ist erst prüfbar, wenn steht, was ihr Typ
   verlangt — was beim Anlegen fehlt, fehlt später im Bericht.
10. **Ein Tool je Absicht, nicht je Datenbankschritt.** Was zusammen gemeint ist, wird zusammen
   erledigt: „ich bin fertig" heißt abschließen *und* Berichte *und* Sammelbericht. Und was der
   Server ausrechnen kann, fragt er nicht ab — weder den Menschen noch den Agenten (Lagebild,
   Tagesplanung, Etage).

### Nicht-Ziele (v2)

- Kein HERO-Abgleich (kommt in v3; Felder dafür sind vorgesehen, siehe `hero_*`).
- Kein Betreiberportal, keine Mandantentrennung (Felder vorgesehen, Zugriff bleibt „alle vier sehen alles").
- Keine E-Mail-Erinnerungen (Fälligkeit wird angezeigt und per Tool abgefragt; Versand in v3).
- Keine Mängelverwaltung als eigene Ebene: eine Abweichung heißt, die Tür hat nicht bestanden.
  Was beim letzten Mal offen war, wird aus der vorigen Prüfung gelesen (siehe 2.2).
- Kein zweiter Erfassungsweg ohne Netz: der Rundgang mit Service Worker und Warteschlange ist
  entfallen. Diktat und Formular reichen.
- Keine DWG-Verarbeitung (nur PDF und Bilder; DWG vorher wandeln).
- **Kein KI-Aufruf aus dem Worker.** Was zu deuten ist, deutet der Agent, der den Plan
  ohnehin in Händen hält (Abschnitt 7.0).

---

## 1. Datenmodell

D1, SQLite-Dialekt. Ersetzt `schema.sql` vollständig. Die Produktivdatenbank ist leer
(geprüft am 13. August 2026, 0 Wartungen) — **es gibt keine Migration**, nur `DROP` der alten
Tabellen `wartungen` und `tueren` und `CREATE` der neuen. `personen` bleibt und bekommt eine Spalte.

Konventionen: IDs sind Text (ULID, 26 Zeichen, zeitlich sortierbar), außer wo ein sprechender
Schlüssel besser ist. Zeiten als Unix-Millisekunden `INTEGER`. Datumsangaben als `TEXT`
`YYYY-MM-DD`. JSON-Spalten heißen `*_json`.

```sql
-- Personen: die vier Konten, wie in v1, plus Rolle.
ALTER TABLE personen ADD COLUMN rolle TEXT NOT NULL DEFAULT 'monteur';  -- monteur | buero

-- Ein Objekt = eine Liegenschaft mit einem Betreiber und einem Wartungsrhythmus.
CREATE TABLE objekte (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,             -- „Kita Heselstücken"
  adresse          TEXT NOT NULL DEFAULT '',  -- Straße, PLZ Ort (eine Zeile)
  plz              TEXT NOT NULL DEFAULT '',
  betreiber        TEXT NOT NULL DEFAULT '',  -- Name, wie er aufs Protokoll gehört
  betreiber_kontakt TEXT NOT NULL DEFAULT '', -- Name des Ansprechpartners vor Ort
  telefon          TEXT NOT NULL DEFAULT '',
  email            TEXT NOT NULL DEFAULT '',
  zugang           TEXT NOT NULL DEFAULT '',  -- wie man reinkommt (siehe unten)
  vertrag          TEXT NOT NULL DEFAULT '',  -- Wartungsvertrag / Auftragsnummer
  objektart        TEXT NOT NULL DEFAULT '',  -- „Kita", „Schule", „Bürogebäude"
  ident            TEXT NOT NULL DEFAULT '',  -- Ident-Nummer des Betreibers, falls vorhanden
  intervall_monate INTEGER NOT NULL DEFAULT 12,
  rechtsgrundlagen TEXT NOT NULL DEFAULT '',  -- leer = Standard je Vorlage
  notizen          TEXT NOT NULL DEFAULT '',
  hero_kunde_id    TEXT,                      -- v3
  hero_projekt_id  TEXT,                      -- v3
  aktiv            INTEGER NOT NULL DEFAULT 1,
  angelegt_von     TEXT NOT NULL DEFAULT '',
  angelegt_am      INTEGER NOT NULL,
  geaendert_am     INTEGER NOT NULL
);

-- Gebäude: fast immer genau eins je Objekt. Wird beim Anlegen des Objekts automatisch
-- als „Hauptgebäude" erzeugt; die Oberfläche blendet die Ebene aus, solange es nur eins gibt.
CREATE TABLE gebaeude (
  id          TEXT PRIMARY KEY,
  objekt_id   TEXT NOT NULL REFERENCES objekte(id),
  name        TEXT NOT NULL DEFAULT 'Hauptgebäude',
  reihenfolge INTEGER NOT NULL DEFAULT 0
);

-- Geschoss: trägt den Plan. Ein Plan je Geschoss, als Rasterbild in R2.
CREATE TABLE geschosse (
  id            TEXT PRIMARY KEY,
  gebaeude_id   TEXT NOT NULL REFERENCES gebaeude(id),
  name          TEXT NOT NULL,                -- „EG", „1. OG", „UG"
  reihenfolge   INTEGER NOT NULL DEFAULT 0,   -- Laufreihenfolge: UG=−1, EG=0, 1.OG=1 …
  plan_schluessel TEXT,                       -- R2: plaene/<objekt>/<geschoss>.png
  plan_breite   INTEGER,                      -- Pixel des Rasterbilds
  plan_hoehe    INTEGER,
  plan_quelle   TEXT,                         -- R2-Schlüssel der Originaldatei (PDF/DXF/JPG)
  einheiten_je_meter REAL,                    -- Plan-Einheiten je Meter, falls bekannt/geschätzt
  start_x       REAL,                         -- Startpunkt des Rundgangs (normiert 0..1), z. B. Treppenhaus
  start_y       REAL
);

-- Bauteil: die dauerhafte Tür (oder das Fenster, die Feststellanlage).
CREATE TABLE bauteile (
  id            TEXT PRIMARY KEY,
  objekt_id     TEXT NOT NULL REFERENCES objekte(id),
  geschoss_id   TEXT REFERENCES geschosse(id),   -- NULL erlaubt: Tür ohne Plan
  nr            INTEGER NOT NULL,                -- „Tür 12" — je Objekt eindeutig, wird diktiert
  kennung       TEXT NOT NULL DEFAULT '',        -- Türnummer aus Türliste/Plan, z. B. „T-2.14"
  art           TEXT NOT NULL,                   -- Vorlagen-ID: wartung_drehfluegel | wartung_fenster | wartung_feststellanlagen
  bezeichnung   TEXT NOT NULL DEFAULT '',        -- freier Name, z. B. „Flur Ost zur Küche"
  raumnummer    TEXT NOT NULL DEFAULT '',        -- „2.14" — treibt die Laufreihenfolge
  raum          TEXT NOT NULL DEFAULT '',        -- Raumbezeichnung
  flur          TEXT NOT NULL DEFAULT '',
  felder_json   TEXT NOT NULL DEFAULT '{}',      -- HERSTELLER, OTS, ABSENKDICHTUNG, SPION, ZULASSUNG, FENSTERTYP, FABRIK_BESCHLAEGE, TUERTYP …
  x             REAL,                            -- Position im Geschossplan, normiert 0..1 (NULL = nicht verortet)
  y             REAL,
  richtung_grad REAL,                            -- Anschlagsrichtung aus dem Plan, informativ
  breite_m      REAL,                            -- lichte Breite aus Plan/Türliste, informativ
  intervall_monate INTEGER,                      -- NULL = Objektintervall
  wartungspflichtig INTEGER NOT NULL DEFAULT 1,  -- 0 = im Bestand, aber nicht Teil der Wartung
  aktiv         INTEGER NOT NULL DEFAULT 1,      -- 0 = stillgelegt/ausgebaut, bleibt für Historie
  quelle        TEXT NOT NULL DEFAULT 'manuell', -- manuell | rundgang | tuerliste | plan | scan
  angelegt_am   INTEGER NOT NULL,
  geaendert_am  INTEGER NOT NULL,
  UNIQUE (objekt_id, nr)
);
CREATE INDEX idx_bauteile_objekt ON bauteile (objekt_id, aktiv, nr);

-- Begehung: ein Termin an einem Objekt. Ersetzt `wartungen`.
CREATE TABLE begehungen (
  id              TEXT PRIMARY KEY,
  objekt_id       TEXT NOT NULL REFERENCES objekte(id),
  datum           TEXT NOT NULL,                 -- Prüfdatum
  pruefer         TEXT NOT NULL DEFAULT '',
  befaehigung     TEXT NOT NULL DEFAULT 'Sachkundiger DGWZ',
  ort             TEXT NOT NULL DEFAULT 'Hamburg',
  beteiligte      TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'laufend',  -- geplant | laufend | abgeschlossen
  betreiber_unterschrift TEXT,                   -- R2: unterschriften/betreiber/<begehung>.png
  betreiber_name  TEXT NOT NULL DEFAULT '',      -- wer unterschrieben hat
  unterschrieben_am INTEGER,
  angelegt_von    TEXT NOT NULL DEFAULT '',
  angelegt_am     INTEGER NOT NULL,
  geaendert_am    INTEGER NOT NULL
);
CREATE INDEX idx_begehungen_objekt ON begehungen (objekt_id, datum DESC);

-- Prüfung: ein Bauteil, einmal, in einer Begehung. Ersetzt `tueren`.
CREATE TABLE pruefungen (
  id             TEXT PRIMARY KEY,
  begehung_id    TEXT NOT NULL REFERENCES begehungen(id),
  bauteil_id     TEXT NOT NULL REFERENCES bauteile(id),
  checks_json    TEXT NOT NULL DEFAULT '{}',     -- {"8":"nio"} — leer = alles i. O.
  ergebnis       TEXT NOT NULL DEFAULT 'bestanden',  -- bestanden | Nachbesserung
  hinweise       TEXT NOT NULL DEFAULT '',
  felder_snapshot_json TEXT NOT NULL DEFAULT '{}',   -- Bauteilfelder zum Zeitpunkt der Prüfung (fürs PDF und die Historie)
  stand_hash     TEXT NOT NULL DEFAULT '',       -- SHA-256 über alles, was ins PDF geht; s. Abschnitt 4
  geprueft_am    INTEGER NOT NULL,               -- Client-Zeit beim Erfassen (Offline-Konflikte)
  geprueft_von   TEXT NOT NULL DEFAULT '',
  angelegt_am    INTEGER NOT NULL,
  geaendert_am   INTEGER NOT NULL,
  UNIQUE (begehung_id, bauteil_id)
);
CREATE INDEX idx_pruefungen_bauteil ON pruefungen (bauteil_id, geprueft_am DESC);



-- Bericht: eine erzeugte PDF-Version. Wird nie gelöscht, nie überschrieben.
CREATE TABLE berichte (
  id            TEXT PRIMARY KEY,
  pruefung_id   TEXT NOT NULL REFERENCES pruefungen(id),
  version       INTEGER NOT NULL,               -- 1, 2, 3 …
  r2_schluessel TEXT NOT NULL,                  -- berichte/<objekt>/<bauteil>/<begehung>/v<version>.pdf
  stand_hash    TEXT NOT NULL,                  -- der Stand, aus dem diese Version entstand
  seiten        INTEGER NOT NULL DEFAULT 1,
  erzeugt_am    INTEGER NOT NULL,
  erzeugt_von   TEXT NOT NULL DEFAULT '',
  UNIQUE (pruefung_id, version)
);

-- Sammelbericht je Begehung (Deckblatt + alle aktuellen Einzelberichte), ebenfalls versioniert.
CREATE TABLE sammelberichte (
  id            TEXT PRIMARY KEY,
  begehung_id   TEXT NOT NULL REFERENCES begehungen(id),
  version       INTEGER NOT NULL,
  r2_schluessel TEXT NOT NULL,                  -- berichte/<objekt>/_sammel/<begehung>/v<version>.pdf
  erzeugt_am    INTEGER NOT NULL,
  UNIQUE (begehung_id, version)
);

-- Import: ein hochgeladener Plan oder eine Türliste, mit Zustand der Auswertung.
CREATE TABLE importe (
  id            TEXT PRIMARY KEY,
  objekt_id     TEXT NOT NULL REFERENCES objekte(id),
  geschoss_id   TEXT REFERENCES geschosse(id),  -- bei Plänen gesetzt, bei Türlisten NULL
  art           TEXT NOT NULL,                  -- tuerliste | plan_vektor | plan_raster | dxf
  dateiname     TEXT NOT NULL,
  r2_schluessel TEXT NOT NULL,                  -- importe/<objekt>/<id>.<ext>
  status        TEXT NOT NULL DEFAULT 'hochgeladen',  -- hochgeladen | ausgewertet | bestaetigt | verworfen
  ergebnis_json TEXT NOT NULL DEFAULT '{}',     -- Statistik: gefunden, angenommen, verworfen, Warnungen
  angelegt_von  TEXT NOT NULL DEFAULT '',
  angelegt_am   INTEGER NOT NULL
);

-- Vorschlag: ein Kandidat aus einem Import, bis er angenommen oder verworfen ist.
CREATE TABLE vorschlaege (
  id            TEXT PRIMARY KEY,
  import_id     TEXT NOT NULL REFERENCES importe(id),
  objekt_id     TEXT NOT NULL,
  geschoss_id   TEXT REFERENCES geschosse(id),
  x             REAL,                           -- normiert 0..1, NULL bei Türlisten-Zeilen ohne Position
  y             REAL,
  richtung_grad REAL,
  breite_m      REAL,
  kennung       TEXT NOT NULL DEFAULT '',
  raumnummer    TEXT NOT NULL DEFAULT '',
  raum          TEXT NOT NULL DEFAULT '',
  art           TEXT NOT NULL DEFAULT 'wartung_drehfluegel',
  felder_json   TEXT NOT NULL DEFAULT '{}',
  wartungspflichtig INTEGER NOT NULL DEFAULT 0, -- 1 nur bei Feuerwiderstand/Kennzeichnung/Türliste
  konfidenz     REAL NOT NULL,                  -- 0..1, s. Abschnitt 7.6
  herkunft      TEXT NOT NULL,                  -- tuerliste | geometrie | vision | zusammengefuehrt
  text_nahe_json TEXT NOT NULL DEFAULT '[]',    -- Beschriftungen in der Nähe (zur Anzeige)
  status        TEXT NOT NULL DEFAULT 'offen',  -- offen | angenommen | verworfen
  bauteil_id    TEXT REFERENCES bauteile(id),   -- gesetzt nach Annahme
  angelegt_am   INTEGER NOT NULL
);
CREATE INDEX idx_vorschlaege_import ON vorschlaege (import_id, status);


```

### Abgeleitete Größen (nicht gespeichert, beim Lesen berechnet)

- **Fälligkeit eines Bauteils** = `letzte Prüfung (max geprueft_am) + intervall` mit
  `intervall = bauteil.intervall_monate ?? objekt.intervall_monate`. Ohne Prüfung: sofort fällig.
  Nur `aktiv = 1 AND wartungspflichtig = 1`.
- **Fälligkeit eines Objekts** = frühestes fälliges Bauteil. Zustand: `ueberfaellig` (Datum <
  heute), `bald` (≤ 30 Tage), `ok`.
- **„Nächste Prüfung" im PDF** = Fälligkeit des Bauteils nach dieser Prüfung.
- **„Letzte Prüfung" im PDF** = Datum der vorangegangenen Prüfung dieses Bauteils, sonst leer.

---

### 1.2 Türtypen und ihre Checkliste

Über den Bauteilen steht der **Türtyp**: eine benannte Ausprägung einer der drei Vorlagen —
„T30 Flurtür Hörmann" auf Basis „Drehflügeltüren". Er trägt zweierlei:

1. **Gemeinsame Stammdaten** (`felder_json`) — Hersteller, Zulassung, Türtyp-Bezeichnung. Was für
   alle Türen dieses Typs gleich ist, steht einmal am Typ statt an jeder Tür.
2. **Seine Checkliste** (`punkte_json`) — die Prüfpunkte der Vorlage, wie sie hier gelten.
   Umbenannt, ausgeblendet, um eigene ergänzt.

Dazu `pflicht_json` — was an einer Tür stehen muss, bevor geprüft werden darf (typisch `IDENT`) —
und `zusatz_json` — was je Tür zusätzlich erfasst wird (Geschoss, Kommentar).

**Der Haken beim Anpassen ist das PDF.** Das Formular hat feste Ankreuzkästchen. Deshalb:

- Punkte aus der Vorlage behalten **ihre Nummer**. Umbenennen ändert nur den Text.
- Ausblenden löscht nicht, es lässt das Kästchen leer — und die Historie bleibt lesbar.
- Eigene Punkte zählen ab **900** und stehen im Bericht unter „Hinweise", weil das Formular für
  sie kein Kästchen hat.

Die Checkliste hängt am Typ, nicht am Termin — sie bleibt gleich. Deshalb steht sie in der
Oberfläche **oben in der Leiste** neben den Stammdaten und nicht am Objekt (Abschnitt 10).

---

### 1.1 Stammdaten eines Objekts

Neben Name, Adresse und Betreiber trägt ein Objekt, was einen Monteur sonst einen Anruf oder
eine vergebliche Anfahrt kostet:

| Feld | Wofür |
|---|---|
| `objektart` | „Kita", „Schule", „Bürogebäude" — Einordnung und Suche |
| `betreiber_kontakt`, `telefon`, `email` | wer vor Ort aufmacht und wie man ihn erreicht |
| **`zugang`** | „Schlüssel beim Hausmeister, Herr Kern 0171-…", „Anmeldung im Sekretariat", „Codeschloss 1234" |
| `vertrag` | Wartungsvertrag oder Auftragsnummer, gehört auf die Papiere |

`zugang` ist das wichtigste davon und wird deshalb überall mitgeführt, wo jemand gleich losfährt:
sichtbar auf der Objektseite unter der Adresse und in `objekt_lesen`. Gefüllt werden sie am
bequemsten über `objekt_einrichten` (Abschnitt 8),
das genau eine Frage nach der anderen stellt.

---

## 2. Erfassung

### 2.1 Begehung starten

`begehung_starten(objekt)` — `objekt` darf Name, Adresse oder ID sein; Auflösung per
`LIKE`, bei Mehrdeutigkeit Fehler mit Trefferliste. Existiert das Objekt nicht, wird es
angelegt (mit `art` der ersten Tür als Vorgabe für Folgeteile) — **das ist der Bootstrap-Pfad**
und muss ohne jeden Umweg funktionieren: „Türenwartung Kita Heselstücken, Drehflügel" reicht.

Antwort enthält: Begehungs-ID, Objekt-Stammdaten, Anzahl Bauteile, **Liste der fälligen
Bauteile in Laufreihenfolge** (nr, kennung, raum, Fälligkeit, letztes Ergebnis),
und die nächste freie `nr`.

### 2.2 Prüfung erfassen

`pruefung_erfassen(begehung, nr?, kennung?, checks?, ergebnis?, hinweise?, felder?, wie_davor?, neu?)`

Auflösung des Bauteils, in dieser Reihenfolge:
1. `nr` gegeben und Bauteil mit dieser `nr` existiert → das.
2. `kennung` gegeben und eindeutig → das.
3. `nr` gegeben, aber unbekannt → **wenn `neu` nicht ausdrücklich `false`**: Bauteil mit dieser
   `nr` anlegen, `quelle = 'rundgang'`, `art` aus Argument oder aus der zuletzt erfassten
   Prüfung dieser Begehung. Antwort trägt `neu_angelegt: true`. Das ist der „unbekannte
   Tür"-Weg und die Bestandsaufnahme beim ersten Mal.
4. Nichts gegeben → nächste freie `nr` im Objekt, Bauteil anlegen.

`wie_davor: true` übernimmt `felder`, `checks`, `ergebnis` der **zuletzt in dieser Begehung
erfassten Prüfung**; eigene Argumente überschreiben einzeln. Felder werden **auf das Bauteil
geschrieben** (Stammdaten bleiben für nächstes Jahr), nicht nur in den Snapshot.

Existiert für (begehung, bauteil) schon eine Prüfung → Überschreiben, das ist die Korrektur.

Nach dem Speichern:
- `felder_snapshot_json` = Bauteilfelder + Objektfelder zum Zeitpunkt.
- `stand_hash` neu berechnen (Abschnitt 4.1).
- **Was beim letzten Mal offen war** wird nicht gespeichert, sondern gelesen: die jüngste
  frühere Prüfung dieses Bauteils, sofern sie „Nachbesserung" ergab. Sie kommt als `nachsehen`
  zurück, und Claude fragt danach: „an dieser Tür war 2025 Punkt 10 offen — erledigt?" Eine
  zweite, gepflegte Mängelliste sagte dasselbe an zweiter Stelle und lief irgendwann auseinander.
- Antwort: `gespeichert` (je Tür eine Zeile mit Ort, Ergebnis und den Abweichungen im
  Klartext), `neu_angelegt`, `nachsehen`, `unvollstaendig`, `noch_offen`, `naechste_nr`.

Ein Aufruf nimmt mehrere Türen entgegen; die Reihenfolge zählt, `wie_davor` bezieht sich auf
die vorige Zeile des Stapels bzw. die zuletzt gespeicherte Prüfung.

### 2.4 Begehung abschließen — ein Aufruf, alles fertig

`begehung_abschliessen(begehung, berichte=true, alle_neu=false)` erledigt, was zusammen gemeint
ist (Leitsatz 9):

1. Status `abgeschlossen`,
2. **Rückblick** — je Prüfung Ort, Abweichungen im Klartext, Ergebnis; Summe; **Liste der
   fälligen, aber nicht geprüften Bauteile** („3 Türen im 2. OG fehlen noch — absichtlich?"),
3. **Einzelberichte** im selben Zeitbudget wie `berichte_erzeugen`,
4. **Sammelbericht**, sobald kein Einzelbericht mehr offen ist.

Reicht die Rechenzeit nicht, kommt `berichte.fertig: false` zurück — dann einfach noch einmal
aufrufen. Erzeugt wird nur, wo sich der Stand geändert hat, ein zweiter Aufruf macht also keine
zweite Version. Ein Termin ohne Prüfung schließt ohne Berichte ab, das ist kein Fehler.
`berichte=false` schließt nur ab. Abschließen ist jederzeit rücknehmbar
(`begehung_aendern status=laufend`).

Vorher waren das drei Aufrufe — abschließen, erzeugen (mehrfach), Sammelbericht —, also drei
Gelegenheiten für den Agenten, in der Mitte aufzuhören.

### 2.5 Begehung abbrechen

`begehung_abbrechen(begehung)` — der Termin platzt, der Monteur wird weggerufen, das Objekt war
das falsche. Zwei Fälle:

- **Noch keine Prüfung daran** → die Begehung wird gelöscht. Sie hat nicht stattgefunden;
  niemand soll später über eine leere Zeile stolpern.
- **Prüfungen daran** → sie bleiben (geprüft ist geprüft), die Begehung geht auf Status
  `abgebrochen` und zählt nicht mehr als laufend. `begehung_starten` setzt sie nicht fort,
  sondern legt eine neue an. Rücknehmbar über `begehung_aendern status=laufend`.

Status ist damit `geplant | laufend | abgeschlossen | abgebrochen`.

---

## 3. Fristen

Keine Tabelle, nur Berechnung (Abschnitt 1, abgeleitete Größen). Oberflächen:

- **Startseite `/objekte`**: Objekte sortiert nach Fälligkeit, Zustand als Chip
  (rot überfällig, gelb ≤ 30 Tage, grün), daneben das letzte Ergebnis.
- **Tool `faellig(tage=30)`**: Objekte mit Fälligkeit ≤ heute + tage, mit Anzahl fälliger
  Bauteile — damit „was ist diese Woche dran?" im Chat funktioniert.
- **Objektseite**: Bauteile mit letzter Prüfung und Fälligkeit; Filter „nur fällige".
- **Checkliste `/checkliste/:tuertyp`**: die Prüfpunkte zum Mitlesen, siehe Abschnitt 1.2.

Ein Bauteil, das in einer Begehung geprüft wurde, ist ab dann für `intervall` Monate nicht
fällig. Ein Objekt gilt als „fertig für dieses Jahr", wenn kein Bauteil fällig ist.

---

## 4. Berichte

### 4.1 Versionierung

- `stand_hash` = SHA-256 über die kanonische JSON-Serialisierung von
  `{ objekt: {name, adresse, betreiber, ident, rechtsgrundlagen}, begehung: {datum, pruefer,
  befaehigung, ort, beteiligte, betreiber_name, unterschrieben_am}, bauteil: {nr, kennung, art,
  raum, raumnummer, flur, felder}, pruefung: {checks, ergebnis, hinweise},
  unterschrift_pruefer: r2_schluessel }` — Schlüssel sortiert, keine Zeitstempel außer
  `unterschrieben_am`.
- `berichte_erzeugen` erzeugt für jede Prüfung, deren `stand_hash` **nicht** dem Hash der
  neuesten Berichtsversion entspricht, eine **neue Version** `max(version)+1`. Bestehende
  Versionen werden nie angefasst. Ein Bericht, der schon beim Kunden liegt, bleibt genau so.
- **Der gespeicherte Hash muss nachgezogen werden, bevor man ihn vergleicht.**
  `pruefungen.stand_hash` wird nur beim Schreiben einer Prüfung gesetzt. Ändert sich danach
  etwas, das im Bericht steht — Prüfort, Prüfer, Objektname, die Unterschrift des Betreibers —,
  bleibt er stehen. `berichte_erzeugen` rechnet ihn ohnehin neu und macht die neue Version; die
  **Anzeige** verglich aber gegen den alten Wert und meldete „aktuell", während beim Kunden ein
  PDF lag, das nicht mehr stimmte. Deshalb frischt `berichtsUebersicht` die Hashes zuerst auf
  (`standHashesAuffrischen`) — das ist der einzige Schreibvorgang auf einem Lesepfad hier, und
  er passiert nur, wenn sich wirklich etwas geändert hat.
- Anzeige: Berichte-Liste zeigt die neueste Version, ein Aufklapper zeigt ältere; veraltete
  tragen „Stand geändert". `lage` meldet sie als eigenen Punkt mit `begehung_abschliessen` als
  nächstem Schritt. ZIP enthält die neuesten Versionen.
- R2 bleibt privat; Auslieferung nur über `/datei/…` mit Sitzung (wie v1).

### 4.2 Betreiber-Unterschrift

- Seite `/begehung/:id/unterschrift`: Canvas-Unterschriftsfeld (Touch + Maus), Feld
  „Name des Unterzeichnenden", Knopf „Unterschreiben". Speichert PNG (transparenter Hintergrund,
  max. 800×300) nach R2 `unterschriften/betreiber/<begehung>.png`, setzt `betreiber_name`,
  `unterschrieben_am`, und **löst `berichte_erzeugen` aus** (Hash ändert sich).
- Die Profile bekommen ein neues Feld `signature_betreiber` (Koordinaten wie `signature`).
  Startwerte, **beim ersten Testlauf visuell kalibrieren** (aus dem 110-dpi-Render abgemessen,
  ±5 pt möglich):
  - `wartung_drehfluegel`: `{ "x": 318, "top": 772, "w": 110, "h": 40 }`
  - `wartung_feststellanlagen`: `{ "x": 316, "top": 792, "w": 95, "h": 36 }`
  - `wartung_fenster`: `{ "x": 318, "top": 766, "w": 110, "h": 40 }` (unsicherster Wert)
- `Fueller.erzeugen` zeichnet beide Unterschriften; fehlt eine, bleibt ihr Feld leer.
- Zusätzlich das Feld `BETREIBER_NAME` als Text unter der Unterschrift, falls das Profil eine
  Koordinate dafür hat (Startwert: `x` wie Unterschrift, `top` + 44, Schriftgröße 7). Optional.

### 4.4 Sammelbericht je Begehung

`sammelbericht_erzeugen(begehung)` — erzeugt ein PDF aus: **Deckblatt** (mit pdf-lib
gezeichnet: Objekt, Adresse, Betreiber, Prüfdatum, Prüfer, Tabelle aller geprüften Bauteile mit
Ergebnis, Summe bestanden und Nachbesserung, Betreiber-Unterschrift und -Name) + die neuesten Einzelberichte in
Laufreihenfolge (pdf-lib `copyPages`). Versioniert wie Einzelberichte. Das ist das Dokument,
das der Betreiber bekommt.

---

### 4.5 Objektseite: zwei Reiter, ein Satz, ein Knopf

Das Objekt ist die Arbeitsfläche für das, was an dieser Liegenschaft steht. Zwei Reiter:

| Reiter | Inhalt |
|---|---|
| **Bestand** | die Türen in Laufreihenfolge mit ihrem Ergebnis — bestanden, nicht bestanden, noch nicht geprüft — dazu Fälligkeit; Filter „nur fällige" |
| **Berichte** | je Termin die PDFs mit allen Versionen, Sammelbericht, ZIP, Stammdaten des Berichts |

Checkliste und Stammdaten stehen **nicht** hier, sondern oben in der Leiste: sie hängen am
Türtyp und gelten über alle Objekte (Abschnitt 1.2). Mängel gibt es nicht als eigene Ebene mehr
— eine Tür hat bestanden oder nicht, und das steht im Bestand.

Darüber ein Satz und genau ein Knopf (Leitsatz 7):

| Zustand | Satz | Knopf |
|---|---|---|
| kein Bestand | „Noch kein Bestand. Die erste erfasste Tür legt ihn an." | Erste Tür erfassen |
| fällige offen | „5 von 9 Türen sind fällig." | Tür erfassen |
| alles erfasst, nicht unterschrieben | „Alles erfasst. Es fehlt die Unterschrift des Betreibers." | Unterschreiben lassen |
| durch | „Alles durch — das Objekt ist bis 07.09.2027 fertig." | *(keiner)* |

Berichte haben keinen Knopf mehr: wer den Reiter öffnet, will sie, also entstehen sie beim
Öffnen. Und „Unterschrift" erscheint erst, wenn es etwas zu unterschreiben gibt — vorher stand
sie als vierter gleichrangiger Knopf daneben, auf einem leeren Objekt.

**Der Termin kommt in der Oberfläche nicht vor** (Leitsatz 8). `GET /objekt/:id/erfassen` löst
über `begehungFuerTag` den heutigen Termin auf — fortsetzen, wenn einer läuft, sonst anlegen.
Alte Adressen unter `/begehung/:id` leiten aufs Objekt.

---

### 4.6 Das Ergebnis folgt den Kreuzen

Der Bestand stellt genau eine Frage, also darf sie nicht doppelt beantwortet werden müssen: eine
Abweichung (`nio`) macht die Prüfung von selbst zu „Nachbesserung", ohne dass jemand `ergebnis`
setzt. Kommen Kreuze mit und ist keines „nicht", ist sie „bestanden" — auch als Korrektur, damit
„Tür 3 doch in Ordnung" zurücknimmt. Ein ausdrücklich gesetztes `ergebnis` sticht beides.

---

## 7. Bauplan-Import

### 7.0 Entscheidung vom 7. September 2026 — der Import läuft über den Agenten

**Diese Entscheidung ersetzt 7.1, 7.5, 7.6 und Anhang A.** Der ursprüngliche Entwurf ließ den
Worker die Anthropic-API aufrufen (Scans als Kacheln, Türlisten als Dokument) und brauchte dafür
das Secret `ANTHROPIC_API_KEY`. Das entfällt: **Türwerk ruft keine KI auf, Türwerk wird von einer
aufgerufen.**

Der Plan liegt ohnehin dort, wo schon ein Modell sitzt — in der Claude-App oder auf dem Desktop.
Also:

1. Der Nutzer hängt Plan oder Türliste in Claude an und sagt: „Importier das nach Türwerk,
   Objekt Kita Heselstücken."
2. Claude liest die Anleitung des Servers (`import_anleitung`, dazu die Seite
   `/anleitung/import` zum Nachlesen für Menschen) und weiß damit, was Türwerk erwartet.
3. Claude **liest den Plan selbst** — Grundriss als Bild, Türliste als Tabelle oder PDF — und
   ruft `bauplan_uebernehmen` mit den Kandidaten: normierte Position, Kennung, Raumnummer, Art,
   Wartungspflicht, Konfidenz, gefundene Beschriftungen.
4. Bestätigt wird **im Gespräch** („nimm alle mit T30-Kennzeichnung") über
   `vorschlaege_annehmen` / `vorschlaege_verwerfen`, oder auf der Planseite im Browser.
5. Das **Rasterbild** des Plans ist optional und unabhängig davon: wer die Karte im Browser will,
   lädt den Plan auf `/objekt/:id/plan` hoch; die Seite rendert ihn mit `pdf.js` im Browser
   (kein Schlüssel, keine Worker-CPU). Ohne Bild funktioniert der Import trotzdem — dann ohne Karte.

Was das bedeutet:

- **Kein `ANTHROPIC_API_KEY`**, kein `src/ki/anthropic.ts`, keine Kosten im Worker, keine
  Kachelung, keine Kostenanzeige vor dem Start.
- Die Tabellen `importe` und `vorschlaege` bleiben wie beschrieben — sie sind der Zwischenstand
  zwischen „Claude hat gelesen" und „ein Mensch hat bestätigt". Leitsatz 6 gilt unverändert:
  **kein Import legt Bauteile ohne Freigabe an.**
- Die Bestätigungsseite (7.8), das Zusammenführen (7.7) und die Laufreihenfolge (7.9) bleiben.
- Die deterministische Geometrieerkennung (7.3/7.4) **entfällt für v2**. Sie bleibt als Idee
  notiert, falls sich die Trefferquote des Agenten bei Vektorplänen als zu schlecht erweist;
  gemessen wird das in der Probe, die Stufe 3 ohnehin vorschaltet.

Die folgenden Abschnitte 7.1 bis 7.6 stehen als Hintergrund weiter da; wo sie der Entscheidung
oben widersprechen, gilt oben.

**Nachtrag: zwei Schritte statt sechs.** Der erste Zuschnitt brauchte `import_starten`,
`vorschlaege_anlegen`, `import_abschliessen` und dazwischen Berichten und Freigeben — sechs
Schritte, von denen vier Buchhaltung waren. Echte Arbeit sind nur zwei: die Datei lesen (das kann
nur der Agent) und die Freigabe (die muss ein Mensch geben). Also:

1. **`bauplan_uebernehmen(objekt, tueren[], geschoss?, art?, dateiname?, import?)`** — legt den
   Import nebenbei an, erkennt Plan gegen Türliste an den Positionen, und antwortet mit einem
   fertigen `bericht` zum Vorlesen sowie `freigabe_moeglichkeiten` (alle / ab 0.85 / nur
   wartungspflichtige) samt Aufruf. Große Pläne: mehrfach rufen und ab dem zweiten Mal die
   `import`-Kennung mitgeben.
2. **`vorschlaege_annehmen(...)`** — die Freigabe. Bleibt danach nichts offen, setzt sie den
   Import selbst auf `bestaetigt`.

**Nachtrag 2: was echte Listen dem Import beigebracht haben.** Eine Türenliste und eine
Fensterliste desselben Hauses genügten, um drei stille Fehler zu zeigen. Der Typname wurde
unscharf gesucht, und „Kunststoff weiß" ging in „Kunststoff weiß DK/F/FF/OL elektr." auf — aus
vier Typen wurden zwei, ohne Meldung. Die Türenliste schrieb „OG", die Fensterliste „1.OG", und
die Etage stand danach doppelt im Objekt, Türen im einen, Fenster im anderen Geschoss. Und
dieselbe Datei ein zweites Mal einzulesen legte alles ein zweites Mal an. Seitdem: der Typname
wird genau verglichen, Geschosse gleicher Höhe fallen zusammen, und eine Kennung, die schon als
offener Vorschlag liegt, kommt nicht noch einmal dazu — der Aufruf darf sich wiederholen.

`import_starten`, `vorschlaege_anlegen` und `import_abschliessen` bleiben als Feinweg bestehen —
für das Zusammenführen von Plan und Liste (7.7) und für Fälle, in denen einzeln gesteuert werden
soll. Der Regelweg sind die zwei Schritte.

### 7.2 Upload und Rasterbild

Seite `/objekt/:id/import`. Der Nutzer wählt Datei und Art (Türliste / Plan) und bei Plänen
das Geschoss (oder legt es neu an).

Bei jedem Plan — egal ob Vektor oder Scan — rendert der Browser Seite 1 mit `pdf.js` (bzw. lädt
das Bild) auf **2400 px Breite** als PNG und lädt es hoch: `POST /api/import/plan` (Multipart:
`geschoss_id`, `original` (die Datei), `raster` (PNG), `breite`, `hoehe`). Der Worker legt
`importe` und setzt `geschosse.plan_*`. Damit gibt es die Anzeige immer, unabhängig von der
Auswertung.

Mehrseitige PDF: Seite auswählbar (Miniaturen); je Seite ein Geschoss.

### 7.7 Zusammenführen (Worker)

Wenn ein Geschoss Vorschläge aus Türliste **und** Plan hat:
1. `kennung` gleich (normalisiert: Groß, ohne Leer-/Bindestrich) → zusammenführen, Position vom
   Plan, Felder von der Liste, Konfidenz 1.0, `herkunft = zusammengefuehrt`.
2. Sonst `raumnummer` gleich und im Raum genau eine Tür je Seite → zusammenführen, Konfidenz 0.8.
3. Rest bleibt getrennt: Listenzeilen ohne Position (werden Bauteile ohne `x/y`), Plan-
   kandidaten ohne Listenzeile (bleiben Vorschlag mit ihrer Konfidenz).

### 7.8 Bestätigen (Browser)

Seite `/objekt/:id/plan/:geschoss`. Rasterbild mit SVG-Überlagerung, Pan/Zoom (Pointer Events,
kein Framework). Je Vorschlag ein Marker: **Farbe nach Konfidenz** (≥ 0.85 grün, ≥ 0.6 gelb,
sonst grau), **Form nach Wartungspflicht** (gefüllt = pflichtig). Bereits angenommene Bauteile
als blaue Marker mit `nr`.

Bedienung:
- Antippen → Kärtchen mit `kennung`, `raumnummer`, `raum`, `art`, `wartungspflichtig`,
  Beschriftungen in der Nähe; Knöpfe **Annehmen** / **Verwerfen** / Felder bearbeiten.
- Ziehen → Position ändern.
- Langes Drücken auf leere Fläche → neuer Vorschlag von Hand (Konfidenz 1.0, `herkunft = manuell`).
- Kopfleiste: „12 offen · 30 angenommen · 4 verworfen", Knopf **„Alle ≥ 0.85 annehmen"**,
  Knopf **„Wartungspflichtige annehmen"**, Filter nach Konfidenz.
- Tastatur (Desktop): `j`/`k` nächster/voriger Vorschlag, `a` annehmen, `x` verwerfen.
- Startpunkt des Rundwegs setzen: Knopf „Startpunkt", dann Antippen → `geschosse.start_x/y`.

Annehmen legt ein `bauteil` an: `nr` = nächste freie im Objekt (oder aus `kennung`, wenn sie
eine reine Zahl ist und frei), `quelle` aus `herkunft`. Der Vorschlag bekommt `bauteil_id`.
Verwerfen ist rücknehmbar, solange der Import nicht auf `bestaetigt` steht.

Ohne Import ist dieselbe Seite die **Verortungsseite**: bestehende Bauteile ohne Position werden
in einer Seitenleiste gelistet und per Ziehen auf den Plan gesetzt.

### 7.9 Laufreihenfolge

Funktion `laufreihenfolge(bauteile, geschosse)`
(gemeinsames Modul, wird in beide gebündelt):

1. Nach `geschoss.reihenfolge` aufsteigend; Bauteile ohne Geschoss zuletzt.
2. Innerhalb eines Geschosses: haben ≥ 70 % der Bauteile eine `raumnummer` →
   **natürliche Sortierung** der Raumnummer (Ziffernblöcke numerisch, `2.14a` nach `2.14`);
   Bauteile ohne Nummer ans Ende, nach `nr`.
3. Sonst, wenn ≥ 70 % eine Position haben → Nächster-Nachbar ab `start_x/y` (fehlt der Start:
   Bauteil mit kleinster `y`, bei Gleichstand kleinster `x`), danach eine 2-opt-Runde
   (max. 200 Tauschversuche). Euklidisch, normierte Koordinaten mit Seitenverhältnis korrigiert.
4. Sonst nach `nr`.

Anzeige im Rundgang: Geschoss-Überschriften, Bauteile in dieser Reihenfolge; auf der Planseite
der Weg als gestrichelte Linie zwischen den Markern.

**Woher das Geschoss kommt.** Stufe 1 stand lange leer: `geschoss_id` setzte nur
`bauteil_anlegen` und der Import, nie das Diktat — also hing auf dem Hauptweg jedes Bauteil an
keinem Geschoss. `geschossZuordnen()` leitet die Etage deshalb beim Erfassen aus dem ab, was
ohnehin gesagt wird, in dieser Reihenfolge:

1. ausdrückliches Argument `geschoss` (`pruefung_erfassen`, `bauteil_anlegen`, …),
2. Formularfeld `ETAGE` oder `GESCHOSS`,
3. `flur`, wenn dort eine Etage steht („1. OG"),
4. die Raumnummer in der Schreibweise Ziffer-Punkt-Ziffer: „1.04" → 1. OG, „0.01" → EG.

`geschossName()` erkennt nur, was eindeutig eine Etage ist — „Flur Nord" bleibt ein Flur — und
normiert auf **eine** Schreibweise (`UG`, `EG`, `1. OG`, `DG`), damit aus „1.OG", „1.
Obergeschoss" und „Etage 1" nicht drei Geschosse werden. Einmal zugeordnet wird nicht mehr
umgehängt: die Etage einer Tür bestimmt der Mensch, nicht eine spätere Raumnummer-Schreibweise.
Es gibt **keine Geschoss-Verwaltungsseite** mehr (Leitsatz 8); Geschosse entstehen, wenn es sie
gibt, und ein Objekt bekommt beim Anlegen keins mehr auf Vorrat.

---

### 7.10 Türenlisten aus der Praxis

Die echten Unterlagen eines Bauvorhabens (Beispiel Liliencronstr. 93: 67 Türen) haben eine feste
Gestalt, und die kennt die Anleitung jetzt beim Namen:

- **Türen- und Fensterlisten** sind breite Excel-Tabellen (dreihundert Spalten sind normal) mit
  ein paar Kopfzeilen, einer Zeile Spaltenüberschriften und dann den Daten. Gebraucht werden
  davon acht: Ebene, Tür-Nummer AG, Raum Nr, Raumbezeichnung, Türtyp, RS/FS, Zulassung, OTS.
- **Wartungspflichtig** ist eine Zeile, wenn in *RS/FS* etwas anderes als ein Strich steht
  (`T30`, `T30 RS`, `RS`, `DS`). Das ist verlässlicher als der Türtyp allein.
- **Der Türtyp entsteht aus Türtyp + RS/FS**: „FS 30 RD" und „T30 RS" ergeben den Türtyp
  `FS 30 RD T30 RS`. Gleiche Schreibweise heißt gleicher Typ. Aus 67 Zeilen werden so 12 Typen,
  jeder mit eigener Checkliste und den Stammdaten seiner ersten Zeile.
- **Das Geschoss steht je Zeile**, nicht am Import: eine Liste umfasst das ganze Haus. Echte
  Listen schreiben oft bloß „OG" statt „1. OG" — deshalb sortiert `reihenfolgeAusName` ein
  nacktes „OG" auf 1 und nicht auf 0 (sonst läge es gleichauf mit dem Erdgeschoss).

**Grundrisse tragen die Türnummern meist als Text.** Bei Plänen aus einem CAD-Programm steht
„IT0.05" in der Textebene des PDFs, mit Koordinaten — exakt, kostenlos und ohne Fehltreffer. Erst
wenn die Textebene leer ist, wird geschätzt. In der Probe fanden sich so 60 von 67 Türnummern,
alle deckungsgleich mit der Liste, kein einziger Fehltreffer.

**Der Plan kommt nach der Liste.** Kennt das Objekt eine Kennung schon, ist das keine neue Tür:
die Position wandert direkt ans vorhandene Bauteil. Leitsatz 6 verlangt eine Freigabe für neue
Bauteile, nicht für die Koordinate einer Tür, die längst freigegeben ist — sonst entstünden bei
jedem Plan Dubletten.

Damit braucht ein ganzes Haus **fünf Aufrufe**: `objekt_einrichten`, zweimal
`bauplan_uebernehmen` für die Liste (Stapel à 34), einmal `vorschlaege_annehmen`, einmal
`bauplan_uebernehmen` für den Plan.

---

## 10. Vorlagen

- v2: die drei eingebauten Profile bekommen `signature_betreiber` (Abschnitt 4.2). Die
  Feld-Labels (`FELD_LABELS` in `seiten.ts`) wandern in `vorlagen/index.ts`, damit Tools und
  Seiten dieselben Beschriftungen nutzen.
- Vorlagen-Editor (Stufe 4, hier nur der Rahmen): Tabelle `vorlagen (id, label, profil_json,
  cheatsheet_md, pdf_schluessel, aktiv)`; leer = eingebaute gelten; Einträge überlagern gleiche
  IDs. Editor: PDF hochladen, Seite rendern, Feld aus Liste wählen, klicken → Koordinate;
  Prüfzeilen: je Zeile einmal klicken (Spalten-x aus dem ersten Klick pro Block übernehmen);
  „Testbericht" mit Beispieldaten rendern. Neuer Türtyp = neue ID.

---

## 11. Sicherheit und Zugriff

- Alle Datenpfade unter `/datei/` weiter nur mit Sitzung. R2 privat.
- `POST /api/sync` und `POST /api/foto` akzeptieren die Sitzung **oder** ein Bearer-Token des
  MCP-OAuth (die Website und der Connector teilen sich eine Anmeldung).
- Uploads: Pläne ≤ 40 MB, Fotos ≤ 8 MB vor Verkleinerung, Türlisten ≤ 10 MB. MIME prüfen.
- `objekt_id` steht an jeder Tabelle; die Zugriffsprüfung `darfObjekt(person, objekt)` ist
  eine Funktion, die in v2 immer `true` liefert und in v3 die Mandantentrennung trägt — **aber
  sie wird jetzt an jeder Stelle aufgerufen**, damit v3 sie nur füllen muss.
- Anthropic-API-Aufrufe protokollieren (Import-ID, Kacheln, Tokens aus `usage`) in
  `importe.ergebnis_json`, damit Kosten sichtbar sind.

---

## 12. Was aus v1 bleibt, was ersetzt wird

**Unverändert:** `src/auth/*` (OAuth, Sitzung, Passwörter), `src/mcp/protokoll.ts`,
`src/pdf/zip.ts`, `src/shared/*`, `src/web/layout.ts`, `src/vorlagen/*.json|md|pdf`,
`scripts/*`, Deployment-Weg, Bindings.

**Erweitert:** `src/pdf/fuellen.ts` (zweite Unterschrift, Deckblatt),
`src/vorlagen/index.ts` (Betreiber-Signatur, Labels, Laufreihenfolge-Helfer als eigenes Modul
`src/reihenfolge.ts`), `wrangler.jsonc` (nichts Neues an Bindings, kein neues Secret —
`ANTHROPIC_API_KEY` ist in `src/env.ts` nur noch optional vermerkt und wird nicht benutzt).

**Ersetzt:** `src/daten/wartungen.ts` → `src/daten/{objekte,bauteile,begehungen,berichte,importe}.ts`;
`src/mcp/werkzeuge.ts` → v2-Tools; `src/web/seiten.ts` → aufgeteilt in
`src/web/{objekte,bauteile,begehungen,einrichten,import,plan}.ts`;
`src/pdf/berichte.ts` → Versionierung; `schema.sql` → v2; `scripts/e2e.sh` → v2-Prüfungen.

**Neu:** `src/import/zusammenfuehren.ts`,
`public/rundgang.js`, `public/plan.js`, `public/import.js`, `public/sw.js` (über `ASSETS`-Binding
oder als Text eingebettet — Entscheidung: **eingebettet** wie v1, kein neues Binding).

---

## 14. Offen — beim Kunden zu klären, blockiert nichts

1. Typische Türzahl je Objekt (entscheidet, wie viel Stufe 3 wert ist).
2. Liegen bei Ausschreibungsobjekten Türlisten vor, und in welchem Format?
3. Wer ist „Betreiber" beim Unterschreiben — Hausmeister, Verwaltung? (Nur für den Text
   unter der Unterschrift.)
4. Prüfintervall je Objekt: immer 12 Monate, oder gibt es 6-Monats-Verträge?
5. Sollen stillgelegte Bauteile im Sammelbericht erscheinen (als „außer Betrieb")? Vorgabe: nein.

---


> Der Worker ruft keine KI mehr auf; der Import läuft über den Agenten in der
> Claude-App. Dieser Anhang bleibt nur als Beleg dafür stehen, was verworfen wurde.

- SDK `@anthropic-ai/sdk`, ein Client je Request (`new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })`).
- Modell **`claude-opus-5`**, `output_config: { effort: "medium" }`, `max_tokens: 8192`
  (Türlisten-PDF: 16000, Streaming nicht nötig).
- **Strukturierte Ausgabe:** `client.messages.parse()` mit JSON-Schema — die genaue Form von
  `output_config.format` und der Parse-Helfer stehen in der Datei
  `typescript/claude-api/tool-use.md` des Skills `claude-api` (Abschnitt „Structured outputs");
  **beim Bauen dort nachlesen, nicht aus dem Gedächtnis schreiben** — die Parameterform hat
  sich 2025/26 geändert (`output_format` ist veraltet). Alternative mit gleicher Wirkung: ein
  Tool mit `strict: true`, `additionalProperties: false`, `required`, und `tool_choice: auto`
  plus Anweisung, es aufzurufen.
- Bild: `{ type: "image", source: { type: "base64", media_type: "image/png", data } }`;
  PDF: `{ type: "document", source: { type: "base64", media_type: "application/pdf", data } }`,
  jeweils **vor** dem Textblock. Base64 ohne Zeilenumbrüche.
- Fehler nach Klassen: `Anthropic.RateLimitError` → einmal nach `retry-after` wiederholen;
  `Anthropic.BadRequestError` → Import mit Warnung abbrechen; sonst `Anthropic.APIError` mit
  Status protokollieren. `stop_reason` prüfen; bei `max_tokens` die Kachel halbieren und
  erneut versuchen.
- `usage.input_tokens`/`output_tokens` je Aufruf in `importe.ergebnis_json` summieren.
- Kein Thinking-Parameter setzen (Opus 5 läuft adaptiv von selbst); kein Prefill.
