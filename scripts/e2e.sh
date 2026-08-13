#!/usr/bin/env bash
#
# End-to-End gegen den laufenden Entwicklungsserver: Anmeldung, Wartung, Türen, Berichte,
# der komplette OAuth-Tanz und ein paar MCP-Aufrufe. Prüft das Zusammenspiel, nicht die Teile.
#
# Voraussetzung: in einem zweiten Fenster laufen
#     npm run dev
#     npm run konten -- marc:Marc --passwort=test-test-1234
#     npx wrangler d1 execute tuerwartung --local --file konten.sql
#
#     bash scripts/e2e.sh
#
# Gegen die Live-Instanz:
#     PASSWORT=… bash scripts/e2e.sh https://tuerwartung.ksqsebastian.workers.dev
#
set -u
B=${1:-http://127.0.0.1:8787}
BENUTZER=${BENUTZER:-marc}
PASSWORT=${PASSWORT:-test-test-1234}
J=$(mktemp)
rm -f $J
ok()  { echo "  OK   $1"; }
bad() { echo "  FEHL $1"; FAILED=1; }
FAILED=0
STEMPEL=$(date +%H%M%S)-$RANDOM   # eindeutig je Lauf: die Kennung einer Wartung leitet sich aus dem Objekt ab

echo "== 1. Anmeldung =="
code=$(curl -s -o /dev/null -w "%{http_code}" -c $J -X POST $B/anmeldung \
  -d "benutzer=$BENUTZER" -d "passwort=$PASSWORT")
[ "$code" = "302" ] && ok "Login 302" || bad "Login $code"
grep -q tw_sitzung $J && ok "Sitzungs-Cookie gesetzt" || bad "kein Cookie"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST $B/anmeldung -d "benutzer=$BENUTZER" -d "passwort=garantiert-falsch")
[ "$code" = "200" ] && ok "Falsches Passwort -> Formular" || bad "Falsches Passwort $code"

echo "== 2. Geschützte Seiten =="
code=$(curl -s -o /dev/null -w "%{http_code}" $B/wartungen)
[ "$code" = "302" ] && ok "Ohne Cookie umgeleitet" || bad "Ohne Cookie $code"
curl -s -b $J $B/wartungen | grep -q "Neue Wartung" && ok "Wartungsliste" || bad "Wartungsliste"

echo "== 3. Wartung anlegen =="
loc=$(curl -s -o /dev/null -w "%{redirect_url}" -b $J -X POST $B/wartungen \
  -d "vorlage=wartung_drehfluegel" -d "objekt=Heselstücken $STEMPEL" -d "betreiber=Kita Nord" -d "datum=2026-08-13")
ID=$(echo "$loc" | sed 's#.*/wartung/##')
[ -n "$ID" ] && ok "Wartung $ID" || bad "keine Wartung"

echo "== 4. Türen erfassen =="
for nr in 1 2; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -b $J -X POST "$B/wartung/$ID/tuer/neu" \
    -d "f_ETAGE=$nr" -d "f_RAUM=Flur Ost" -d "f_HERSTELLER=Hörmann" \
    -d "ergebnis=Nachbesserung" -d "hinweise=Dichtung spröde" \
    -d "p_1=io" -d "p_8=nio" -d "p_10=sb")
  [ "$code" = "302" ] && ok "Tür $nr gespeichert" || bad "Tür $nr $code"
done
curl -s -b $J "$B/wartung/$ID" | grep -q "2 von 10 nicht i.O." && ok "Abweichungen angezeigt" || bad "Abweichungen"

echo "== 5. Berichte erzeugen =="
res=$(curl -s -b $J -X POST "$B/wartung/$ID/erzeugen")
echo "$res" | grep -q '"fertig": true' && ok "Lauf fertig" || bad "Lauf: $res"
echo "$res" | grep -q '"erzeugt": 2' && ok "2 Berichte" || bad "Anzahl"
KEY=$(echo "$res" | grep -o '"schluessel": "[^"]*"' | head -1 | cut -d'"' -f4)
typ=$(curl -s -o /dev/null -w "%{content_type}" -b $J "$B/datei/$KEY")
[ "$typ" = "application/pdf" ] && ok "PDF abrufbar" || bad "PDF-Typ $typ"
groesse=$(curl -s -b $J "$B/wartung/$ID/paket.zip" | wc -c)
[ "$groesse" -gt 10000 ] && ok "ZIP $groesse Bytes" || bad "ZIP zu klein: $groesse"

echo "== 6. Zugriffsschutz Dateien =="
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/datei/$KEY")
[ "$code" = "302" ] && ok "Datei ohne Anmeldung gesperrt" || bad "Datei ohne Anmeldung $code"

echo "== 7. OAuth =="
curl -s $B/.well-known/oauth-protected-resource | grep -q '"resource"' && ok "Resource-Metadaten" || bad "Resource-Metadaten"
curl -s $B/.well-known/oauth-authorization-server | grep -q '"S256"' && ok "AS-Metadaten (PKCE S256)" || bad "AS-Metadaten"

REG=$(curl -s -X POST $B/register -H 'content-type: application/json' \
  -d '{"client_name":"Testclient","redirect_uris":["http://localhost:9999/cb"],"token_endpoint_auth_method":"none"}')
