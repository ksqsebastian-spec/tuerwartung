-- Türenwartung — D1-Schema.
--
-- Zwei Tabellen tragen die Arbeit: eine Wartung (= ein Objekttermin) und ihre Türen.
-- Die Stammdaten stehen an der Wartung, damit sie pro Tür nicht wiederholt werden müssen;
-- was je Tür abweicht, steht in `felder` als JSON. Welche Felder das sind, entscheidet die
-- Vorlage (Drehflügel/Fenster/Feststellanlage) — deshalb JSON und keine 20 Spalten.
--
-- Anwenden:  node scripts/apply-schema.mjs   (oder wrangler d1 execute tuerwartung --file schema.sql)

CREATE TABLE IF NOT EXISTS wartungen (
  id                TEXT PRIMARY KEY,            -- z. B. WART-2026-08-13-Heselstuecken
  vorlage           TEXT NOT NULL,               -- wartung_drehfluegel | wartung_fenster | wartung_feststellanlagen
  objekt            TEXT NOT NULL DEFAULT '',    -- Adresse/Objektbeschreibung
  betreiber         TEXT NOT NULL DEFAULT '',
  ident             TEXT NOT NULL DEFAULT '',
  tuertyp           TEXT NOT NULL DEFAULT '',
  pruefer           TEXT NOT NULL DEFAULT '',
  befaehigung       TEXT NOT NULL DEFAULT '',
  datum             TEXT NOT NULL DEFAULT '',    -- Prüfdatum, YYYY-MM-DD
  ort               TEXT NOT NULL DEFAULT '',    -- Prüfort/Stadt
  rechtsgrundlagen  TEXT NOT NULL DEFAULT '',
  letzte_pruefung   TEXT NOT NULL DEFAULT '',
  naechste_pruefung TEXT NOT NULL DEFAULT '',
  beteiligte        TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'offen',  -- offen | abgeschlossen | generiert
  angelegt_von      TEXT NOT NULL DEFAULT '',       -- Benutzerkennung
  angelegt_am       INTEGER NOT NULL,
  geaendert_am      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wartungen_zeit ON wartungen (geaendert_am DESC);

CREATE TABLE IF NOT EXISTS tueren (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  wartung_id     TEXT NOT NULL,
  nr             INTEGER NOT NULL,            -- laufende Nummer in der Wartung
  dateiname      TEXT NOT NULL DEFAULT '',
  felder         TEXT NOT NULL DEFAULT '{}',  -- JSON: ETAGE, RAUM, HERSTELLER, … je nach Vorlage
  checks         TEXT NOT NULL DEFAULT '{}',  -- JSON: {"8":"nio"} — leer = alles In Ordnung
  ergebnis       TEXT NOT NULL DEFAULT '',    -- bestanden | Nachbesserung | …
  hinweise       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'erfasst',  -- erfasst | generiert
  pdf_schluessel TEXT,                        -- R2-Schlüssel des fertigen Berichts
  erzeugt_am     INTEGER,
  angelegt_am    INTEGER NOT NULL,
  geaendert_am   INTEGER NOT NULL,
  UNIQUE (wartung_id, nr)
);

CREATE INDEX IF NOT EXISTS idx_tueren_wartung ON tueren (wartung_id, nr);

-- Die vier festen Konten. Keine Selbstregistrierung: wer dazukommt, wird angelegt.
CREATE TABLE IF NOT EXISTS personen (
  benutzer        TEXT PRIMARY KEY,            -- marc, tobias, nils, kerim
  name            TEXT NOT NULL DEFAULT '',
  passwort_hash   TEXT NOT NULL DEFAULT '',    -- pbkdf2$runden$salz$hash
  vorgaben        TEXT NOT NULL DEFAULT '{}',  -- JSON: pruefer, befaehigung, rechtsgrundlagen, ort
  unterschrift    TEXT,                        -- R2-Schlüssel des Unterschriftbildes
  zuletzt_gesehen INTEGER
);
