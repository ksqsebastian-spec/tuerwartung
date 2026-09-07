-- Türtypen als Stammdatenebene, Touren ersatzlos (einmalig anwenden).
--
--   wrangler d1 execute tuerwartung --remote --file schema_tuertypen.sql
--
-- Ein Türtyp ist eine benannte Ausprägung einer der drei Vorlagen und trägt seine Checkliste.
CREATE TABLE IF NOT EXISTS tuertypen (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  art           TEXT NOT NULL,
  beschreibung  TEXT NOT NULL DEFAULT '',
  felder_json   TEXT NOT NULL DEFAULT '{}',
  punkte_json   TEXT NOT NULL DEFAULT '[]',
  zusatz_json   TEXT NOT NULL DEFAULT '[]',
  pflicht_json  TEXT NOT NULL DEFAULT '[]',
  aktiv         INTEGER NOT NULL DEFAULT 1,
  angelegt_von  TEXT NOT NULL DEFAULT '',
  angelegt_am   INTEGER NOT NULL,
  geaendert_am  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tuertypen_aktiv ON tuertypen (aktiv, name);

ALTER TABLE bauteile ADD COLUMN tuertyp_id TEXT REFERENCES tuertypen(id);

DROP TABLE IF EXISTS touren;