CID=$(echo "$REG" | grep -o '"client_id": "[^"]*"' | cut -d'"' -f4)
[ -n "$CID" ] && ok "DCR client_id" || bad "DCR: $REG"

VERIFIER="dies-ist-ein-test-verifier-mit-genug-laenge-1234567890"
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 -A | tr '+/' '-_' | tr -d '=')

code=$(curl -s -o /dev/null -w "%{http_code}" "$B/authorize?client_id=$CID&redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcb&response_type=code&code_challenge=$CHALLENGE&code_challenge_method=S256&state=xyz")
[ "$code" = "200" ] && ok "Authorize ohne Anmeldung zeigt Anmeldeformular" || bad "Authorize anonym $code"

curl -s -b $J "$B/authorize?client_id=$CID&redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcb&response_type=code&code_challenge=$CHALLENGE&code_challenge_method=S256&state=xyz" \
  | grep -q "Zugriff erlauben" && ok "Freigabeseite" || bad "Freigabeseite"

LOC=$(curl -s -o /dev/null -w "%{redirect_url}" -b $J -X POST $B/authorize \
  -d "client_id=$CID" -d "redirect_uri=http://localhost:9999/cb" -d "response_type=code" \
  -d "code_challenge=$CHALLENGE" -d "code_challenge_method=S256" -d "state=xyz" -d "entscheidung=ja")
CODE=$(echo "$LOC" | sed -n 's/.*code=\([^&]*\).*/\1/p')
[ -n "$CODE" ] && ok "Auth-Code" || bad "Auth-Code: $LOC"

TOK=$(curl -s -X POST $B/token -d "grant_type=authorization_code" -d "code=$CODE" \
  -d "client_id=$CID" -d "code_verifier=$VERIFIER" -d "redirect_uri=http://localhost:9999/cb")
AT=$(echo "$TOK" | grep -o '"access_token": "[^"]*"' | cut -d'"' -f4)
[ -n "$AT" ] && ok "Access-Token" || bad "Token: $TOK"

BAD=$(curl -s -X POST $B/token -d "grant_type=authorization_code" -d "code=$CODE" \
  -d "client_id=$CID" -d "code_verifier=$VERIFIER" -d "redirect_uri=http://localhost:9999/cb")
echo "$BAD" | grep -q invalid_grant && ok "Code nur einmal gültig" || bad "Code-Wiederverwendung"

echo "== 8. MCP =="
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST $B/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
[ "$code" = "401" ] && ok "MCP ohne Token 401" || bad "MCP ohne Token $code"

mcp() { curl -s -X POST $B/mcp -H "authorization: Bearer $AT" -H 'content-type: application/json' -d "$1"; }
mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  | grep -q '"instructions"' && ok "initialize" || bad "initialize"
mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | grep -q tuer_erfassen && ok "tools/list" || bad "tools/list"
mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pruefpunkte","arguments":{"vorlage":"wartung_drehfluegel"}}}' \
  | grep -q "Leichtgängigkeit" && ok "pruefpunkte" || bad "pruefpunkte"

W=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"wartung_starten\",\"arguments\":{\"vorlage\":\"wartung_feststellanlagen\",\"objekt\":\"Oelmuehlenweg $STEMPEL\",\"betreiber\":\"Hausverwaltung Sued\"}}}")
echo "$W" | grep -q 'WART-' && ok "wartung_starten" || bad "wartung_starten: $W"
WID=$(echo "$W" | grep -o 'WART-[A-Za-z0-9-]*' | head -1)

mcp "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"tuer_erfassen\",\"arguments\":{\"wartung\":\"$WID\",\"felder\":{\"ETAGE\":\"EG\"},\"checks\":{\"14\":\"nio\"}}}}" \
  | grep -q 'Tür 1' && ok "tuer_erfassen" || bad "tuer_erfassen"
mcp "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"tuer_erfassen\",\"arguments\":{\"wartung\":\"$WID\",\"wie_davor\":true,\"felder\":{\"RAUM\":\"Keller\"}}}}" \
  | grep -q 'Tür 2' && ok "tuer_erfassen wie_davor" || bad "wie_davor"

R=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"wartung_lesen\",\"arguments\":{\"wartung\":\"$WID\"}}}")
echo "$R" | grep -q "Auslösung der Rauch" && ok "wartung_lesen mit Klartext" || bad "wartung_lesen"
echo "$R" | grep -q '\\"ETAGE\\": \\"EG\\"' && ok "wie_davor übernahm Felder" || bad "wie_davor Felder"

FEHL=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"tuer_erfassen\",\"arguments\":{\"wartung\":\"$WID\",\"checks\":{\"99\":\"nio\"}}}}")
echo "$FEHL" | grep -q '"isError": true' && ok "Ungültiger Punkt abgewiesen" || bad "Punktprüfung"

G=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"berichte_erzeugen\",\"arguments\":{\"wartung\":\"$WID\"}}}")
echo "$G" | grep -q '\\"fertig\\": true' && ok "berichte_erzeugen" || bad "berichte_erzeugen: $(echo $G | head -c 300)"

echo
[ "$FAILED" = "0" ] && echo "ALLES GRÜN" || echo "FEHLER VORHANDEN"
