-- Stammdaten, die einen Monteur sonst einen Anruf kosten (einmalig anwenden).
--
--   wrangler d1 execute tuerwartung --remote --file schema_objekt_stammdaten.sql
--
-- `betreiber_kontakt` bleibt, was es war: der Name des Ansprechpartners. Telefon und E-Mail
-- standen bisher mit im selben Freitext und waren damit für niemanden greifbar.
ALTER TABLE objekte ADD COLUMN telefon    TEXT NOT NULL DEFAULT '';
ALTER TABLE objekte ADD COLUMN email      TEXT NOT NULL DEFAULT '';
-- Wie man hineinkommt: „Schlüssel beim Hausmeister, Herr Kern 0171-…", „Anmeldung im
-- Sekretariat", „Codeschloss 1234". Das ist das Feld, das eine vergebliche Anfahrt verhindert.
ALTER TABLE objekte ADD COLUMN zugang     TEXT NOT NULL DEFAULT '';
-- Wartungsvertrag oder Auftragsnummer des Betreibers — gehört auf die Papiere.
ALTER TABLE objekte ADD COLUMN vertrag    TEXT NOT NULL DEFAULT '';
-- „Kita", „Schule", „Bürogebäude" — hilft beim Einordnen und in der Suche.
ALTER TABLE objekte ADD COLUMN objektart  TEXT NOT NULL DEFAULT '';
