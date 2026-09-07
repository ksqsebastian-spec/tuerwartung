#!/usr/bin/env bash
#
# End-to-End gegen einen laufenden Türwerk-Server: die Abnahmekriterien der Stufe 1 aus
# KONZEPT.md, Abschnitt 14 — Bestand, Fristen, Mängel-Lebenslauf, versionierte Berichte,
# Betreiber-Unterschrift, Sammelbericht — plus Anmeldung, OAuth-Tanz und die Website.
#
# Voraussetzung: `jq`, `openssl`, und in einem zweiten Fenster
#     npm run dev
#     npm run konten -- marc:Marc --passwort=test-test-1234
#     npx wrangler d1 execute tuerwartung --local --file konten.sql
#
#     bash scripts/e2e.sh
#
# Gegen die Live-Instanz:
#     PASSWORT=… bash scripts/e2e.sh https://tuerwerk.ksqsebastian.workers.dev
#
# Was der Lauf anlegt, räumt er am Ende wieder weg (AUFRAEUMEN=0 lässt es stehen).
set -u
B=${1:-http://127.0.0.1:8787}
BENUTZER=${BENUTZER:-marc}
PASSWORT=${PASSWORT:-test-test-1234}
AUFRAEUMEN=${AUFRAEUMEN:-1}
J=$(mktemp); rm -f $J
FAILED=0
ok()  { echo "  OK   $1"; }
bad() { echo "  FEHL $1"; FAILED=1; }

STEMPEL=$(date +%H%M%S)-$RANDOM
OBJEKT="E2E Kita Heselstuecken $STEMPEL"
VORJAHR=$(date -d "-13 months" +%Y-%m-%d 2>/dev/null || date -v-13m +%Y-%m-%d)
HEUTE=$(date +%Y-%m-%d)

# Ein 1×1-PNG als Unterschrift — es geht um den Weg, nicht um das Bild.
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

echo "== 1. Anmeldung =="
code=$(curl -s -o /dev/null -w "%{http_code}" -c $J -X POST $B/anmeldung \
  -d "benutzer=$BENUTZER" -d "passwort=$PASSWORT")
[ "$code" = "302" ] && ok "Login 302" || bad "Login $code"
grep -q tw_sitzung $J && ok "Sitzungs-Cookie gesetzt" || bad "kein Cookie"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST $B/anmeldung -d "benutzer=$BENUTZER" -d "passwort=garantiert-falsch")
[ "$code" = "200" ] && ok "Falsches Passwort -> Formular" || bad "Falsches Passwort $code"

code=$(curl -s -o /dev/null -w "%{http_code}" $B/objekte)
[ "$code" = "302" ] && ok "Ohne Cookie umgeleitet" || bad "Ohne Cookie $code"
curl -s -b $J $B/objekte | grep -q "Neues Objekt" && ok "Objektliste" || bad "Objektliste"

echo "== 2. OAuth =="
curl -s $B/.well-known/oauth-protected-resource | grep -q '"resource"' && ok "Resource-Metadaten" || bad "Resource-Metadaten"
curl -s $B/.well-known/oauth-authorization-server | grep -q '"S256"' && ok "AS-Metadaten (PKCE S256)" || bad "AS-Metadaten"

REG=$(curl -s -X POST $B/register -H 'content-type: application/json' \
  -d '{"client_name":"Testclient","redirect_uris":["http://localhost:9999/cb"],"token_endpoint_auth_method":"none"}')
CID=$(echo "$REG" | jq -r .client_id)
[ -n "$CID" ] && [ "$CID" != "null" ] && ok "DCR client_id" || bad "DCR: $REG"

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
AT=$(echo "$TOK" | jq -r .access_token)
[ -n "$AT" ] && [ "$AT" != "null" ] && ok "Access-Token" || bad "Token: $TOK"

BAD=$(curl -s -X POST $B/token -d "grant_type=authorization_code" -d "code=$CODE" \
  -d "client_id=$CID" -d "code_verifier=$VERIFIER" -d "redirect_uri=http://localhost:9999/cb")
echo "$BAD" | grep -q invalid_grant && ok "Code nur einmal gültig" || bad "Code-Wiederverwendung"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST $B/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
[ "$code" = "401" ] && ok "MCP ohne Token 401" || bad "MCP ohne Token $code"

