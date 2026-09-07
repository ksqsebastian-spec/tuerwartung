-- Türwerk 2 — D1-Schema.
--
-- Das Bauteil ist die feste Größe, nicht der Termin: eine Tür existiert einmal und trägt ihre
-- Geschichte. Eine Begehung ist ein Ereignis, das Prüfungen an Bauteilen erzeugt. Daraus folgt
-- der Aufbau: objekte → gebaeude → geschosse → bauteile; begehungen → pruefungen → maengel,
-- fotos, berichte.
--
-- v2 ersetzt v1 vollständig — die Produktivdatenbank war leer, es gibt keine Migration.
-- `personen` bleibt (die vier Konten mit ihren Passwörtern) und bekommt die Spalte `rolle`;
-- weil SQLite kein „ADD COLUMN IF NOT EXISTS" kennt und dieses Skript wiederholbar bleiben
-- soll, steht die Spalte hier im CREATE und der einmalige ALTER für Bestandsdatenbanken in
-- `schema_personen_rolle.sql`.
--
-- Anwenden:  npm run schema        (remote)
--            npm run schema:lokal  (wrangler dev)
--
-- Konventionen: IDs sind Text (ULID, 26 Zeichen, zeitlich sortierbar). Zeiten als
-- Unix-Millisekunden INTEGER, Datumsangaben als TEXT `YYYY-MM-DD`, JSON-Spalten `*_json`.

DROP TABLE IF EXISTS wartungen;
DROP TABLE IF EXISTS tueren;

DROP TABLE IF EXISTS sync_ops;
DROP TABLE IF EXISTS touren;
DROP TABLE IF EXISTS vorschlaege;
DROP TABLE IF EXISTS importe;
DROP TABLE IF EXISTS sammelberichte;
DROP TABLE IF EXISTS berichte;
DROP TABLE IF EXISTS fotos;
DROP TABLE IF EXISTS maengel;
DROP TABLE IF EXISTS pruefungen;
DROP TABLE IF EXISTS begehungen;
DROP TABLE IF EXISTS bauteile;
DROP TABLE IF EXISTS geschosse;
DROP TABLE IF EXISTS gebaeude;
DROP TABLE IF EXISTS objekte;

-- Die vier festen Konten. Keine Selbstregistrierung: wer dazukommt, wird angelegt.
CREATE TABLE IF NOT EXISTS personen (
  benutzer        TEXT PRIMARY KEY,            -- marc, tobias, nils, kerim
  name            TEXT NOT NULL DEFAULT '',
  passwort_hash   TEXT NOT NULL DEFAULT '',    -- pbkdf2$runden$salz$hash
  vorgaben        TEXT NOT NULL DEFAULT '{}',  -- JSON: pruefer, befaehigung, rechtsgrundlagen, ort
  unterschrift    TEXT,                        -- R2-Schlüssel des Unterschriftbildes
  zuletzt_gesehen INTEGER,
  rolle           TEXT NOT NULL DEFAULT 'monteur'  -- monteur | buero
);

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
  start_x       REAL,                         -- Startpunkt des Rundgangs (normiert 0..1)
  start_y       REAL
);
CREATE INDEX idx_geschosse_gebaeude ON geschosse (gebaeude_id, reihenfolge);

