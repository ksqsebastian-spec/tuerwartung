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
zufall() { head -c 16 /dev/urandom | od -An -tx1 | tr -d " \n"; }
ok()  { echo "  OK   $1"; }
bad() { echo "  FEHL $1"; FAILED=1; }

STEMPEL=$(date +%H%M%S)-$RANDOM
OBJEKT="E2E Kita Heselstuecken $STEMPEL"
VORJAHR=$(date -d "-13 months" +%Y-%m-%d 2>/dev/null || date -v-13m +%Y-%m-%d)
HEUTE=$(date +%Y-%m-%d)

# Ein 1×1-PNG als Unterschrift — es geht um den Weg, nicht um das Bild.
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

# Ein winziges, gültiges JPEG als Foto — pdf-lib muss es einbetten können.
JPG="/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4p\
LSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09P\
T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgADADASIA\
AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA\
AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3\
ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm\
p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA\
AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx\
BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK\
U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3\
uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDCs7S2\
ls57q7uJYkikSMCKESElgx7suPufrTvK0j/n+vv/AADT/wCO0Q/8i/ef9fUH/oE1UK97Vt6nAX/K\
0j/n+vv/AADT/wCO0eVpH/P9ff8AgGn/AMdqhRT5X3FfyL/laR/z/X3/AIBp/wDHabeWltFZwXVp\
cSypLI8ZEsIjIKhT2Zs/f/SqVX5v+Rfs/wDr6n/9AhpaprUYQ/8AIv3n/X1B/wCgTVQq7Z3dtFZz\
2t3byypLIkgMUwjIKhh3Vs/f/SnebpH/AD433/gYn/xqjVN6AUKKv+bpH/Pjff8AgYn/AMao83SP\
+fG+/wDAxP8A41T5n2FbzKFX5v8AkX7P/r6n/wDQIaPN0j/nxvv/AAMT/wCNU28u7aWzgtbS3liS\
KR5CZZhISWCjsq4+5+tLVtaDP//Z"
FOTO=$(mktemp).jpg
printf '%s' "$JPG" | base64 -d > $FOTO

echo "== 1. Anmeldung =="
code=$(curl -s -o /dev/null -w "%{http_code}" -c $J -X POST $B/anmeldung \
  -d "benutzer=$BENUTZER" -d "passwort=$PASSWORT")
[ "$code" = "302" ] && ok "Login 302" || bad "Login $code"
grep -q tw_sitzung $J && ok "Sitzungs-Cookie gesetzt" || bad "kein Cookie"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST $B/anmeldung -d "benutzer=$BENUTZER" -d "passwort=garantiert-falsch")
[ "$code" = "200" ] && ok "Falsches Passwort -> Formular" || bad "Falsches Passwort $code"

code=$(curl -s -o /dev/null -w "%{http_code}" $B/objekte)
[ "$code" = "302" ] && ok "Ohne Cookie umgeleitet" || bad "Ohne Cookie $code"
curl -s -b $J $B/objekte | grep -q "sonst legt der Chat es an" && ok "Objektliste" || bad "Objektliste"

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

# Ein Aufruf, alles fertig: Rückblick, Berichte und Sammelbericht.
A=$(ruf begehung_abschliessen "$(jq -nc --arg b "$BEG1" '{begehung:$b}')")
echo "$A" | jq -e '.pruefungen_gesamt == 3 and .nachbesserung == 1' >/dev/null \
  && ok "Rückblick: 3 Prüfungen, 1 Nachbesserung" || bad "Rückblick"
echo "$A" | jq -e '.berichte.erzeugt == 3 and .berichte.fertig == true' >/dev/null \
  && ok "Abschluss erzeugt die Berichte gleich mit" || bad "Abschluss ohne Berichte: $A"
echo "$A" | jq -e '.sammelbericht.version == 1' >/dev/null \
  && ok "und den Sammelbericht" || bad "kein Sammelbericht"
echo "$A" | jq -e '.alle_als_zip | endswith("/paket.zip")' >/dev/null \
  && ok "ZIP-Link dabei" || bad "ZIP-Link"

