-- Die drei Tabellen, die es nicht mehr gibt — einmalig auf einer Bestandsdatenbank.
--
-- `npm run schema` würde dasselbe erreichen, aber es beginnt mit DROP über ALLE Tabellen und
-- setzt damit den Bestand zurück. Auf einer Datenbank, in der schon gearbeitet wurde, ist das
-- der falsche Weg: die neue Fassung braucht kein geändertes Schema, sie benutzt diese drei
-- Tabellen nur nicht mehr. Deshalb dieser kleine Schnitt statt des großen.
--
--   npx wrangler d1 execute tuerwartung --remote --file schema_entfallene_tabellen.sql
--
-- Was verloren geht: die Mängel (dieselbe Aussage steht im Ergebnis der jeweiligen Prüfung),
-- die Fotos (die Bilddateien bleiben in R2 unter `fotos/…` liegen und können dort weg) und die
-- Warteschlange des Rundgangs. Objekte, Türen, Prüfungen und Berichte bleiben unberührt.

DROP TABLE IF EXISTS fotos;
DROP TABLE IF EXISTS maengel;
DROP TABLE IF EXISTS sync_ops;
DROP TABLE IF EXISTS touren;
