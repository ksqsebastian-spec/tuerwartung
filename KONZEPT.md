# Türwerk 2 — Umsetzungsspezifikation

Stand 7. September 2026. Ausgearbeitet von Fable 5.1, gedacht als vollständige Vorgabe für die
Umsetzung. Wo hier eine Entscheidung steht, ist sie getroffen; wo etwas offen ist, steht es
unter „Offen" am Ende. Alles andere ist zu bauen, nicht zu diskutieren.

Diese Datei ist die Wahrheit über Türwerk 2. Der Code in `src/` ist Türwerk 1 und bleibt als
Ausgangspunkt bestehen — was übernommen wird, steht in Abschnitt 13.

---

## 0. Leitsätze

1. **Das Bauteil ist die feste Größe, nicht der Termin.** Eine Tür existiert einmal und trägt
   ihre Geschichte. Eine Begehung ist ein Ereignis, das Prüfungen an Bauteilen erzeugt.
2. **Das Diktat bleibt der Regelweg.** Alles, was Türwerk 1 vor Ort kann, kann Türwerk 2
   genauso — die Sprache des Monteurs ändert sich nicht („Tür 12, Punkt 8 nicht").
3. **Das erste Mal ist die Bestandsaufnahme.** Ein Objekt ohne Bestand wird durch die erste
   Begehung angelegt. Der Bauplan-Import ist ein Beschleuniger, keine Voraussetzung.
4. **Nichts geht still verloren, nichts wird still überschrieben.** Protokolle sind versioniert.
   Mängel bleiben offen, bis jemand sie schließt. Offline Erfasstes kommt an.
5. **KI dort, wo Sprache oder Bilder zu deuten sind — Geometrie und Sortierung sind Rechnung.**
6. **Der Mensch bestätigt den Bestand.** Kein Import legt Bauteile ohne Freigabe an.
7. **Die Website ist nicht die zweite Bedienung.** Die Intelligenz sitzt im Agenten am Diktat;
   die Seiten sind zum Nachsehen und für den einen Griff, der gerade dran ist. Wo eine Seite
   einen Zustand hat, sagt sie ihn in einem Satz und bietet genau einen Knopf an — der Rest
   steht leise darunter. Doppelte Wege zum selben Ziel werden entfernt, nicht ergänzt.

### Nicht-Ziele (v2)

- Kein HERO-Abgleich (kommt in v3; Felder dafür sind vorgesehen, siehe `hero_*`).
- Kein Betreiberportal, keine Mandantentrennung (Felder vorgesehen, Zugriff bleibt „alle vier sehen alles").
- Keine E-Mail-Erinnerungen (Fälligkeit wird angezeigt und per Tool abgefragt; Versand in v3).
- Keine DWG-Verarbeitung (nur PDF und Bilder; DWG vorher wandeln).
- **Kein KI-Aufruf aus dem Worker.** Was zu deuten ist, deutet der Agent, der den Plan
  ohnehin in Händen hält (Abschnitt 7.0).
- Kein eigenes Kartenrouting über Hamburg (Tagestour öffnet die Adressen in Google Maps).

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
  plz              TEXT NOT NULL DEFAULT '',  -- für die Tagestour
  betreiber        TEXT NOT NULL DEFAULT '',  -- Name, wie er aufs Protokoll gehört
  betreiber_kontakt TEXT NOT NULL DEFAULT '', -- Name + Telefon des Ansprechpartners vor Ort
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

-- Mangel: lebt am Bauteil, entsteht aus einer Prüfung, endet durch Freimeldung.
CREATE TABLE maengel (
  id            TEXT PRIMARY KEY,
  objekt_id     TEXT NOT NULL REFERENCES objekte(id),
  bauteil_id    TEXT NOT NULL REFERENCES bauteile(id),
  pruefung_id   TEXT REFERENCES pruefungen(id),  -- Ursprung
  punkte_json   TEXT NOT NULL DEFAULT '[]',      -- ["8","10"] — betroffene Prüfpunkte
  beschreibung  TEXT NOT NULL DEFAULT '',
  prioritaet    TEXT NOT NULL DEFAULT 'mittel',  -- hoch | mittel | niedrig
  frist         TEXT,                            -- YYYY-MM-DD
  zustaendig    TEXT NOT NULL DEFAULT '',        -- „Seehafer" | „Betreiber" | Freitext
  status        TEXT NOT NULL DEFAULT 'offen',   -- offen | in_arbeit | behoben | verworfen
  behoben_am    INTEGER,
  behoben_von   TEXT NOT NULL DEFAULT '',
  freimeldung   TEXT NOT NULL DEFAULT '',        -- Text der Freimeldung
  hero_angebot_id TEXT,                          -- v3
  angelegt_am   INTEGER NOT NULL,
  geaendert_am  INTEGER NOT NULL
);
CREATE INDEX idx_maengel_offen ON maengel (status, frist);
CREATE INDEX idx_maengel_bauteil ON maengel (bauteil_id, status);

-- Foto: hängt am Bauteil, optional an Prüfung und/oder Mangel.
CREATE TABLE fotos (
  id             TEXT PRIMARY KEY,
  objekt_id      TEXT NOT NULL,
  bauteil_id     TEXT NOT NULL REFERENCES bauteile(id),
  pruefung_id    TEXT REFERENCES pruefungen(id),
  mangel_id      TEXT REFERENCES maengel(id),
  r2_schluessel  TEXT NOT NULL,                  -- fotos/<objekt>/<bauteil>/<id>.jpg
  breite         INTEGER NOT NULL,
  hoehe          INTEGER NOT NULL,
  notiz          TEXT NOT NULL DEFAULT '',
  aufgenommen_am INTEGER NOT NULL,
  von            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_fotos_pruefung ON fotos (pruefung_id);

-- Bericht: eine erzeugte PDF-Version. Wird nie gelöscht, nie überschrieben.
CREATE TABLE berichte (
  id            TEXT PRIMARY KEY,
  pruefung_id   TEXT NOT NULL REFERENCES pruefungen(id),
  version       INTEGER NOT NULL,               -- 1, 2, 3 …
  r2_schluessel TEXT NOT NULL,                  -- berichte/<objekt>/<bauteil>/<begehung>/v<version>.pdf
  stand_hash    TEXT NOT NULL,                  -- der Stand, aus dem diese Version entstand
  seiten        INTEGER NOT NULL DEFAULT 1,     -- 1 = nur Formular, >1 = mit Fotoanhang
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

-- Tagestour: welche Objekte an welchem Tag in welcher Reihenfolge.
CREATE TABLE touren (
  id           TEXT PRIMARY KEY,
  datum        TEXT NOT NULL,
  person       TEXT NOT NULL,                   -- Benutzerkennung
  objekte_json TEXT NOT NULL DEFAULT '[]',      -- ["obj_id", …] in Reihenfolge
  notiz        TEXT NOT NULL DEFAULT '',
  angelegt_am  INTEGER NOT NULL,
  geaendert_am INTEGER NOT NULL,
  UNIQUE (datum, person)
);

-- Offline-Abgleich: jede Operation vom Handy trägt eine Client-ID; doppelt eintreffende werden verworfen.
CREATE TABLE sync_ops (
  op_id        TEXT PRIMARY KEY,                -- vom Client erzeugte UUID
  person       TEXT NOT NULL,
  eingegangen_am INTEGER NOT NULL
);
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

## 2. Erfassung

### 2.1 Begehung starten

`begehung_starten(objekt)` — `objekt` darf Name, Adresse oder ID sein; Auflösung per
`LIKE`, bei Mehrdeutigkeit Fehler mit Trefferliste. Existiert das Objekt nicht, wird es
angelegt (mit `art` der ersten Tür als Vorgabe für Folgeteile) — **das ist der Bootstrap-Pfad**
und muss ohne jeden Umweg funktionieren: „Türenwartung Kita Heselstücken, Drehflügel" reicht.

Antwort enthält: Begehungs-ID, Objekt-Stammdaten, Anzahl Bauteile, **Liste der fälligen
Bauteile in Laufreihenfolge** (nr, kennung, raum, Fälligkeit), **offene Mängel** je Bauteil,
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
- **Mangel automatisch**, wenn `ergebnis = Nachbesserung` **oder** mindestens ein Check
  `nio` ist: ein Mangel je Prüfung, `punkte_json` = alle `nio`- und `sb`-Punkte,
  `beschreibung` = `hinweise`, `prioritaet = mittel`, `frist` = Prüfdatum + 4 Wochen,
  `zustaendig = 'Seehafer'`. Existiert schon ein offener Mangel aus derselben Prüfung →
  aktualisieren statt anlegen. Kein Mangel bei nur `sb` ohne `nio` und ohne Nachbesserung.
- Antwort: `gespeichert: "Tür 12"`, `neu_angelegt`, **`offene_maengel_vorjahr`** (Liste, falls
  am Bauteil vor dieser Begehung offene Mängel hängen — Claude soll sie vorlesen: „an dieser Tür
  ist seit 2025 die Dichtung offen — behoben?"), `naechste_nr`.

`pruefungen_erfassen(begehung, pruefungen[])` — Stapel, Reihenfolge zählt, `wie_davor` bezieht
sich auf die vorige Zeile des Stapels bzw. die letzte gespeicherte Prüfung.

### 2.3 Mängel im Diktat

`mangel_schliessen(bauteil|mangel, freimeldung?)` — „Dichtung ist getauscht" → Status
`behoben`, `behoben_am`, `behoben_von`. Das Tool nimmt `bauteil` (Objekt + nr) und schließt
dann **alle** offenen Mängel des Bauteils, oder eine `mangel`-ID gezielt.

### 2.4 Begehung abschließen

`begehung_abschliessen(begehung)` → Status `abgeschlossen`, Antwort ist der Rückblick:
je Prüfung Ort, Abweichungen im Klartext, Ergebnis; Summe; **Liste der fälligen, aber nicht
geprüften Bauteile** („3 Türen im 2. OG fehlen noch — absichtlich?"). Abschließen ist
jederzeit rücknehmbar (`begehung_aendern status=laufend`).

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
  (rot überfällig, gelb ≤ 30 Tage, grün), daneben Anzahl offener Mängel.
- **Tool `faellig(tage=30)`**: Objekte mit Fälligkeit ≤ heute + tage, mit Anzahl fälliger
  Bauteile — damit „was ist diese Woche dran?" im Chat funktioniert.
- **Objektseite**: Bauteile mit letzter Prüfung und Fälligkeit; Filter „nur fällige".
- **Checkliste `/begehung/:id/checkliste`**: der Blick fürs Diktat, siehe Abschnitt 4.6.

Ein Bauteil, das in einer Begehung geprüft wurde, ist ab dann für `intervall` Monate nicht
fällig. Ein Objekt gilt als „fertig für dieses Jahr", wenn kein Bauteil fällig ist.

---

## 4. Berichte

### 4.1 Versionierung

- `stand_hash` = SHA-256 über die kanonische JSON-Serialisierung von
  `{ objekt: {name, adresse, betreiber, ident, rechtsgrundlagen}, begehung: {datum, pruefer,
  befaehigung, ort, beteiligte, betreiber_name, unterschrieben_am}, bauteil: {nr, kennung, art,
  raum, raumnummer, flur, felder}, pruefung: {checks, ergebnis, hinweise}, fotos: [ids],
  unterschrift_pruefer: r2_schluessel }` — Schlüssel sortiert, keine Zeitstempel außer
  `unterschrieben_am`.
- `berichte_erzeugen` erzeugt für jede Prüfung, deren `stand_hash` **nicht** dem Hash der
  neuesten Berichtsversion entspricht, eine **neue Version** `max(version)+1`. Bestehende
  Versionen werden nie angefasst. Ein Bericht, der schon beim Kunden liegt, bleibt genau so.
- Anzeige: Berichte-Liste zeigt die neueste Version, ein Aufklapper zeigt ältere. ZIP enthält
  die neuesten Versionen.
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

### 4.3 Fotoanhang

Hat eine Prüfung Fotos, hängt `Fueller.erzeugen` nach der Formularseite **eine Anhangseite je
zwei Fotos** an (A4, pdf-lib `addPage`): Kopfzeile „Fotoanhang — Tür 12, Objekt, Datum",
je Foto max. 160×120 mm mit Notiz und Zeitstempel darunter. Fotos werden vor dem Einbetten
auf max. 1200 px Kante verkleinert (das passiert schon beim Hochladen, Abschnitt 6).

### 4.4 Sammelbericht je Begehung

`sammelbericht_erzeugen(begehung)` — erzeugt ein PDF aus: **Deckblatt** (mit pdf-lib
gezeichnet: Objekt, Adresse, Betreiber, Prüfdatum, Prüfer, Tabelle aller geprüften Bauteile mit
Ergebnis, Summe Mängel, Betreiber-Unterschrift und -Name) + die neuesten Einzelberichte in
Laufreihenfolge (pdf-lib `copyPages`). Versioniert wie Einzelberichte. Das ist das Dokument,
das der Betreiber bekommt.

---

### 4.5 Begehungsseite: ein Satz, ein Knopf

Eine Begehung hat zu jedem Zeitpunkt genau einen nächsten Schritt. Also steht oben ein Satz, der
sagt wo man ist, und darunter ein Knopf, der weiterführt (Leitsatz 7):

| Zustand | Satz | Knopf |
|---|---|---|
| Objekt ohne Bestand | „… diese Begehung ist die Bestandsaufnahme." | Erste Tür erfassen |
| fällige Bauteile offen | „3 von 9 erfasst — 6 fällige Türen fehlen noch." | Checkliste öffnen |
| alles erfasst | „Alle 9 fälligen Bauteile sind erfasst." | Begehung abschließen |
| abgeschlossen, Berichte offen | „Abgeschlossen. 9 Berichte stehen aus." | Berichte erzeugen |
| Berichte da, kein Sammelbericht | „9 Berichte erzeugt." | Sammelbericht erzeugen |
| fertig | „Fertig: 9 Berichte, Sammelbericht v1." | Alles als ZIP |

Was gerade nicht dran ist, bleibt erreichbar, aber leise: Rundgang, Unterschrift, Neuerzeugen,
ZIP, Wieder öffnen, Abbrechen. Keine Kennzahlenleiste — was sie sagen würde, sagt der Satz, und
darunter steht die Liste der Prüfungen selbst. Solange nichts erfasst ist, fällt der Abschnitt
„Prüfungen" ganz weg; die Stammdaten liegen zugeklappt am Fuß.

---

### 4.6 Checkliste fürs Diktat

Eine Hand hält das Telefon, die andere die Tür. `/begehung/:id/checkliste` ist ein **Reiter der
Begehungsseite** und schreibt nichts — sie zeigt, wo man gerade ist, während Claude über den
Connector mitschreibt:

- Fortschritt „7 von 19 geprüft" mit Balken,
- **die nächste ungeprüfte Tür groß** („JETZT DRAN — Tür 5, 2.05 · Treppenhaus"),
- darunter zwei Unterreiter: **Türen** (alle Bauteile in Laufreihenfolge zum Abhaken; Haken =
  geprüft, rote Zahl = so viele Abweichungen; Antippen öffnet das Prüfraster) und **Punkte**
  (die Prüfpunkte der vorkommenden Vorlagen groß, zum verbalen Abgehen).
- Sie frischt sich alle zehn Sekunden über `GET /begehung/:id/stand.json` auf, ohne Neuladen —
  ein diktiertes „Tür 7 fertig" erscheint von selbst als Haken. Reiter und Scrollstand bleiben.

Abgrenzung zum Rundgang (Abschnitt 5): die Checkliste ist zum **Zuschauen beim Diktieren** da
und braucht Netz; der Rundgang ist zum **Selbertippen**, auch ohne Netz.

---

## 5. Rundgang am Handy (offline)

### 5.1 Was es ist

`/rundgang/:begehung` — **eine** Seite, die ohne Netz funktioniert. Kein Framework; ein
Service Worker cached die Seite selbst, IndexedDB hält die Daten. Der Rest der Website bleibt
serverseitig gerendert und braucht Netz.

### 5.2 Ablauf

1. Beim Öffnen (mit Netz): `GET /api/rundgang/:begehung` liefert JSON: Begehung, Objekt,
   Vorlagen-Punkte je Art, alle Bauteile (aktiv, wartungspflichtig) in **Laufreihenfolge**
   (Abschnitt 7.9), je Bauteil: letzte Prüfung (Datum, Ergebnis, Checks), offene Mängel, und
   die in dieser Begehung schon erfassten Prüfungen. Wird in IndexedDB gespeichert.
2. Oberfläche: Liste in Laufreihenfolge, oben die nächste ungeprüfte Tür groß. Antippen öffnet
   das Prüfraster (wie `tuerSeite` in v1: Felder, Punkte mit i.O./nicht/entf./Bem., Ergebnis,
   Hinweise) plus **Kamera-Knopf** und **„unbekannte Tür"-Knopf** (legt Bauteil mit nächster
   freier `nr` an, `quelle = rundgang`).
3. Jede Speicherung schreibt eine Operation in die lokale Warteschlange:
   `{ op_id: uuid, art: 'pruefung'|'bauteil_neu'|'foto'|'mangel_schliessen', payload, ts }`.
4. Ein Abgleich-Lauf (bei `online`-Ereignis, beim Öffnen, alle 30 s solange die Seite offen
   ist) sendet die Warteschlange gebündelt an `POST /api/sync` und entfernt bestätigte
   Operationen. Fotos werden **einzeln** als Multipart nachgeschoben, nach ihrer Prüfung.
5. Anzeige des Abgleichstands oben: „3 Änderungen warten" / „alles übertragen".

### 5.3 Abgleichregeln (Server, `POST /api/sync`)

- Body: `{ ops: [...] }`. Jede `op_id` wird in `sync_ops` eingetragen; **bereits bekannte
  `op_id` → 200, keine Wirkung** (Wiederholung ist harmlos).
- `pruefung`: Upsert nach (begehung, bauteil). Existiert eine Prüfung mit **jüngerem**
  `geprueft_am` → eingehende verwerfen (Antwort `konflikt: "aelter"`). Sonst schreiben.
- `bauteil_neu`: `nr` vom Client vorgeschlagen; ist sie inzwischen belegt → Server vergibt die
  nächste freie und antwortet mit Zuordnung `{ client_nr, server_nr }`; der Client schreibt
  die Zuordnung in seine wartenden Operationen um.
- `foto`: Multipart `POST /api/foto` mit `op_id`, `bauteil_id`, `pruefung`-Referenz als
  (begehung, bauteil_nr), Bild. Idempotent über `op_id`.
- Stammdaten (Objekt, Bauteilfelder außer den in der Prüfung mitgegebenen): **Server gewinnt.**
- Antwort je Operation: `{ op_id, ok, konflikt?, zuordnung? }`.

### 5.4 Service Worker

Cache-first für `/rundgang/*` (Shell), `/icon.svg`, das Vorlagen-JSON. Network-only für
`/api/*`. Versionierter Cache-Name; bei neuem Deployment alter Cache verworfen. Keine
Push-Benachrichtigungen.

---

## 6. Fotos

- Aufnahme im Rundgang oder auf der Bauteil-/Prüfungsseite: `<input type=file accept=image/*
  capture=environment>`.
- **Verkleinerung im Browser** vor dem Upload (Canvas): längste Kante 1600 px, JPEG-Qualität
  0.82. Ziel ≤ 400 KB. EXIF-Rotation beachten (`createImageBitmap` mit
  `imageOrientation: 'from-image'`).
- `POST /api/foto` (Multipart: `bild`, `bauteil_id`, `begehung_id?`, `mangel_id?`, `notiz?`,
  `op_id`) → R2 `fotos/<objekt>/<bauteil>/<id>.jpg`, Zeile in `fotos`. Antwort: Foto-ID.
- Anzeige: Bauteilseite (Galerie über alle Jahre), Prüfungsseite, Mangelseite. Auslieferung über
  `/datei/fotos/…` (Präfix in `datei()` freigeben).
- Löschen nur durch den Aufnehmenden oder `rolle = buero`, nur solange kein Bericht das Foto
  enthält (Hash-Vergleich); danach nur „ausblenden" (Flag `aktiv`, in Berichten bleibt es).

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
   ruft `vorschlaege_anlegen` mit den Kandidaten: normierte Position, Kennung, Raumnummer, Art,
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

### 7.1 Grundsatz (überholt, siehe 7.0)

Alles Schwere läuft **im Browser**, nicht im Worker: PDF rendern, Vektoren lesen, Bilder
kacheln. Der Worker speichert, ruft für Tabellen und Scans die Anthropic-API auf, führt
zusammen und legt Vorschläge an. Grund: Worker-CPU-Zeit ist knapp, `pdf.js` braucht Canvas.

Bibliotheken (per `<script>` von cdnjs, feste Version): `pdfjs-dist` 4.x (Rendern + Operator-
Liste + Text), `xlsx` (SheetJS) für XLSX/CSV. Beide nur auf der Import-Seite geladen.

### 7.2 Upload und Rasterbild

Seite `/objekt/:id/import`. Der Nutzer wählt Datei und Art (Türliste / Plan) und bei Plänen
das Geschoss (oder legt es neu an).

Bei jedem Plan — egal ob Vektor oder Scan — rendert der Browser Seite 1 mit `pdf.js` (bzw. lädt
das Bild) auf **2400 px Breite** als PNG und lädt es hoch: `POST /api/import/plan` (Multipart:
`geschoss_id`, `original` (die Datei), `raster` (PNG), `breite`, `hoehe`). Der Worker legt
`importe` und setzt `geschosse.plan_*`. Damit gibt es die Anzeige immer, unabhängig von der
Auswertung.

Mehrseitige PDF: Seite auswählbar (Miniaturen); je Seite ein Geschoss.

### 7.3 Vektorplan → Kandidaten (zurückgestellt, siehe 7.0)

Aus `page.getOperatorList()` (pdf.js) werden alle Pfade in Seitenkoordinaten gesammelt. Dabei
den Transformationsstapel (`save`/`restore`/`transform`) mitführen. **Achtung:** die Kodierung
der Pfadsegmente in `constructPath` hat sich zwischen pdf.js-Versionen geändert — beim Bauen die
Struktur der eingesetzten Version prüfen und die Segmente in eine eigene Form bringen:
`{ typ: 'line'|'cubic', punkte: [...] }`, alles in Seitenpunkten, y nach unten (Flip).

**Bogen-Erkennung** — zwei Wege, beide zu implementieren:

a) *Echte Kurven.* Ein kubischer Bézier mit Kontrollpunkten P0,P1,P2,P3 ist ein Viertelkreis,
   wenn |P1−P0| ≈ |P2−P3| ≈ 0.5523·|P0−P3|/√2 und der Winkel P0→P3 um den gemeinsamen
   Mittelpunkt ≈ 90° (Toleranz ±12°). Mittelpunkt: Schnitt der Normalen in P0 und P3.

b) *Polylinien.* Folgen von ≥ 6 kurzen Segmenten mit gleichem Drehsinn und Gesamtdrehung
   80°–100°, Segmentlängen nahezu gleich (Variationskoeffizient < 0.35). Kreis per
   Kleinste-Quadrate anpassen (Kåsa-Fit); Residuum < 0.04·r annehmen.

Ergebnis je Bogen: Mittelpunkt `c`, Radius `r`, Startpunkt `a`, Endpunkt `b`.

**Blatt-Erkennung:** eine Linie mit einem Endpunkt innerhalb 0.08·r von `c` und Länge in
[0.85·r, 1.15·r], deren anderer Endpunkt innerhalb 0.15·r von `a` oder `b` liegt.
Bogen + Blatt = **Tür**, Konfidenz 0.9. Bogen ohne Blatt = Konfidenz 0.6. Blatt ohne Bogen
wird nicht gezählt.

**Zwei Flügel:** zwei Türen, deren Mittelpunkte 1.8·r–2.3·r auseinanderliegen, deren Bögen
einander zugewandt sind und deren Blätter parallel stehen → eine Tür, `breite_m` verdoppelt,
Position = Mitte zwischen den Mittelpunkten.

**Maßstab:** `einheiten_je_meter` = Median aller r ÷ 0.9 (Annahme: typische lichte Breite
0.885–1.0 m). Kandidaten mit r außerhalb [0.55 m, 1.6 m] verwerfen (Möbel, Sanitär,
Tore separat zulassen bis 2.5 m, Konfidenz −0.2). Wird ein Maßstabsbalken oder „1:100" im Text
gefunden, ist das die bessere Quelle und überschreibt die Schätzung.

**Text zuordnen:** `page.getTextContent()` liefert Beschriftungen mit Position. Jedem
Kandidaten die Beschriftungen innerhalb 3·r zuordnen (`text_nahe_json`). Daraus:
- `raumnummer` = erste Beschriftung, die `/^\d{1,2}[.\-]?\d{2,3}[a-z]?$/` oder
  `/^[A-Z]?\d\.\d{2,3}$/` matcht;
- `kennung` = Beschriftung mit `/^T[-\s.]?\d/i` oder `/^Tür\s*\d/i`;
- `wartungspflichtig = 1` und `felder.ZULASSUNG` = Treffer, wenn eine Beschriftung
  `/\b(T|EI|E)\s?(30|60|90|120)\b|\bRS\b|\bFSA\b|\bRWA\b/` matcht — das ist der Fall
  **Brandschutzplan**, die eigentlich richtige Planquelle.

Ausgabe: Kandidatenliste mit normierten Koordinaten `x = (cx − x0)/breite`, `y` analog, bezogen
auf dieselbe Seitenbox wie das Rasterbild. `POST /api/import/:id/kandidaten` → `vorschlaege`.

### 7.4 DXF → Kandidaten (zurückgestellt, siehe 7.0)

DXF ist Text. Nur die Entitäten `ARC` (Mittelpunkt, Radius, Start-/Endwinkel), `LINE`,
`LWPOLYLINE`, `TEXT`/`MTEXT`, `INSERT` (Blöcke: Blockdefinitionen mit Türsymbolen sind der
Normalfall — jedes `INSERT` eines Blocks, der einen ARC von ~90° enthält, ist ein Kandidat,
Position = Einfügepunkt, Rotation = Einfügewinkel). Layer-Namen mit `TUER|TÜR|DOOR|A_DOOR`
heben die Konfidenz auf 0.95. Rasterbild: Bounding Box aller Entitäten auf 2400 px zeichnen
(Canvas, nur Linien/Bögen/Text) — reicht als Hintergrund.

### 7.5 Scan → Kandidaten (überholt, siehe 7.0 — das liest jetzt der Agent)

Nur wenn das PDF keine Vektorpfade enthält oder eine Bilddatei hochgeladen wird.

- Der Browser kachelt das Rasterbild in Kacheln von höchstens **1400 × 1400 px** mit 100 px
  Überlappung und lädt sie hoch. Der Worker ruft **je Kachel** die API auf:
  - Modell `claude-opus-5`, `output_config: { effort: "medium" }`, `max_tokens: 4096`.
  - Inhalt: Bild (base64, `image/png`) + Text: „Dies ist ein Ausschnitt eines Gebäudegrundrisses.
    Finde alle Türsymbole (Viertelkreisbogen mit Türblatt). Gib für jede Tür die Position des
    Drehpunkts als Anteil der Bildbreite/-höhe (0..1), die geschätzte Breite in Pixeln, die
    Beschriftungen im Umkreis, und ob eine Brandschutzkennzeichnung (T30, T90, RS, EI30 …)
    erkennbar ist. Kein Möbel, keine Fenster."
  - Strukturierte Ausgabe über `output_config.format` mit JSON-Schema
    `{ tueren: [{ x, y, breite_px, doppelfluegel, beschriftungen: string[], kennzeichnung: string|null, sicherheit: number }] }`.
  - Kacheln parallel, höchstens 4 gleichzeitig. Kandidaten in Seitenkoordinaten
    zurückrechnen; Duplikate im Überlappungsbereich (Abstand < 0.02 normiert) zusammenführen.
  - Konfidenz = `0.4 · sicherheit`, nie über 0.5.
- Kosten: ein A3-Plan bei 2400 px sind ~4–6 Kacheln, je Kachel wenige Cent. Anzeigen, bevor
  gestartet wird.
- Secret `ANTHROPIC_API_KEY` als Worker-Secret. SDK `@anthropic-ai/sdk` (läuft unter
  `nodejs_compat`). Fehlerbehandlung nach Klassen (`RateLimitError` → Wiederholung nach
  `retry-after`, sonst Import auf `status = 'ausgewertet'` mit Warnung).

### 7.6 Türliste → Kandidaten (überholt, siehe 7.0 — das liest jetzt der Agent)

- XLSX/CSV: SheetJS im Browser → JSON-Zeilen (erste Zeile als Kopf) → `POST /api/import/:id/tabelle`.
- PDF-Tabelle: Datei als `document`-Block (base64, `application/pdf`) an die API, Modell
  `claude-opus-5`, `effort: "medium"`, strukturierte Ausgabe mit Schema
  `{ zeilen: [{ nr, kennung, geschoss, raumnummer, raum, art, feuerwiderstand, breite_mm, hersteller, bemerkung }] }`
  und der Anweisung, nur Türen zu liefern, die in der Tabelle stehen, nichts zu erfinden, und
  unklare Zellen leer zu lassen. Bei > 60 Seiten Zeilen seitenweise abrufen.
- **Spaltenzuordnung** bei XLSX: der Worker schickt die Kopfzeile + 5 Beispielzeilen an die API
  mit Schema `{ zuordnung: { nr, kennung, geschoss, raumnummer, raum, art, feuerwiderstand, breite_mm, hersteller }: spaltenname|null }`,
  zeigt die Zuordnung an, der Nutzer korrigiert per Auswahlfelder, dann werden alle Zeilen
  lokal umgesetzt. Kein API-Aufruf je Zeile.
- Je Zeile ein Vorschlag: `herkunft = tuerliste`, Konfidenz 1.0, `x/y = NULL`,
  `wartungspflichtig = 1` wenn `feuerwiderstand` nicht leer oder `art` Feststellanlage,
  `art` aus Stichworten (`Fenster` → `wartung_fenster`; `FSA|Feststell|Haftmagnet` →
  `wartung_feststellanlagen`; sonst `wartung_drehfluegel`).

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
- Rundgang-Start setzen: Knopf „Startpunkt", dann Antippen → `geschosse.start_x/y`.

Annehmen legt ein `bauteil` an: `nr` = nächste freie im Objekt (oder aus `kennung`, wenn sie
eine reine Zahl ist und frei), `quelle` aus `herkunft`. Der Vorschlag bekommt `bauteil_id`.
Verwerfen ist rücknehmbar, solange der Import nicht auf `bestaetigt` steht.

Ohne Import ist dieselbe Seite die **Verortungsseite**: bestehende Bauteile ohne Position werden
in einer Seitenleiste gelistet und per Ziehen auf den Plan gesetzt.

### 7.9 Laufreihenfolge

Funktion `laufreihenfolge(bauteile, geschosse)`, in Worker und Rundgang-Client identisch
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

---

## 8. Tagestour

- Seite `/touren`: Woche als sieben Spalten, je Tag die Objekte der Person. Rechts eine Liste
  „fällig in 30 Tagen" (aus Abschnitt 3), sortiert nach Fälligkeit, dann PLZ. Ziehen in einen
  Tag; innerhalb des Tags sortierbar.
- **„Route öffnen"** je Tag: baut `https://www.google.com/maps/dir/<adr1>/<adr2>/…` (URL-
  kodiert, Startpunkt = erste Adresse) und öffnet sie — das Handy übernimmt die Navigation.
- Tool `tour_planen(datum, objekte[])` und `tour_lesen(datum)` für „was fahre ich morgen?".
- Ein Objekt in einer Tour, für das noch keine Begehung an dem Tag existiert, bekommt beim
  Öffnen im Rundgang automatisch eine (Status `geplant` → `laufend` beim ersten Speichern).

---

## 9. MCP-Tools v2

Namen deutsch, `readOnlyHint` gesetzt wie in v1. Alle Argumente optional außer den mit `*`.
`objekt` und `bauteil` dürfen als ID, Name/Adresse (LIKE) bzw. `nr`/`kennung` angegeben werden.

**Lesend**

| Tool | Argumente | Liefert |
|---|---|---|
| `objekte_auflisten` | suche, nur_faellige, limit | Objekte mit Fälligkeit, Bauteilzahl, offenen Mängeln |
| `objekt_lesen` | objekt* | Stammdaten, Geschosse, Bauteile in Laufreihenfolge mit letzter Prüfung/Fälligkeit, offene Mängel, letzte Begehungen |
| `bauteil_lesen` | objekt*, nr/kennung* | Bauteil, alle Prüfungen (Historie), Mängel, Fotos, Berichte |
| `faellig` | tage=30 | Objekte mit fälligen Bauteilen (Anzahl, frühestes Datum) |
| `begehung_lesen` | begehung* | Begehung, Prüfungen mit Klartext-Abweichungen, fehlende fällige Bauteile |
| `maengel_auflisten` | objekt, status=offen, faellig_bis | Mängel mit Bauteil, Frist, Zuständigkeit |
| `berichte_auflisten` | begehung* | neueste Versionen + ZIP-Link + Sammelbericht-Link |
| `pruefpunkte` | vorlage* | wie v1 |
| `vorlagen_auflisten` | — | wie v1 |
| `vorgaben_lesen` | — | wie v1 |
| `tour_lesen` | datum=heute, person=ich | Objekte in Reihenfolge, Adressen, Maps-Link |
| `import_anleitung` | — | die Anleitung für den Agenten (Abschnitt 7.0) |
| `importe_auflisten` | objekt* | Pläne und Türlisten dieses Objekts mit Zahlen |
| `vorschlaege_lesen` | import\|objekt*, status, limit | Kandidaten eines Imports |

**Schreibend**

| Tool | Argumente | Wirkung |
|---|---|---|
| `objekt_anlegen` | name*, adresse, plz, betreiber, betreiber_kontakt, ident, intervall_monate, rechtsgrundlagen | legt Objekt + Hauptgebäude + Geschoss „EG" an |
| `objekt_aendern` | objekt*, Felder | nur genannte Felder |
| `bauteil_anlegen` | objekt*, art*, nr, kennung, geschoss, raumnummer, raum, flur, felder, wartungspflichtig | einzelnes Bauteil ohne Import |
| `bauteile_anlegen` | objekt*, bauteile[]*, art, geschoss | Stapel bis 200; belegte Nummern werden übersprungen, nie überschrieben |
| `bauteil_aendern` | objekt*, nr*, Felder, aktiv | Stammdaten fortschreiben, stilllegen |
| `begehung_starten` | objekt*, datum, pruefer, befaehigung, ort, beteiligte, art_vorgabe | Abschnitt 2.1 — legt fehlendes Objekt an |
| `begehung_aendern` | begehung*, Felder, status | Stammdaten, Status |
| `pruefung_erfassen` | begehung*, nr, kennung, art, checks, ergebnis, hinweise, felder, wie_davor, neu | Abschnitt 2.2 |
| `pruefungen_erfassen` | begehung*, pruefungen[]* | Stapel |
| `mangel_anlegen` | objekt*, nr*, beschreibung*, punkte, prioritaet, frist, zustaendig | Mangel außerhalb einer Prüfung |
| `mangel_aendern` | mangel*, Felder | Frist, Zuständigkeit, Priorität, Status |
| `mangel_schliessen` | objekt+nr oder mangel*, freimeldung | Abschnitt 2.3 |
| `begehung_abschliessen` | begehung* | Abschnitt 2.4 |
| `begehung_abbrechen` | begehung* | Abschnitt 2.5 — leer: gelöscht, sonst `abgebrochen` |
| `berichte_erzeugen` | begehung*, alle_neu | versioniert, stückweise wie v1 (`fertig: false` → erneut) |
| `sammelbericht_erzeugen` | begehung* | Abschnitt 4.4 |
| `tour_planen` | datum*, objekte[]*, person | Tagestour setzen |
| `geschoss_anlegen` | objekt*, name*, reihenfolge | Geschoss, Reihenfolge aus dem Namen |
| `import_starten` | objekt*, art*, dateiname, geschoss | Abschnitt 7.0 |
| `vorschlaege_anlegen` | import*, kandidaten[]* | was der Agent gefunden hat |
| `vorschlaege_annehmen` | import*, ids\|ab_konfidenz\|nur_wartungspflichtige\|alle | die Freigabe — hier entstehen Bauteile |
| `vorschlaege_verwerfen` | import*, ids\|unter_konfidenz | rücknehmbar bis zum Abschluss |
| `import_zusammenfuehren` | tuerliste*, plan* | Abschnitt 7.7 |
| `import_abschliessen` | import* | Status `bestaetigt` |
| `vorgaben_speichern` | wie v1 | |

`ANLEITUNG` (Server-Instructions) wird angepasst: Objekt statt Wartung, `pruefung_erfassen`
statt `tuer_erfassen`, der Hinweis auf offene Vorjahresmängel („vorlesen, nachfragen, bei
Bestätigung `mangel_schliessen`"), und der Bootstrap-Satz: „Kennt der Server das Objekt nicht,
legt `begehung_starten` es an — die erste Begehung ist die Bestandsaufnahme."

**Skill v3** (`skill/tuerwerk-diktat/SKILL.md`): dieselben Änderungen in der Diktat-Sprache.
Neu: „Tür 12" meint das Bauteil Nr. 12 des Objekts, nicht die zwölfte Tür des Tages. Bei
unbekannter Nummer sagt Claude „Tür 12 ist neu — lege ich an" und macht weiter.

---

## 10. Web-Routen v2

Alle mit Sitzung, außer den in v1 öffentlichen (OAuth, `/tools.json`, `/anmeldung`, Icons).

| Route | Inhalt |
|---|---|
| `GET /` → `/objekte` | |
| `GET /objekte` | Liste nach Fälligkeit, Suche, „Neues Objekt" |
| `POST /objekte` | anlegen |
| `GET /objekt/:id` | Kopf mit Fälligkeit; Bauteile in Laufreihenfolge mit letzter Prüfung; offene Mängel; Begehungen; Knöpfe „Begehung starten", „Import", „Plan" |
| `POST /objekt/:id` | Stammdaten |
| `POST /objekt/:id/loeschen` | Ausnahmeweg für Fehlanlagen und Testläufe: Objekt mit allem, was daran hängt. Im Alltag wird stillgelegt (`aktiv = 0`). |
| `GET/POST /objekt/:id/bauteil/neu`, `/objekt/:id/bauteil/:nr` | Bauteil mit Historie (Prüfungen, Mängel, Fotos, Berichte aller Versionen) |
| `GET /objekt/:id/import`, `POST /api/import/*` | Abschnitt 7.0, 7.2, 7.7 |
| `GET /anleitung/import` | die Anleitung für den Agenten, zum Nachlesen (Abschnitt 7.0) |
| `GET /objekt/:id/plan/:geschoss`, `GET …/daten.json` | Abschnitt 7.8 — Karte mit Markern |
| `POST /api/plan`, `POST /api/vorschlag/:id`, `POST /api/geschoss/:id/start` | Planbild, Freigabe, Startpunkt |
| `GET/POST /objekt/:id/geschosse` | Geschosse anlegen, umbenennen, Reihenfolge |
| `POST /objekt/:id/begehung` | starten → `/begehung/:id` |
| `GET /begehung/:id` | Reiter „Begehung“; ein Satz, ein Knopf (Abschnitt 4.5), darunter die Prüfungen, fehlende Bauteile, Berichte (Versionen), Sammelbericht; leise: ZIP, Unterschrift, „Im Rundgang öffnen“, Abbrechen |
| `GET /begehung/:id/checkliste`, `GET /begehung/:id/stand.json` | Abschnitt 4.6 |
| `POST /begehung/:id/abschliessen`, `POST /begehung/:id/oeffnen` | Abschnitt 2.4 |
| `POST /begehung/:id/abbrechen` | Abschnitt 2.5 |
| `GET/POST /begehung/:id/pruefung/:nr` | Prüfraster wie v1 `tuerSeite` + Fotos |
| `GET/POST /begehung/:id/unterschrift` | Abschnitt 4.2 |
| `POST /begehung/:id/erzeugen`, `/sammelbericht` | JSON, stückweise |
| `GET /begehung/:id/paket.zip` | neueste Versionen |
| `GET /rundgang/:begehung`, `GET /api/rundgang/:begehung`, `POST /api/sync`, `POST /api/foto` | Abschnitt 5 und 6 |
| `GET /maengel` | alle offenen, Filter Objekt/Frist/Zuständigkeit; Zeile → Bauteil |
| `GET/POST /mangel/:id` | bearbeiten, schließen |
| `GET/POST /touren` | Abschnitt 8 |
| `GET /einstellungen` | wie v1 (Vorgaben, Unterschrift Prüfer) |
| `GET /verbinden` | wie v1 |
| `GET /datei/(berichte\|fotos\|plaene\|unterschriften)/…` | Auslieferung |

Gestaltung wie v1 (`layout.ts`, `BASE_CSS`), keine neue Sprache; Planseite und Rundgang sind
die beiden Seiten mit eigenem Skript.

---

## 11. Vorlagen

- v2: die drei eingebauten Profile bekommen `signature_betreiber` (Abschnitt 4.2). Die
  Feld-Labels (`FELD_LABELS` in `seiten.ts`) wandern in `vorlagen/index.ts`, damit Tools und
  Seiten dieselben Beschriftungen nutzen.
- Vorlagen-Editor (Stufe 4, hier nur der Rahmen): Tabelle `vorlagen (id, label, profil_json,
  cheatsheet_md, pdf_schluessel, aktiv)`; leer = eingebaute gelten; Einträge überlagern gleiche
  IDs. Editor: PDF hochladen, Seite rendern, Feld aus Liste wählen, klicken → Koordinate;
  Prüfzeilen: je Zeile einmal klicken (Spalten-x aus dem ersten Klick pro Block übernehmen);
  „Testbericht" mit Beispieldaten rendern. Neuer Türtyp = neue ID.

---

## 12. Sicherheit und Zugriff

- Alle Datenpfade unter `/datei/` weiter nur mit Sitzung. R2 privat.
- `POST /api/sync` und `POST /api/foto` akzeptieren die Sitzung **oder** ein Bearer-Token des
  MCP-OAuth (damit der Rundgang-Client nicht zwei Anmeldungen braucht — er nutzt die Sitzung).
- Uploads: Pläne ≤ 40 MB, Fotos ≤ 8 MB vor Verkleinerung, Türlisten ≤ 10 MB. MIME prüfen.
- `objekt_id` steht an jeder Tabelle; die Zugriffsprüfung `darfObjekt(person, objekt)` ist
  eine Funktion, die in v2 immer `true` liefert und in v3 die Mandantentrennung trägt — **aber
  sie wird jetzt an jeder Stelle aufgerufen**, damit v3 sie nur füllen muss.
- Anthropic-API-Aufrufe protokollieren (Import-ID, Kacheln, Tokens aus `usage`) in
  `importe.ergebnis_json`, damit Kosten sichtbar sind.

---

## 13. Was aus v1 bleibt, was ersetzt wird

**Unverändert:** `src/auth/*` (OAuth, Sitzung, Passwörter), `src/mcp/protokoll.ts`,
`src/pdf/zip.ts`, `src/shared/*`, `src/web/layout.ts`, `src/vorlagen/*.json|md|pdf`,
`scripts/*`, Deployment-Weg, Bindings.

**Erweitert:** `src/pdf/fuellen.ts` (zweite Unterschrift, Fotoanhang, Deckblatt),
`src/vorlagen/index.ts` (Betreiber-Signatur, Labels, Laufreihenfolge-Helfer als eigenes Modul
`src/reihenfolge.ts`), `wrangler.jsonc` (nichts Neues an Bindings, kein neues Secret —
`ANTHROPIC_API_KEY` ist in `src/env.ts` nur noch optional vermerkt und wird nicht benutzt).

**Ersetzt:** `src/daten/wartungen.ts` → `src/daten/{objekte,bauteile,begehungen,maengel,fotos,berichte,importe,touren}.ts`;
`src/mcp/werkzeuge.ts` → v2-Tools; `src/web/seiten.ts` → aufgeteilt in
`src/web/{objekte,bauteile,begehungen,maengel,touren,import,plan,rundgang}.ts`;
`src/pdf/berichte.ts` → Versionierung; `schema.sql` → v2; `scripts/e2e.sh` → v2-Prüfungen.

**Neu:** `src/import/zusammenfuehren.ts`,
`public/rundgang.js`, `public/plan.js`, `public/import.js`, `public/sw.js` (über `ASSETS`-Binding
oder als Text eingebettet — Entscheidung: **eingebettet** wie v1, kein neues Binding).

---

## 14. Reihenfolge und Abnahme

Jede Stufe endet mit grünem `scripts/e2e.sh` gegen den Entwicklungsserver **und** gegen die
Live-Instanz, danach Commit und Deployment. Stufen sind einzeln auslieferbar.

### Stufe 1 — Bestand, Fristen, Mängel, Versionierung, Betreiber-Unterschrift

Bauen: Abschnitte 1, 2, 3, 4, 9 (Tools), 10 (außer Import/Plan/Rundgang/Touren), 11 (Signatur), 13.
Abnahme:
- `begehung_starten("Kita Heselstücken")` bei unbekanntem Objekt legt es an; drei
  `pruefung_erfassen` ohne `nr` erzeugen Bauteile 1–3; zweite Begehung am selben Objekt sieht
  dieselben Bauteile mit „letzte Prüfung".
- `pruefung_erfassen` mit `checks {"8":"nio"}` erzeugt einen Mangel; in der zweiten Begehung
  meldet `pruefung_erfassen` an demselben Bauteil `offene_maengel_vorjahr`; `mangel_schliessen`
  setzt ihn auf `behoben`.
- `berichte_erzeugen` zweimal ohne Änderung erzeugt **keine** zweite Version; nach Änderung
  der Hinweise entsteht v2, v1 bleibt unter seinem R2-Schlüssel abrufbar.
- Unterschrift hochladen → Bericht v+1 enthält sie an der richtigen Stelle (Sichtprüfung des
  PDF, Koordinaten ggf. nachziehen und im Profil festschreiben).
- `faellig(30)` listet das Objekt nicht mehr, nachdem alle Bauteile geprüft sind; nach
  manuellem Rückdatieren einer Prüfung um 13 Monate wieder.
- `sammelbericht_erzeugen` liefert Deckblatt + n Seiten.

### Stufe 2 — Rundgang, Fotos, Tagestour

Bauen: Abschnitte 5, 6, 8.
Die Bedienung der Tagestour weicht ab: statt Ziehen tragen Knöpfe je Wochentag ein
(Ziehen bleibt als Zugabe für den Rechner). Ein Sieben-Tage-Raster mit Drag & Drop ist auf
einem Telefon im Auto nicht zu bedienen.
Abnahme:
- Rundgang laden, Netz trennen (DevTools offline), zwei Prüfungen + ein Foto erfassen,
  „unbekannte Tür" anlegen, Netz verbinden → alles auf dem Server, Foto im Bericht-Anhang,
  neue Tür mit Server-`nr`.
- Dieselbe Prüfung offline auf zwei Geräten mit verschiedenen Zeiten → jüngere gewinnt.
- Wiederholtes Senden derselben `op_id` ändert nichts.
- Tour mit drei Objekten → Maps-Link enthält drei Adressen in Reihenfolge.

### Stufe 3 — Bauplan-Import über den Agenten, Plan-Bestätigung

Bauen: Abschnitt 7 in der Fassung 7.0, dazu 7.7 bis 7.9.
**Vorher:** die Probe — ein echter Plan und eine echte Türliste des Kunden in der Claude-App
lesen lassen, ohne dass Türwerk beteiligt ist; Trefferquote von Hand zählen. Unter 60 % Treffer
→ Ursache prüfen, bevor Tools und Oberfläche gebaut werden.
Abnahme:
- Plan-PDF mit bekannter Türzahl in der App → Kandidaten ≥ 80 % davon, Falschpositive ≤ 15 %.
- Türliste XLSX mit 20 Zeilen → 20 Vorschläge in Türwerk, Felder aus der Liste übernommen.
- Türliste + Plan → Zusammenführung über `kennung`; angenommene Bauteile haben Position und
  Listenfelder.
- Bestätigen im Gespräch: „alle mit T30 annehmen" legt genau diese Bauteile an.
- Bestätigungsseite auf dem Handy bedienbar (Pan/Zoom/Antippen), „Alle ≥ 0.85 annehmen"
  legt Bauteile an; Rundgang zeigt sie in Raumnummern-Reihenfolge.
- Der ganze Weg läuft **ohne Worker-Secret** — nichts in `wrangler secret list` außer
  `SITZUNGS_SCHLUESSEL`.

### Stufe 4 — Vorlagen-Editor

Abschnitt 11. Abnahme: vierte Vorlage ohne Deployment anlegen, Testbericht rendern, im Diktat
mit `pruefpunkte` nutzbar.

---

## 15. Offen — beim Kunden zu klären, blockiert nichts

1. Typische Türzahl je Objekt (entscheidet, wie viel Stufe 3 wert ist).
2. Liegen bei Ausschreibungsobjekten Türlisten vor, und in welchem Format?
3. Wer ist „Betreiber" beim Unterschreiben — Hausmeister, Verwaltung? (Nur für den Text
   unter der Unterschrift.)
4. Prüfintervall je Objekt: immer 12 Monate, oder gibt es 6-Monats-Verträge?
5. Sollen stillgelegte Bauteile im Sammelbericht erscheinen (als „außer Betrieb")? Vorgabe: nein.

---

## Anhang A — Anthropic-Aufrufe (hinfällig, siehe 7.0)

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