echo "== 6. Versionierte Berichte =="
BER=$(ruf berichte_auflisten "$(jq -nc --arg b "$BEG1" '{begehung:$b}')")
V1=$(echo "$BER" | jq -r '.berichte[] | select(.nr == 1) | .link' | sed 's#.*/datei/##')
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
echo "$S" | jq -e '.version >= 1 and .enthaltene_berichte == 3 and .seiten >= 4' >/dev/null \
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

echo "== 11. Website: die vier Reiter am Objekt =="
curl -s -b $J "$B/objekt/$OID" | grep -q "Bestand" && ok "Reiter Bestand" || bad "Reiter Bestand"
curl -s -b $J "$B/objekt/$OID/checkliste" | grep -q "Checkliste" && ok "Reiter Checkliste" || bad "Reiter Checkliste"
curl -s -b $J "$B/objekt/$OID/maengel" | grep -q "Dichtung" && ok "Reiter Mängel" || bad "Reiter Mängel"
curl -s -b $J "$B/objekt/$OID/berichte" | grep -q "Prüfungen" && ok "Reiter Berichte" || bad "Reiter Berichte"
# Der Termin kommt in der Oberfläche nicht mehr vor — alte Adressen führen aufs Objekt.
ZIEL=$(curl -s -o /dev/null -w "%{redirect_url}" -b $J "$B/begehung/$BEG2")
echo "$ZIEL" | grep -q "/objekt/$OID" && ok "alte Begehungsadresse leitet aufs Objekt" || bad "Weiterleitung: $ZIEL"
curl -s -b $J "$B/objekt/$OID" | grep -qv "Begehung fortsetzen" && ok "kein Knopf für den Termin" || bad "Termin noch sichtbar"
curl -s -b $J "$B/maengel?status=alle" | grep -q "Dichtung" && ok "Mängelseite" || bad "Mängelseite"
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J -X POST "$B/begehung/$BEG2/pruefung/3" \
  -d "ergebnis=Nachbesserung" -d "hinweise=Aus dem Browser" -d "p_1=io" -d "p_4=nio" -d "raum=Flur 3")
[ "$code" = "302" ] && ok "Prüfraster speichert" || bad "Prüfraster $code"
ruf bauteil_lesen "$(jq -nc --arg o "$OID" '{objekt:$o,nr:3}')" \
  | jq -e '.bauteil.offene_maengel == 1' >/dev/null && ok "Mangel aus dem Formular" || bad "Formular-Mangel"

echo "== 12. Rundgang ohne Netz =="
curl -s -b $J "$B/api/rundgang/$BEG2" \
  | jq -e '.bauteile | length == 3 and (.[0] | has("letzte") and has("maengel"))' >/dev/null \
  && ok "Rundgang-Daten vollständig" || bad "Rundgang-Daten"
curl -s -o /dev/null -w "%{http_code}" "$B/sw.js" | grep -q 200 && ok "Service Worker öffentlich" || bad "sw.js"
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/api/rundgang/$BEG2")
[ "$code" = "401" ] && ok "API ohne Anmeldung 401" || bad "API anonym $code"

# Was der Client offline gesammelt hätte: zwei Prüfungen und eine unbekannte Tür auf einer
# Nummer, die inzwischen belegt ist.
OP1=$(zufall); OP2=$(zufall); OP3=$(zufall)
# Client-Zeit: eine Minute nach jetzt, damit sie die im Browser erfasste Prüfung schlägt.
JETZT=$(( $(date +%s) * 1000 + 60000 ))
SYNC=$(curl -s -b $J -X POST "$B/api/sync" -H 'content-type: application/json' -d "$(jq -nc \
  --arg b "$BEG2" --arg o1 "$OP1" --arg o2 "$OP2" --arg o3 "$OP3" --arg t "$JETZT" '{begehung:$b,ops:[
   {op_id:$o1,art:"pruefung",payload:{nr:1,checks:{"2":"nio"},ergebnis:"Nachbesserung",hinweise:"Offline erfasst",geprueft_am:($t|tonumber)}},
   {op_id:$o2,art:"bauteil_neu",payload:{nr:2,art:"wartung_drehfluegel",raum:"Im Rundgang gefunden"}},
   {op_id:$o3,art:"pruefung",payload:{nr:2,checks:{},ergebnis:"bestanden",geprueft_am:(($t|tonumber)+1000)}}]}')")
