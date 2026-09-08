-- Vorschläge tragen ihren Türtyp (einmalig anwenden).
--
--   wrangler d1 execute tuerwartung --remote --file schema_vorschlag_tuertyp.sql
--
-- Eine Türenliste nennt je Zeile den Türtyp. Daraus leitet der Import die Typen ab und hängt
-- jeden Vorschlag an seinen — sonst müsste das nach der Freigabe jemand von Hand nachziehen.
ALTER TABLE vorschlaege ADD COLUMN tuertyp_id TEXT REFERENCES tuertypen(id);