# Ein Tool aufrufen und die Nutzlast als JSON zurückgeben.
ruf() {
  local name=$1; shift
  curl -s -X POST $B/mcp -H "authorization: Bearer $AT" -H 'content-type: application/json' \
    -d "$(jq -nc --arg n "$name" --argjson a "$1" \
      '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$n,arguments:$a}}')" \
  | jq -r 'if .result.isError then "FEHLER " + .result.content[0].text
           else .result.content[0].text end'
}

echo "== 3. MCP-Grundlagen =="
curl -s -X POST $B/mcp -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  | jq -e '.result.instructions | contains("Bestandsaufnahme")' >/dev/null \
  && ok "initialize mit Anleitung" || bad "initialize"
curl -s -X POST $B/mcp -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | jq -e '[.result.tools[].name] | index("pruefung_erfassen") and index("sammelbericht_erzeugen")' >/dev/null \
  && ok "tools/list" || bad "tools/list"
ruf pruefpunkte '{"vorlage":"wartung_drehfluegel"}' | jq -e '.punkte | length == 10' >/dev/null \
  && ok "pruefpunkte" || bad "pruefpunkte"

echo "== 4. Bestandsaufnahme: unbekanntes Objekt =="
B1=$(ruf begehung_starten "$(jq -nc --arg o "$OBJEKT" --arg d "$VORJAHR" \
  '{objekt:$o,datum:$d,betreiber:"Bezirksamt Nord",adresse:"Heselstuecken 12, 22523 Hamburg"}')")
echo "$B1" | jq -e '.objekt_neu_angelegt == true' >/dev/null \
  && ok "unbekanntes Objekt angelegt" || bad "Objekt nicht angelegt: $B1"
BEG1=$(echo "$B1" | jq -r .begehung.id)
OID=$(echo "$B1" | jq -r .objekt.id)
[ -n "$BEG1" ] && ok "Begehung $BEG1" || bad "keine Begehung"

for i in 1 2 3; do
  A=$(ruf pruefung_erfassen "$(jq -nc --arg b "$BEG1" --arg r "Flur $i" \
    '{begehung:$b,art:"wartung_drehfluegel",raum:$r,felder:{"HERSTELLER":"Hoermann"}}')")
  echo "$A" | jq -e --argjson n $i '.gespeichert == ("Tür " + ($n|tostring)) and .neu_angelegt == true' >/dev/null \
    && ok "Tür $i angelegt und geprüft" || bad "Tür $i: $A"
done

echo "== 5. Mangel aus einer Abweichung =="
A=$(ruf pruefung_erfassen "$(jq -nc --arg b "$BEG1" \
  '{begehung:$b,nr:2,checks:{"8":"nio"},hinweise:"Dichtung sproede",ergebnis:"Nachbesserung"}')")
echo "$A" | jq -e '.mangel_angelegt.status == "offen"' >/dev/null \
  && ok "Mangel angelegt" || bad "kein Mangel: $A"
echo "$A" | jq -e '.mangel_angelegt.punkte == ["8"]' >/dev/null \
  && ok "Mangel trägt Punkt 8" || bad "Mangelpunkte"
ruf maengel_auflisten "$(jq -nc --arg o "$OID" '{objekt:$o}')" \
  | jq -e '.maengel | length == 1' >/dev/null && ok "Mangel in der Liste" || bad "Mangelliste"

ruf begehung_abschliessen "$(jq -nc --arg b "$BEG1" '{begehung:$b}')" \
  | jq -e '.pruefungen_gesamt == 3 and .nachbesserung == 1' >/dev/null \
  && ok "Rückblick: 3 Prüfungen, 1 Nachbesserung" || bad "Rückblick"

echo "== 6. Versionierte Berichte =="
L=$(ruf berichte_erzeugen "$(jq -nc --arg b "$BEG1" '{begehung:$b}')")
echo "$L" | jq -e '.erzeugt == 3 and .fertig == true' >/dev/null \
  && ok "3 Berichte, v1" || bad "Erzeugung: $L"
V1=$(echo "$L" | jq -r '.berichte[] | select(.nr == 1) | .schluessel')
typ=$(curl -s -o /dev/null -w "%{content_type}" -b $J "$B/datei/$V1")
[ "$typ" = "application/pdf" ] && ok "PDF abrufbar" || bad "PDF-Typ $typ"