echo "$SYNC" | jq -e '[.ergebnisse[].ok] | all' >/dev/null && ok "Warteschlange angekommen" || bad "Sync: $SYNC"
NEUE=$(echo "$SYNC" | jq -r '.ergebnisse[1].zuordnung.server_nr')
[ "$NEUE" = "4" ] && ok "belegte Nummer umgelegt auf $NEUE" || bad "Zuordnung: $NEUE"
echo "$SYNC" | jq -e '.ergebnisse[2].bauteil_nr == 4' >/dev/null \
  && ok "Folgeprüfung zieht die neue Nummer mit" || bad "Umlegung wirkt nicht"

WDH=$(curl -s -b $J -X POST "$B/api/sync" -H 'content-type: application/json' -d "$(jq -nc \
  --arg b "$BEG2" --arg o1 "$OP1" '{begehung:$b,ops:[{op_id:$o1,art:"pruefung",payload:{nr:1,checks:{},ergebnis:"bestanden"}}]}')")
echo "$WDH" | jq -e '.ergebnisse[0].doppelt == true' >/dev/null \
  && ok "dieselbe op_id ändert nichts" || bad "Idempotenz: $WDH"
ruf bauteil_lesen "$(jq -nc --arg o "$OID" '{objekt:$o,nr:1}')" \
  | jq -e '.pruefungen[0].abweichungen | length == 1' >/dev/null \
  && ok "Wiederholung hat nichts überschrieben" || bad "Wiederholung wirkte doch"

ALT=$(curl -s -b $J -X POST "$B/api/sync" -H 'content-type: application/json' -d "$(jq -nc \
  --arg b "$BEG2" --arg o "$(zufall)" '{begehung:$b,ops:[{op_id:$o,art:"pruefung",payload:{nr:1,checks:{},ergebnis:"bestanden",geprueft_am:1000}}]}')")
echo "$ALT" | jq -e '.ergebnisse[0].konflikt == "aelter"' >/dev/null \
  && ok "ältere Erfassung verliert" || bad "Konflikt: $ALT"
NEU=$(curl -s -b $J -X POST "$B/api/sync" -H 'content-type: application/json' -d "$(jq -nc \
  --arg b "$BEG2" --arg o "$(zufall)" '{begehung:$b,ops:[{op_id:$o,art:"pruefung",payload:{nr:1,checks:{"5":"nio"},ergebnis:"Nachbesserung",geprueft_am:4102444800000}}]}')")
echo "$NEU" | jq -e '.ergebnisse[0].konflikt == null' >/dev/null \
  && ok "jüngere Erfassung gewinnt" || bad "jüngere verworfen: $NEU"

echo "== 13. Foto =="
F=$(curl -s -b $J -X POST "$B/api/foto" -F "op_id=$(zufall)" -F "begehung_id=$BEG2" \
  -F "bauteil_nr=4" -F "breite=48" -F "hoehe=32" -F "bild=@$FOTO;type=image/jpeg")
echo "$F" | jq -e '.ok == true and (.foto | length > 0)' >/dev/null && ok "Foto angenommen" || bad "Foto: $F"
FKEY=$(echo "$F" | jq -r .link | sed 's#^/datei/##')
typ=$(curl -s -o /dev/null -w "%{content_type}" -b $J "$B/datei/$FKEY")
echo "$typ" | grep -q image && ok "Foto abrufbar" || bad "Foto-Typ $typ"
ruf bauteil_lesen "$(jq -nc --arg o "$OID" '{objekt:$o,nr:4}')" \
  | jq -e '.fotos | length == 1' >/dev/null && ok "Foto hängt am Bauteil" || bad "Foto am Bauteil"
ruf berichte_erzeugen "$(jq -nc --arg b "$BEG2" '{begehung:$b}')" >/dev/null
ruf berichte_auflisten "$(jq -nc --arg b "$BEG2" '{begehung:$b}')" \
  | jq -e '[.berichte[] | select(.nr == 4) | .seiten] == [2]' >/dev/null \
  && ok "Bericht mit Fotoanhang (2 Seiten)" || bad "Fotoanhang fehlt"

