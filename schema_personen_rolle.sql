-- Einmalig für Datenbanken, in denen `personen` schon aus Türwerk 1 stammt.
-- SQLite kennt kein „ADD COLUMN IF NOT EXISTS"; auf einer frisch mit schema.sql angelegten
-- Datenbank ist die Spalte bereits da und dieses Skript schlägt fehl — das ist in Ordnung.
ALTER TABLE personen ADD COLUMN rolle TEXT NOT NULL DEFAULT 'monteur';