L=$(ruf berichte_erzeugen "$(jq -nc --arg b "$BEG1" '{begehung:$b}')")
echo "$L" | jq -e '.erzeugt == 0 and .fertig == true' >/dev/null \
  && ok "ohne Änderung keine zweite Version" || bad "zweiter Lauf: $L"

ruf pruefung_erfassen "$(jq -nc --arg b "$BEG1" '{begehung:$b,nr:1,hinweise:"Nachtrag vom Buero"}')" >/dev/null
L=$(ruf berichte_erzeugen "$(jq -nc --arg b "$BEG1" '{begehung:$b}')")
echo "$L" | jq -e '.erzeugt == 1 and (.berichte[0].version == 2)' >/dev/null \
  && ok "nach Änderung entsteht v2" || bad "v2: $L"
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J "$B/datei/$V1")
[ "$code" = "200" ] && ok "v1 bleibt abrufbar" || bad "v1 weg ($code)"

echo "== 7. Betreiber-Unterschrift =="
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J "$B/begehung/$BEG1/unterschrift")
[ "$code" = "200" ] && ok "Unterschriftsseite" || bad "Unterschriftsseite $code"
LOC=$(curl -s -o /dev/null -w "%{redirect_url}" -b $J -X POST "$B/begehung/$BEG1/unterschrift" \
  --data-urlencode "bild=data:image/png;base64,$PNG" --data-urlencode "name=Frau Meyer")
echo "$LOC" | grep -q "Berichte+neu" && ok "Unterschrift löst neue Versionen aus" || bad "Unterschrift: $LOC"
BER=$(ruf berichte_auflisten "$(jq -nc --arg b "$BEG1" '{begehung:$b}')")
echo "$BER" | jq -e '[.berichte[] | select(.nr == 1) | .version] == [3]' >/dev/null \
  && ok "Tür 1 steht bei v3" || bad "Versionen: $BER"
echo "$BER" | jq -e '[.berichte[].veraltet] | any | not' >/dev/null \
  && ok "kein Bericht veraltet" || bad "veraltete Berichte"

echo "== 8. Sammelbericht =="
S=$(ruf sammelbericht_erzeugen "$(jq -nc --arg b "$BEG1" '{begehung:$b}')")
echo "$S" | jq -e '.version == 1 and .enthaltene_berichte == 3 and .seiten >= 4' >/dev/null \
  && ok "Deckblatt + 3 Berichte" || bad "Sammelbericht: $S"
SKEY=$(echo "$S" | jq -r .link | sed 's#.*/datei/##')
typ=$(curl -s -o /dev/null -w "%{content_type}" -b $J "$B/datei/$SKEY")
[ "$typ" = "application/pdf" ] && ok "Sammelbericht abrufbar" || bad "Sammelbericht-Typ $typ"
groesse=$(curl -s -b $J "$B/begehung/$BEG1/paket.zip" | wc -c)
[ "$groesse" -gt 10000 ] && ok "ZIP $groesse Bytes" || bad "ZIP zu klein: $groesse"

echo "== 9. Zweite Begehung: Bestand steht =="
B2=$(ruf begehung_starten "$(jq -nc --arg o "$OID" --arg d "$HEUTE" '{objekt:$o,datum:$d}')")
echo "$B2" | jq -e '.objekt_neu_angelegt == false and .bauteile_gesamt == 3' >/dev/null \
  && ok "dieselben 3 Bauteile" || bad "Bestand: $B2"
echo "$B2" | jq -e '[.faellige_bauteile[].nr] | sort == [1,2,3]' >/dev/null \
  && ok "alle drei fällig (letzte Prüfung 13 Monate her)" || bad "Fälligkeit"
BEG2=$(echo "$B2" | jq -r .begehung.id)

ruf objekt_lesen "$(jq -nc --arg o "$OID" '{objekt:$o}')" \
  | jq -e --arg d "$VORJAHR" '[.bauteile[].letzte_pruefung] == [$d,$d,$d]' >/dev/null \
  && ok "letzte Prüfung am Bauteil" || bad "letzte Prüfung"

A=$(ruf pruefung_erfassen "$(jq -nc --arg b "$BEG2" '{begehung:$b,nr:2}')")
echo "$A" | jq -e '.offene_maengel_vorjahr | length == 1' >/dev/null \
  && ok "offener Mangel des Vorjahrs gemeldet" || bad "Vorjahresmangel: $A"