echo "== 13a. Einstufung bestimmt die Frist =="
PB=$(ruf begehung_starten "$(jq -nc --arg o "E2E Einstufung $STEMPEL" '{objekt:$o}')" | jq -r .begehung.id)
ruf pruefung_erfassen "$(jq -nc --arg b "$PB" '{begehung:$b,nr:1,checks:{"3":"nio"},hinweise:"Brandschutztuer schliesst nicht",prioritaet:"hoch"}')" \
  | jq -e '.mangel_angelegt.prioritaet == "hoch"' >/dev/null && ok "hoch übernommen" || bad "Einstufung hoch"
ruf pruefung_erfassen "$(jq -nc --arg b "$PB" '{begehung:$b,nr:2,checks:{"7":"nio"},prioritaet:"niedrig",zustaendig:"Betreiber"}')" \
  | jq -e '.mangel_angelegt.zustaendig == "Betreiber"' >/dev/null && ok "Zuständigkeit übernommen" || bad "zustaendig"
ruf pruefung_erfassen "$(jq -nc --arg b "$PB" '{begehung:$b,nr:3,checks:{"9":"nio"}}')" \
  | jq -e '.mangel_angelegt.prioritaet == "mittel"' >/dev/null && ok "ohne Angabe mittel" || bad "Standardeinstufung"
# 7 / 28 / 90 Tage — die Fristen müssen auseinanderliegen und in dieser Ordnung stehen.
ruf maengel_auflisten "$(jq -nc --arg o "E2E Einstufung $STEMPEL" '{objekt:$o}')" \
  | jq -e '[.maengel[] | select(.bauteil_nr <= 3)] | sort_by(.bauteil_nr) | (.[0].frist < .[2].frist) and (.[2].frist < .[1].frist)' >/dev/null \
  && ok "Frist folgt der Einstufung (7 < 28 < 90)" || bad "Fristen"
# Eine Korrektur ohne Einstufung darf die gesetzte nicht zurücknehmen.
ruf pruefung_erfassen "$(jq -nc --arg b "$PB" '{begehung:$b,nr:1,checks:{"3":"nio"},hinweise:"Nachtrag"}')" >/dev/null
ruf maengel_auflisten "$(jq -nc --arg o "E2E Einstufung $STEMPEL" '{objekt:$o}')" \
  | jq -e '[.maengel[] | select(.bauteil_nr == 1)][0].prioritaet == "hoch"' >/dev/null \
  && ok "Korrektur nimmt die Einstufung nicht zurück" || bad "Einstufung überschrieben"
# Die erkannte Etage steht in der Quittung.
ruf pruefung_erfassen "$(jq -nc --arg b "$PB" '{begehung:$b,nr:4,raumnummer:"2.14",raum:"Lager",flur:"2. OG"}')" \
  | jq -e '.bauteil.geschoss == "2. OG" and .bauteil.ort == "2. OG · 2.14 · Lager"' >/dev/null \
  && ok "Etage in der Quittung, ohne Doppelung" || bad "Ort in der Quittung"
EIN_OID=$(ruf objekt_lesen "$(jq -nc --arg o "E2E Einstufung $STEMPEL" '{objekt:$o}')" | jq -r .objekt.id)
curl -s -o /dev/null -b $J -X POST "$B/objekt/$EIN_OID/loeschen"

echo "== 13b. Automatik: Lagebild, Tagesplanung, Abschluss in einem Zug =="
L=$(ruf lage '{}')
echo "$L" | jq -e '.zusammenfassung | length > 0' >/dev/null && ok "Lagebild" || bad "lage: $L"
echo "$L" | jq -e --arg o "$OID" '[.ueberfaellig[].id, .bald_faellig[].id] | index($o)' >/dev/null \
  && ok "zurückdatiertes Objekt taucht als fällig auf" || bad "lage sieht das fällige Objekt nicht"
echo "$L" | jq -e '.naechste_schritte | type == "array"' >/dev/null \
  && ok "nächste Schritte als Liste" || bad "naechste_schritte"
# Ein Mangel über der Frist muss auftauchen.
echo "$L" | jq -e --arg o "$OBJEKT" '[.maengel_ueber_frist[].objekt] | index($o)' >/dev/null \
  && ok "Mangel über der Frist gemeldet" || bad "Mangel über Frist fehlt"