-- Bauteil: die dauerhafte Tür (oder das Fenster, die Feststellanlage).
CREATE TABLE bauteile (
  id            TEXT PRIMARY KEY,
  objekt_id     TEXT NOT NULL REFERENCES objekte(id),
  geschoss_id   TEXT REFERENCES geschosse(id),   -- NULL erlaubt: Tür ohne Plan
  nr            INTEGER NOT NULL,                -- „Tür 12" — je Objekt eindeutig, wird diktiert
  kennung       TEXT NOT NULL DEFAULT '',        -- Türnummer aus Türliste/Plan, z. B. „T-2.14"
  art           TEXT NOT NULL,                   -- Vorlagen-ID
  bezeichnung   TEXT NOT NULL DEFAULT '',        -- freier Name, z. B. „Flur Ost zur Küche"
  raumnummer    TEXT NOT NULL DEFAULT '',        -- „2.14" — treibt die Laufreihenfolge
  raum          TEXT NOT NULL DEFAULT '',        -- Raumbezeichnung
  flur          TEXT NOT NULL DEFAULT '',
  felder_json   TEXT NOT NULL DEFAULT '{}',      -- HERSTELLER, OTS, ABSENKDICHTUNG, SPION …
  x             REAL,                            -- Position im Geschossplan, normiert 0..1
  y             REAL,
  richtung_grad REAL,                            -- Anschlagsrichtung aus dem Plan, informativ
  breite_m      REAL,                            -- lichte Breite aus Plan/Türliste, informativ
  intervall_monate INTEGER,                      -- NULL = Objektintervall
  wartungspflichtig INTEGER NOT NULL DEFAULT 1,  -- 0 = im Bestand, aber nicht Teil der Wartung
  aktiv         INTEGER NOT NULL DEFAULT 1,      -- 0 = stillgelegt, bleibt für die Historie
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
  status          TEXT NOT NULL DEFAULT 'laufend',  -- geplant | laufend | abgeschlossen | abgebrochen
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
  felder_snapshot_json TEXT NOT NULL DEFAULT '{}',   -- Bauteilfelder zum Zeitpunkt der Prüfung
  stand_hash     TEXT NOT NULL DEFAULT '',       -- SHA-256 über alles, was ins PDF geht
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

-- Foto: hängt am Bauteil, optional an Prüfung und/oder Mangel. (Bedient ab Stufe 2.)
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
  von            TEXT NOT NULL DEFAULT '',
  aktiv          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_fotos_pruefung ON fotos (pruefung_id);
CREATE INDEX idx_fotos_bauteil ON fotos (bauteil_id, aufgenommen_am DESC);

-- Bericht: eine erzeugte PDF-Version. Wird nie gelöscht, nie überschrieben.
CREATE TABLE berichte (
  id            TEXT PRIMARY KEY,
  pruefung_id   TEXT NOT NULL REFERENCES pruefungen(id),
  version       INTEGER NOT NULL,               -- 1, 2, 3 …
  r2_schluessel TEXT NOT NULL,                  -- berichte/<objekt>/<bauteil>/<begehung>/v<n>.pdf
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
  r2_schluessel TEXT NOT NULL,                  -- berichte/<objekt>/_sammel/<begehung>/v<n>.pdf
  erzeugt_am    INTEGER NOT NULL,
  UNIQUE (begehung_id, version)
);

-- Import: ein hochgeladener Plan oder eine Türliste. (Bedient ab Stufe 3.)
CREATE TABLE importe (
  id            TEXT PRIMARY KEY,
  objekt_id     TEXT NOT NULL REFERENCES objekte(id),
  geschoss_id   TEXT REFERENCES geschosse(id),  -- bei Plänen gesetzt, bei Türlisten NULL
  art           TEXT NOT NULL,                  -- tuerliste | plan_vektor | plan_raster | dxf
  dateiname     TEXT NOT NULL,
  r2_schluessel TEXT NOT NULL,                  -- importe/<objekt>/<id>.<ext>
  status        TEXT NOT NULL DEFAULT 'hochgeladen',  -- hochgeladen | ausgewertet | bestaetigt | verworfen
  ergebnis_json TEXT NOT NULL DEFAULT '{}',     -- Statistik: gefunden, angenommen, Warnungen, Tokens
  angelegt_von  TEXT NOT NULL DEFAULT '',
  angelegt_am   INTEGER NOT NULL
);

-- Vorschlag: ein Kandidat aus einem Import, bis er angenommen oder verworfen ist. (Stufe 3.)
CREATE TABLE vorschlaege (
  id            TEXT PRIMARY KEY,
  import_id     TEXT NOT NULL REFERENCES importe(id),
  objekt_id     TEXT NOT NULL,
  geschoss_id   TEXT REFERENCES geschosse(id),
  x             REAL,                           -- normiert 0..1, NULL bei Türlisten-Zeilen
  y             REAL,
  richtung_grad REAL,
  breite_m      REAL,
  kennung       TEXT NOT NULL DEFAULT '',
  raumnummer    TEXT NOT NULL DEFAULT '',
  raum          TEXT NOT NULL DEFAULT '',
  art           TEXT NOT NULL DEFAULT 'wartung_drehfluegel',
  felder_json   TEXT NOT NULL DEFAULT '{}',
  wartungspflichtig INTEGER NOT NULL DEFAULT 0,
  konfidenz     REAL NOT NULL,                  -- 0..1
  herkunft      TEXT NOT NULL,                  -- tuerliste | geometrie | vision | zusammengefuehrt
  text_nahe_json TEXT NOT NULL DEFAULT '[]',    -- Beschriftungen in der Nähe (zur Anzeige)
  status        TEXT NOT NULL DEFAULT 'offen',  -- offen | angenommen | verworfen
  bauteil_id    TEXT REFERENCES bauteile(id),   -- gesetzt nach Annahme
  angelegt_am   INTEGER NOT NULL
);
CREATE INDEX idx_vorschlaege_import ON vorschlaege (import_id, status);

-- Tagestour: welche Objekte an welchem Tag in welcher Reihenfolge. (Bedient ab Stufe 2.)
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

-- Offline-Abgleich: jede Operation vom Handy trägt eine Client-ID; Doppelte werden verworfen.
-- (Bedient ab Stufe 2.)
CREATE TABLE sync_ops (
  op_id        TEXT PRIMARY KEY,                -- vom Client erzeugte UUID
  person       TEXT NOT NULL,
  eingegangen_am INTEGER NOT NULL
);