MID=$(echo "$A" | jq -r '.offene_maengel_vorjahr[0].id')
ruf mangel_schliessen "$(jq -nc --arg m "$MID" '{mangel:$m,freimeldung:"Dichtung getauscht"}')" \
  | jq -e '.maengel[0].status == "behoben"' >/dev/null && ok "Mangel freigemeldet" || bad "Freimeldung"
ruf bauteil_lesen "$(jq -nc --arg o "$OID" '{objekt:$o,nr:2}')" \
  | jq -e '.bauteil.offene_maengel == 0 and (.pruefungen | length == 2)' >/dev/null \
  && ok "Bauteil-Historie: zwei Prüfungen, nichts offen" || bad "Historie"

echo "== 10. Fristen =="
for nr in 1 3; do
  ruf pruefung_erfassen "$(jq -nc --arg b "$BEG2" --argjson n $nr '{begehung:$b,nr:$n}')" >/dev/null
done
ruf faellig '{"tage":30}' | jq -e --arg o "$OID" '[.objekte[].id] | index($o) | not' >/dev/null \
  && ok "nach vollständiger Begehung nicht mehr fällig" || bad "noch fällig"

ruf begehung_aendern "$(jq -nc --arg b "$BEG2" --arg d "$VORJAHR" '{begehung:$b,datum:$d}')" >/dev/null
ruf faellig '{"tage":30}' | jq -e --arg o "$OID" '[.objekte[].id] | index($o)' >/dev/null \
  && ok "nach Rückdatierung um 13 Monate wieder fällig" || bad "Rückdatierung wirkt nicht"

echo "== 11. Website =="
curl -s -b $J "$B/objekt/$OID" | grep -q "Bestand" && ok "Objektseite" || bad "Objektseite"
curl -s -b $J "$B/objekt/$OID/bauteil/2" | grep -q "Historie" && ok "Bauteilseite" || bad "Bauteilseite"
curl -s -b $J "$B/begehung/$BEG2" | grep -q "Prüfungen" && ok "Begehungsseite" || bad "Begehungsseite"
curl -s -b $J "$B/maengel?status=alle" | grep -q "Dichtung" && ok "Mängelseite" || bad "Mängelseite"
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J -X POST "$B/begehung/$BEG2/pruefung/3" \
  -d "ergebnis=Nachbesserung" -d "hinweise=Aus dem Browser" -d "p_1=io" -d "p_4=nio" -d "raum=Flur 3")
[ "$code" = "302" ] && ok "Prüfraster speichert" || bad "Prüfraster $code"
ruf bauteil_lesen "$(jq -nc --arg o "$OID" '{objekt:$o,nr:3}')" \
  | jq -e '.bauteil.offene_maengel == 1' >/dev/null && ok "Mangel aus dem Formular" || bad "Formular-Mangel"

echo "== 12. Zugriffsschutz =="
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/datei/$V1")
[ "$code" = "302" ] && ok "Datei ohne Anmeldung gesperrt" || bad "Datei ohne Anmeldung $code"
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J "$B/datei/vorlagen/wartung_drehfluegel.pdf")
[ "$code" = "404" ] && ok "fremder Präfix gesperrt" || bad "Präfix $code"
FEHL=$(ruf pruefung_erfassen "$(jq -nc --arg b "$BEG2" '{begehung:$b,nr:1,checks:{"99":"nio"}}')")
echo "$FEHL" | grep -q "^FEHLER" && ok "ungültiger Punkt abgewiesen" || bad "Punktprüfung"

if [ "$AUFRAEUMEN" = "1" ]; then
  echo "== 13. Testdaten entfernen =="
  code=$(curl -s -o /dev/null -w "%{http_code}" -b $J -X POST "$B/objekt/$OID/loeschen")
  [ "$code" = "302" ] && ok "Objekt samt Begehungen entfernt" || bad "Aufräumen $code"
  ruf objekte_auflisten "$(jq -nc --arg s "$OBJEKT" '{suche:$s}')" \
    | jq -e '.objekte | length == 0' >/dev/null && ok "nichts geblieben" || bad "Reste"
fi

echo
[ "$FAILED" = "0" ] && echo "ALLES GRÜN" || echo "FEHLER VORHANDEN"