# Ein Termin ohne Prüfung hat nichts zu berichten — das darf nicht scheitern.
LEER=$(ruf begehung_starten "$(jq -nc --arg o "E2E Leerprobe $STEMPEL" '{objekt:$o}')" | jq -r .begehung.id)
ruf begehung_abschliessen "$(jq -nc --arg b "$LEER" '{begehung:$b}')" \
  | jq -e '.berichte.fertig == true and .sammelbericht == null' >/dev/null \
  && ok "leerer Termin schließt ohne Fehler ab" || bad "leerer Abschluss"
LEER_OID=$(ruf objekt_lesen "$(jq -nc --arg o "E2E Leerprobe $STEMPEL" '{objekt:$o}')" | jq -r .objekt.id)
curl -s -o /dev/null -b $J -X POST "$B/objekt/$LEER_OID/loeschen"

# Ändert sich nach dem Erzeugen etwas, das im Bericht steht, muss das auffallen —
# sonst liegt beim Kunden ein PDF, das nicht mehr stimmt, und niemand weiß es.
ruf begehung_aendern "$(jq -nc --arg b "$BEG1" '{begehung:$b,beteiligte:"Herr Ohlsen, Messgeraet 4711"}')" >/dev/null
ruf berichte_auflisten "$(jq -nc --arg b "$BEG1" '{begehung:$b}')" \
  | jq -e '[.berichte[].veraltet] | all' >/dev/null \
  && ok "geänderter Stand macht die Berichte veraltet" || bad "veraltet nicht erkannt"
ruf lage '{}' | jq -e --arg b "$BEG1" '[.berichte_veraltet[].begehung_id] | index($b)' >/dev/null \
  && ok "Lagebild meldet die veralteten Berichte" || bad "lage übersieht veraltete Berichte"
ruf begehung_abschliessen "$(jq -nc --arg b "$BEG1" '{begehung:$b}')" \
  | jq -e '.berichte.erzeugt >= 1' >/dev/null && ok "Abschluss zieht sie nach" || bad "Nachziehen"
ruf lage '{}' | jq -e --arg b "$BEG1" '[.berichte_veraltet[].begehung_id] | index($b) | not' >/dev/null \
  && ok "danach ist nichts mehr veraltet" || bad "bleibt veraltet"

V=$(ruf tour_vorschlagen '{"anzahl":2}')
echo "$V" | jq -e '.uebernommen == false' >/dev/null && ok "Vorschlag ändert nichts" || bad "tour_vorschlagen: $V"
echo "$V" | jq -e '.objekte | type == "array"' >/dev/null && ok "Route berechnet" || bad "Route"

echo "== 13c. Prompts und Ressourcen =="
rpc() { curl -s -X POST $B/mcp -H "authorization: Bearer $AT" -H 'content-type: application/json' -d "$1"; }
rpc '{"jsonrpc":"2.0","id":1,"method":"prompts/list"}' \
  | jq -e '[.result.prompts[].name] | index("wartung") and index("tag") and index("abschluss") and index("bauplan")' >/dev/null \
  && ok "vier Prompts" || bad "prompts/list"
rpc '{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{"name":"wartung","arguments":{"objekt":"Kita X"}}}' \
  | jq -e '.result.messages[0].content.text | contains("Kita X")' >/dev/null \
  && ok "Prompt trägt das Argument" || bad "prompts/get"
rpc '{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{"name":"wartung","arguments":{}}}' \
  | jq -e '.error.code == -32602' >/dev/null && ok "Pflichtargument wird verlangt" || bad "Prompt ohne Argument"
rpc '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' \
  | jq -e '[.result.resources[].uri] | index("tuerwerk://bestand") and index("tuerwerk://anleitung/import")' >/dev/null \
  && ok "Ressourcen gelistet" || bad "resources/list"
rpc '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"tuerwerk://bestand"}}' \
  | jq -e --arg o "$OBJEKT" '.result.contents[0].text | contains($o)' >/dev/null \
  && ok "Bestand als Ressource lesbar" || bad "resources/read"
rpc '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"tuerwerk://pruefpunkte/wartung_drehfluegel"}}' \
  | jq -e '.result.contents[0].text | contains("Leichtgängigkeit")' >/dev/null \
  && ok "Prüfpunkte als Ressource" || bad "Prüfpunkte-Ressource"
rpc '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"tuerwerk://gibtsnicht"}}' \
  | jq -e '.error.code == -32602' >/dev/null && ok "unbekannte Ressource abgewiesen" || bad "Ressourcenfehler"

echo "== 14. Tagestour =="
T=$(ruf tour_planen "$(jq -nc --arg d "$HEUTE" --arg o "$OID" '{datum:$d,objekte:[$o]}')")
echo "$T" | jq -e '.objekte | length == 1' >/dev/null && ok "tour_planen" || bad "tour_planen: $T"
ruf tour_lesen "$(jq -nc --arg d "$HEUTE" '{datum:$d}')" \
  | jq -e '.maps | startswith("https://www.google.com/maps/dir/")' >/dev/null \
  && ok "Maps-Link" || bad "Maps-Link"
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J "$B/touren")
curl -s -b $J "$B/touren" | grep -q "Fällig" && ok "Tourenliste" || bad "Tourenliste"
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J -X POST "$B/touren" \
  -d "datum=$HEUTE" -d "objekt=$OID" -d "tun=weg")
[ "$code" = "302" ] && ok "Objekt aus der Tour genommen" || bad "Tour entfernen $code"

echo "== 14b. Etage entsteht beim Erfassen =="
# Der Regelweg ist das Diktat; früher blieb geschoss_id dabei immer leer und die
# Etagenordnung der Laufreihenfolge lief leer mit. Vier Wege müssen zur Etage führen.
GB=$(ruf begehung_starten "$(jq -nc --arg o "$OBJEKT" '{objekt:$o}')" | jq -r .begehung.id)
ruf pruefung_erfassen "$(jq -nc --arg b "$GB" '{begehung:$b,nr:41,raumnummer:"4.01",raum:"aus Raumnummer",flur:"Flur Nord"}')" >/dev/null
ruf pruefung_erfassen "$(jq -nc --arg b "$GB" '{begehung:$b,nr:42,raum:"aus ETAGE",felder:{ETAGE:"-1"}}')" >/dev/null
ruf pruefung_erfassen "$(jq -nc --arg b "$GB" '{begehung:$b,nr:43,raum:"aus flur",flur:"1. Obergeschoss"}')" >/dev/null
ruf pruefung_erfassen "$(jq -nc --arg b "$GB" '{begehung:$b,nr:44,raum:"ausdrücklich",geschoss:"DG"}')" >/dev/null
OL=$(ruf objekt_lesen "$(jq -nc --arg o "$OID" '{objekt:$o}')")
for G in "4. OG" "UG" "1. OG" "DG"; do
  echo "$OL" | jq -e --arg g "$G" '[.geschosse[].name] | index($g)' >/dev/null \
    && ok "Etage $G erkannt" || bad "Etage $G fehlt"
done
# "Flur Nord" ist ein Flur, keine Etage: es darf kein Geschoss dieses Namens geben.
echo "$OL" | jq -e '[.geschosse[].name] | index("Flur Nord") | not' >/dev/null \
  && ok "Flurname wird nicht zur Etage" || bad "Flur als Geschoss angelegt"
# Und zweimal dieselbe Etage bleibt eine.
ruf pruefung_erfassen "$(jq -nc --arg b "$GB" '{begehung:$b,nr:45,raum:"nochmal DG",geschoss:"Dachgeschoss"}')" >/dev/null
ruf objekt_lesen "$(jq -nc --arg o "$OID" '{objekt:$o}')" \
  | jq -e '[.geschosse[] | select(.name == "DG")] | length == 1' >/dev/null \
  && ok "gleiche Etage wird nicht verdoppelt" || bad "Etage verdoppelt"

echo "== 15. Bestand als Stapel =="
ST=$(ruf bauteile_anlegen "$(jq -nc --arg o "$OID" '{objekt:$o,geschoss:"2. OG",bauteile:[
 {kennung:"S-1",raumnummer:"2.01",raum:"Stapel eins",felder:{HERSTELLER:"Teckentrup"}},
 {kennung:"S-2",raumnummer:"2.02",raum:"Stapel zwei"},
 {nr:1,kennung:"S-3",raum:"Kollision"}]}')")
echo "$ST" | jq -e '.angelegt == 2' >/dev/null && ok "zwei Bauteile angelegt" || bad "Stapel: $ST"
echo "$ST" | jq -e '.uebersprungen[0].grund | contains("belegt")' >/dev/null \
  && ok "belegte Nummer übersprungen statt überschrieben" || bad "Kollision"
ruf objekt_lesen "$(jq -nc --arg o "$OID" '{objekt:$o}')" \
  | jq -e '[.geschosse[].name] | index("2. OG")' >/dev/null \
  && ok "Geschoss aus dem Stapel angelegt" || bad "Geschoss"
ruf bauteil_lesen "$(jq -nc --arg o "$OID" '{objekt:$o,kennung:"S-1"}')" \
  | jq -e '.bauteil.felder.HERSTELLER == "Teckentrup"' >/dev/null \
  && ok "Felder übernommen" || bad "Felder"

echo "== 16. Begehung abschließen und wieder öffnen =="
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J -X POST "$B/begehung/$BEG2/abschliessen")
[ "$code" = "302" ] && ok "abgeschlossen" || bad "abschliessen $code"
curl -s -b $J "$B/begehung/$BEG2/stand.json" | jq -e '.status == "abgeschlossen"' >/dev/null \
  && ok "Status steht" || bad "Status"
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J -X POST "$B/begehung/$BEG2/oeffnen")
[ "$code" = "302" ] && ok "wieder geöffnet" || bad "oeffnen $code"

echo "== 17. Bauplan-Import über den Agenten =="
ruf import_anleitung '{}' | jq -e '.anleitung | contains("Türwerk liest keine Pläne")' >/dev/null \
  && ok "Anleitung liegt bereit" || bad "Anleitung"
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J "$B/anleitung/import")
[ "$code" = "200" ] && ok "Anleitung als Seite" || bad "Anleitungsseite $code"

IPLAN=$(ruf import_starten "$(jq -nc --arg o "$OID" '{objekt:$o,art:"plan",dateiname:"EG.pdf",geschoss:"EG"}')" | jq -r .import)
[ -n "$IPLAN" ] && ok "Plan-Import $IPLAN" || bad "import_starten"
ruf vorschlaege_anlegen "$(jq -nc --arg i "$IPLAN" '{import:$i,kandidaten:[
 {kennung:"T-1.01",raumnummer:"1.01",raum:"Flur",x:0.2,y:0.3,konfidenz:0.9},
 {kennung:"T-1.02",raumnummer:"1.02",raum:"Buero",x:0.4,y:0.3,konfidenz:0.9},
 {kennung:"",raumnummer:"1.03",raum:"Lager",x:0.6,y:0.3,konfidenz:0.7}]}')" \
  | jq -e '.angelegt == 3 and .zahlen.mit_position == 3' >/dev/null \
  && ok "3 Plankandidaten mit Position" || bad "vorschlaege_anlegen"

ILISTE=$(ruf import_starten "$(jq -nc --arg o "$OID" '{objekt:$o,art:"tuerliste",dateiname:"Tuerliste.xlsx"}')" | jq -r .import)
ruf vorschlaege_anlegen "$(jq -nc --arg i "$ILISTE" '{import:$i,kandidaten:[
 {kennung:"T 1.01",raumnummer:"1.01",konfidenz:1.0,wartungspflichtig:true,felder:{ZULASSUNG:"T30-RS",HERSTELLER:"Hoermann"}},
 {kennung:"T-1.02",raumnummer:"1.02",konfidenz:1.0,wartungspflichtig:true,felder:{ZULASSUNG:"T90"}},
 {kennung:"",raumnummer:"1.03",konfidenz:1.0,felder:{HERSTELLER:"Schoerghuber"}},
 {kennung:"T-9.99",raumnummer:"9.99",raum:"Nur in der Liste",konfidenz:1.0}]}')" \
  | jq -e '.angelegt == 4' >/dev/null && ok "4 Listenzeilen" || bad "Türliste"

Z=$(ruf import_zusammenfuehren "$(jq -nc --arg l "$ILISTE" --arg p "$IPLAN" '{tuerliste:$l,plan:$p}')")
echo "$Z" | jq -e '.zusammengefuehrt == 3 and .ueber_kennung == 2 and .ueber_raumnummer == 1' >/dev/null \
  && ok "3 Paare: 2 über Kennung, 1 über Raumnummer" || bad "Zusammenführung: $Z"
echo "$Z" | jq -e '.nur_in_der_liste == 1 and .nur_im_plan == 0' >/dev/null \
  && ok "eine Listenzeile bleibt allein" || bad "Rest"

ruf vorschlaege_annehmen "$(jq -nc --arg i "$IPLAN" '{import:$i,ab_konfidenz:0.8}')" \
  | jq -e '.angelegt == 3' >/dev/null && ok "3 Bauteile aus dem Plan" || bad "Freigabe"
ruf bauteil_lesen "$(jq -nc --arg o "$OID" '{objekt:$o,kennung:"T-1.01"}')" \
  | jq -e '.bauteil.felder.ZULASSUNG == "T30-RS" and .bauteil.wartungspflichtig == true' >/dev/null \
  && ok "Listenfelder am Bauteil" || bad "Felder fehlen"

# Ohne Freigabe entsteht nichts: die allein gebliebene Zeile ist noch offen.
ruf vorschlaege_lesen "$(jq -nc --arg i "$ILISTE" '{import:$i}')" \
  | jq -e '[.vorschlaege[].kennung] == ["T-9.99"]' >/dev/null \
  && ok "unbestätigte Zeile bleibt Vorschlag" || bad "Rest der Liste"
ruf vorschlaege_verwerfen "$(jq -nc --arg i "$ILISTE" '{import:$i,unter_konfidenz:1.1}')" \
  | jq -e '.verworfen == 1' >/dev/null && ok "verwerfen" || bad "verwerfen"
ruf import_abschliessen "$(jq -nc --arg i "$IPLAN" '{import:$i}')" \
  | jq -e '.status == "bestaetigt"' >/dev/null && ok "Import abgeschlossen" || bad "abschliessen"

GID=$(ruf objekt_lesen "$(jq -nc --arg o "$OID" '{objekt:$o}')" | jq -r '.geschosse[] | select(.name=="EG") | .id')
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J "$B/objekt/$OID/plan/$GID")
[ "$code" = "200" ] && ok "Planseite" || bad "Planseite $code"
curl -s -b $J "$B/objekt/$OID/plan/$GID/daten.json" \
  | jq -e '[.bauteile[] | select(.x != null)] | length == 3' >/dev/null \
  && ok "drei verortete Bauteile auf der Karte" || bad "Karte"

echo "== 18. Zugriffsschutz =="
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/datei/$V1")
[ "$code" = "302" ] && ok "Datei ohne Anmeldung gesperrt" || bad "Datei ohne Anmeldung $code"
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J "$B/datei/vorlagen/wartung_drehfluegel.pdf")
[ "$code" = "404" ] && ok "fremder Präfix gesperrt" || bad "Präfix $code"
FEHL=$(ruf pruefung_erfassen "$(jq -nc --arg b "$BEG2" '{begehung:$b,nr:1,checks:{"99":"nio"}}')")
echo "$FEHL" | grep -q "^FEHLER" && ok "ungültiger Punkt abgewiesen" || bad "Punktprüfung"

if [ "$AUFRAEUMEN" = "1" ]; then
  echo "== 19. Testdaten entfernen =="
  code=$(curl -s -o /dev/null -w "%{http_code}" -b $J -X POST "$B/objekt/$OID/loeschen")
  [ "$code" = "302" ] && ok "Objekt samt Begehungen entfernt" || bad "Aufräumen $code"
  ruf objekte_auflisten "$(jq -nc --arg s "$OBJEKT" '{suche:$s}')" \
    | jq -e '.objekte | length == 0' >/dev/null && ok "nichts geblieben" || bad "Reste"
  ruf tour_planen "$(jq -nc --arg d "$HEUTE" '{datum:$d,objekte:[]}')" >/dev/null
  ok "Tour geräumt"
fi
rm -f $FOTO

echo
[ "$FAILED" = "0" ] && echo "ALLES GRÜN" || echo "FEHLER VORHANDEN"
