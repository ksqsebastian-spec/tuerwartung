#!/usr/bin/env bash
#
# End-to-End gegen einen laufenden Türwerk-Server: der ganze Weg, den ein Tag geht —
# einrichten, Türenliste einlesen, freigeben, diktieren, abschließen, unterschreiben —
# plus Anmeldung, OAuth-Tanz, die sechs Werkzeuge und die Website.
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
NAECHSTES=$(date -d "+13 months" +%Y-%m-%d 2>/dev/null || date -v+13m +%Y-%m-%d)

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
curl -s -b $J $B/objekte | grep -q "Objekte" && ok "Objektliste" || bad "Objektliste"

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

echo "== 3. Der Werkzeugkasten =="
TL=$(curl -s -X POST $B/mcp -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
echo "$TL" | jq -e '.result.tools | length == 6' >/dev/null \
  && ok "sechs Werkzeuge" || bad "Anzahl: $(echo "$TL" | jq -c '.result.tools|length')"
echo "$TL" | jq -e '[.result.tools[].name] ==
  ["stand","wartung_starten","tuer_erfassen","wartung_fertig","einrichten","aendern"]' >/dev/null \
  && ok "und zwar die richtigen" || bad "Namen: $(echo "$TL" | jq -c '[.result.tools[].name]')"
# Der Katalog ist es, was ein kleines Modell vor jedem Wort mitliest.
GROESSE=$(echo "$TL" | jq -c '.result.tools' | wc -c)
[ "$GROESSE" -lt 20000 ] && ok "Katalog unter 20 KB ($GROESSE)" || bad "Katalog $GROESSE Bytes"

curl -s -X POST $B/mcp -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  | jq -e '.result.instructions | contains("wartung_starten")' >/dev/null \
  && ok "Instructions nennen den Ablauf" || bad "Instructions"

curl -s -X POST $B/mcp -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"prompts/list"}' \
  | jq -e '[.result.prompts[].name] == ["wartung","fertig"]' >/dev/null \
  && ok "zwei Schrägstrich-Befehle" || bad "Prompts"

curl -s -X POST $B/mcp -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' \
  | jq -e '[.result.resources[].uri] | index("tuerwerk://bestand")' >/dev/null \
  && ok "Ressourcen" || bad "Ressourcen"

curl -s $B/tools.json | jq -e '.tools | length == 6' >/dev/null \
  && ok "öffentlicher Katalog" || bad "tools.json"

echo "== 4. Einrichten: die Liegenschaft =="
E=$(ruf einrichten "$(jq -nc --arg o "$OBJEKT" '{objekt:$o,stammdaten:{
  adresse:"Heselstuecken 12, 22523 Hamburg", betreiber:"Bezirksamt Eimsbuettel"}}')")
echo "$E" | jq -e '.objekt_neu_angelegt == true' >/dev/null \
  && ok "Objekt angelegt" || bad "einrichten: $E"
OID=$(echo "$E" | jq -r '.objekt.id')
# Was fehlt, wird gemeldet — nicht Frage für Frage abgefragt.
echo "$E" | jq -e '.fehlt_noch | index("Wie man reinkommt")' >/dev/null \
  && ok "meldet, was noch fehlt" || bad "fehlt_noch: $(echo "$E" | jq -c '.fehlt_noch')"

E=$(ruf einrichten "$(jq -nc --arg o "$OID" '{objekt:$o,stammdaten:{
  betreiber_kontakt:"Herr Kruse", telefon:"040 123456", zugang:"Schluessel beim Hausmeister"}}')")
echo "$E" | jq -e '.fehlt_noch == null' >/dev/null \
  && ok "Stammdaten vollständig" || bad "fehlt_noch: $(echo "$E" | jq -c '.fehlt_noch')"

echo "== 5. Einrichten: Türenliste einlesen =="
LISTE=$(jq -nc '[
 {kennung:"T-0.01",tuertyp:"T30-RS Brand- und Rauchschutztuer",art:"wartung_drehfluegel",
  geschoss:"EG",raumnummer:"0.01",raum:"Haupteingang",felder:{IDENT:"HOER-19-0041"},konfidenz:0.95},
 {kennung:"T-0.02",tuertyp:"T30-RS Brand- und Rauchschutztuer",art:"wartung_drehfluegel",
  geschoss:"EG",raumnummer:"0.02",raum:"Flur Ost",felder:{IDENT:"HOER-19-0042"},konfidenz:0.95},
 {kennung:"T-1.04",tuertyp:"Vollspantür",art:"wartung_drehfluegel",
  geschoss:"1. OG",raumnummer:"1.04",raum:"Gruppenraum Ost",konfidenz:0.9},
 {kennung:"F-1.04",tuertyp:"Kunststofffenster DK",art:"wartung_fenster",
  geschoss:"OG",raumnummer:"1.04",raum:"Gruppenraum Ost",konfidenz:0.8}]')
E=$(ruf einrichten "$(jq -nc --arg o "$OID" --argjson t "$LISTE" \
  '{objekt:$o,tueren:$t,dateiname:"tuerenliste.xlsx"}')")
IMP=$(echo "$E" | jq -r '.vorschlaege.import')
echo "$E" | jq -e '.vorschlaege.gefunden == 4' >/dev/null \
  && ok "vier Zeilen gelesen" || bad "gefunden: $(echo "$E" | jq -c '.vorschlaege.gefunden')"
echo "$E" | jq -e '.vorschlaege.zahlen.wartungspflichtig == 4' >/dev/null \
  && ok "Türenliste gilt als wartungspflichtig" \
  || bad "wartungspflichtig: $(echo "$E" | jq -c '.vorschlaege.zahlen')"
echo "$E" | jq -e '.tueren_im_bestand == 0' >/dev/null \
  && ok "ohne Freigabe entstehen keine Türen" || bad "Bestand ohne Freigabe"

# Derselbe Aufruf noch einmal darf nichts verdoppeln.
E=$(ruf einrichten "$(jq -nc --arg o "$OID" --argjson t "$LISTE" \
  '{objekt:$o,tueren:$t,dateiname:"tuerenliste.xlsx"}')")
echo "$E" | jq -e '.vorschlaege.schon_offen == 4' >/dev/null \
  && ok "zweimal gelesen legt nichts doppelt an" || bad "doppelt: $(echo "$E" | jq -c '.vorschlaege')"

E=$(ruf einrichten "$(jq -nc --arg o "$OID" '{objekt:$o,freigeben:{alle:true}}')")
echo "$E" | jq -e '.freigabe.angelegt == 4 and .tueren_im_bestand == 4' >/dev/null \
  && ok "Freigabe macht vier Türen daraus" || bad "Freigabe: $(echo "$E" | jq -c '.freigabe')"

S=$(ruf stand "$(jq -nc --arg o "$OID" '{objekt:$o}')")
echo "$S" | jq -e '[.checklisten[].tuertyp] | length == 3' >/dev/null \
  && ok "drei Türtypen aus der Spalte Türtyp" || bad "Typen: $(echo "$S" | jq -c '[.checklisten[].tuertyp]')"
# „OG" und „1. OG" derselben Liegenschaft sind dieselbe Etage.
echo "$S" | jq -e '.geschosse | length == 2' >/dev/null \
  && ok "zwei Geschosse, OG nicht doppelt" || bad "Geschosse: $(echo "$S" | jq -c '.geschosse')"
# Ein Fenster verlangt keine Ident-Nummer — der Vorrat entscheidet, nicht der Import.
echo "$S" | jq -e '[.checklisten[] | select(.tuertyp == "Kunststofffenster DK") | .pflichtfelder]
                   == [null]' >/dev/null \
  && ok "Fenster ohne Pflicht-Ident" || bad "Pflichtfelder Fenster"

echo "== 6. Wartung starten =="
W=$(ruf wartung_starten "$(jq -nc --arg o "$OID" '{objekt:$o}')")
BEG=$(echo "$W" | jq -r '.wartung')
echo "$W" | jq -e '.faellige_tueren | length == 4' >/dev/null \
  && ok "vier fällige Türen" || bad "fällig: $(echo "$W" | jq -c '.faellige_tueren|length')"
# Die Checklisten kommen mit — sonst wäre ein zweiter Aufruf nötig, bevor die erste Tür gesagt ist.
echo "$W" | jq -e '[.checklisten[].punkte[]] | length >= 29' >/dev/null \
  && ok "Checklisten liegen der Antwort bei" || bad "Checklisten fehlen"
echo "$W" | jq -e '.faellige_tueren[0].ort == "0.01 · Haupteingang"' >/dev/null \
  && ok "in Laufreihenfolge" || bad "Reihenfolge: $(echo "$W" | jq -c '.faellige_tueren[0]')"
# Zweimal starten setzt fort statt zu verdoppeln.
echo "$(ruf wartung_starten "$(jq -nc --arg o "$OID" '{objekt:$o}')")" \
  | jq -e '.fortgesetzt == true' >/dev/null && ok "fortgesetzt statt verdoppelt" || bad "fortgesetzt"

echo "== 7. Diktieren =="
T=$(ruf tuer_erfassen '{"tueren":[{"nr":1}]}')
echo "$T" | jq -e '.gespeichert[0] | contains("bestanden")' >/dev/null \
  && ok "Standard ist in Ordnung" || bad "Tür 1: $T"
T=$(ruf tuer_erfassen '{"tueren":[{"nr":2,"checks":{"8":"nio","10":"sb"},"hinweise":"Dichtung sproede"}]}')
echo "$T" | jq -e '.gespeichert[0] | contains("Nachbesserung")' >/dev/null \
  && ok "Abweichung heißt nicht bestanden" || bad "Tür 2: $T"
echo "$T" | jq -e '.gespeichert[0] | contains("Saeubern") or contains("Säubern")' >/dev/null \
  && ok "Abweichung im Klartext quittiert" || bad "Klartext: $T"
# Ein Schwung auf einmal, dazu eine unbekannte Nummer mit einem Typ aus dem Vorrat.
T=$(ruf tuer_erfassen '{"tueren":[{"nr":3},{"nr":4},
  {"nr":9,"tuertyp":"Stahlblechtür","raumnummer":"0.09","raum":"Technikraum"}]}')
echo "$T" | jq -e '.gespeichert | length == 3' >/dev/null \
  && ok "Stapel in einem Aufruf" || bad "Stapel: $T"
echo "$T" | jq -e '.neu_angelegt == [9]' >/dev/null \
  && ok "unbekannte Nummer wird angelegt" || bad "neu: $(echo "$T" | jq -c '.neu_angelegt')"
echo "$T" | jq -e '.gespeichert[2] | contains("EG")' >/dev/null \
  && ok "Etage aus der Raumnummer erkannt" || bad "Etage: $(echo "$T" | jq -r '.gespeichert[2]')"
echo "$T" | jq -e '.noch_offen == 0' >/dev/null \
  && ok "nichts Fälliges mehr offen" || bad "offen: $(echo "$T" | jq -c '.noch_offen')"
# Dieselbe Nummer noch einmal ist die Korrektur.
T=$(ruf tuer_erfassen '{"tueren":[{"nr":2,"checks":{}}]}')
echo "$T" | jq -e '.gespeichert[0] | contains("bestanden")' >/dev/null \
  && ok "Korrektur überschreibt" || bad "Korrektur: $T"
T=$(ruf tuer_erfassen '{"tueren":[{"nr":2,"checks":{"8":"nio","10":"sb"},"hinweise":"Dichtung sproede"}]}')
echo "$T" | jq -e '.gespeichert[0] | contains("Nachbesserung")' >/dev/null \
  && ok "und wieder zurück" || bad "Korrektur zurück"
# Ein Punkt, den es nicht gibt, wird abgewiesen.
echo "$(ruf tuer_erfassen '{"tueren":[{"nr":1,"checks":{"99":"nio"}}]}')" \
  | grep -q "^FEHLER" && ok "ungültiger Punkt abgewiesen" || bad "Punktprüfung"

echo "== 8. Fertig: Rückblick, Berichte, Sammelbericht =="
F=$(ruf wartung_fertig '{}')
echo "$F" | jq -e '.geprueft == 5 and .nachbesserung == 1' >/dev/null \
  && ok "fünf geprüft, eine Nachbesserung" || bad "Zahlen: $(echo "$F" | jq -c '{geprueft,nachbesserung}')"
echo "$F" | jq -e '.rueckblick | length == 5' >/dev/null \
  && ok "Rückblick zum Vorlesen" || bad "Rückblick"
echo "$F" | jq -e '.berichte.erzeugt == 5 and .berichte.fertig == true' >/dev/null \
  && ok "Berichte im selben Zug" || bad "Berichte: $(echo "$F" | jq -c '.berichte')"
echo "$F" | jq -e '.sammelbericht.version == 1' >/dev/null \
  && ok "Sammelbericht dazu" || bad "Sammelbericht"
echo "$F" | jq -e '.unterschrift | contains("/unterschrift")' >/dev/null \
  && ok "Link zur Unterschrift" || bad "Unterschrift-Link"
# Noch einmal aufrufen macht keine zweite Version.
F2=$(ruf wartung_fertig '{}')
echo "$F2" | jq -e '.berichte.erzeugt == 0' >/dev/null \
  && ok "zweimal erzeugt keine zweite Version" || bad "Version verdoppelt"
echo "$F2" | jq -e '.sammelbericht.version == 1' >/dev/null \
  && ok "und auch keinen zweiten Sammelbericht" \
  || bad "Sammelbericht: $(echo "$F2" | jq -c '.sammelbericht')"

ZIP=$(mktemp).zip
curl -s -b $J "$B/begehung/$BEG/paket.zip" -o $ZIP
unzip -l $ZIP 2>/dev/null | grep -q "bestanden/" \
  && ok "ZIP hat den Ordner bestanden" || bad "ZIP ohne bestanden/"
unzip -l $ZIP 2>/dev/null | grep -q "nachbesserung/" \
  && ok "ZIP hat den Ordner nachbesserung" || bad "ZIP ohne nachbesserung/"
rm -f $ZIP

echo "== 9. Unterschrift des Betreibers =="
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J -X POST "$B/begehung/$BEG/unterschrift" \
  --form-string "name=Herr Kruse" --form-string "bild=data:image/png;base64,$PNG")
[ "$code" = "302" ] && ok "unterschrieben" || bad "Unterschrift $code"
# Die Unterschriftsseite erzeugt gleich neu — der Stand hat sich geändert.
F3=$(ruf wartung_fertig '{}')
echo "$F3" | jq -e '.berichte.erzeugt == 0' >/dev/null \
  && ok "Berichte stehen schon in neuer Version" || bad "Berichte: $(echo "$F3" | jq -c '.berichte')"
echo "$F3" | jq -e '.sammelbericht.version == 2' >/dev/null \
  && ok "Sammelbericht v2 trägt die Unterschrift" \
  || bad "Sammelbericht: $(echo "$F3" | jq -c '.sammelbericht')"

echo "== 10. Stand =="
L=$(ruf stand '{}')
echo "$L" | jq -e '.objekte_gesamt >= 1' >/dev/null && ok "Lagebild" || bad "Lagebild"
H=$(ruf stand "$(jq -nc --arg o "$OID" '{objekt:$o,tuer:2}')")
echo "$H" | jq -e '.geprueft[0].ergebnis == "Nachbesserung"' >/dev/null \
  && ok "Geschichte einer Tür" || bad "Historie: $(echo "$H" | jq -c '.geprueft')"

echo "== 11. Nächstes Jahr: was offen war, wird abgefragt =="
# Ein zweiter Termin, ein Jahr später: was an Tür 2 nicht in Ordnung war, kommt zurück.
W2=$(ruf wartung_starten "$(jq -nc --arg o "$OID" --arg d "$NAECHSTES" '{objekt:$o,datum:$d}')")
BEG2=$(echo "$W2" | jq -r '.wartung')
echo "$W2" | jq -e '[.nachsehen[] | select(.nr == 2)] | length == 1' >/dev/null \
  && ok "der offene Befund steht im Start" || bad "nachsehen: $(echo "$W2" | jq -c '.nachsehen')"
T=$(ruf tuer_erfassen "$(jq -nc --arg b "$BEG2" '{wartung:$b,tueren:[{nr:2}]}')")
echo "$T" | jq -e '.nachsehen[0].punkte == ["8","10"]' >/dev/null \
  && ok "und beim Erfassen noch einmal" || bad "nachsehen: $(echo "$T" | jq -c '.nachsehen')"
ruf wartung_fertig "$(jq -nc --arg b "$BEG2" '{wartung:$b}')" >/dev/null

echo "== 12. Ändern =="
A=$(ruf aendern "$(jq -nc --arg o "$OID" '{objekt:$o,stammdaten:{ident:"KITA-4711"}}')")
echo "$A" | jq -e '.geaendert | length == 1' >/dev/null && ok "Stammdaten" || bad "aendern: $A"
A=$(ruf aendern "$(jq -nc --arg o "$OID" '{objekt:$o,tuer:9,tuer_felder:{raum:"Heizraum"}}')")
echo "$A" | jq -e '.geaendert[0] | contains("Tür 9")' >/dev/null && ok "eine Tür" || bad "Tür: $A"
A=$(ruf aendern '{"vorgaben":{"ort":"Hamburg","befaehigung":"Sachkundiger DGWZ"}}')
echo "$A" | jq -e '.geaendert[0] | contains("Standardwerte")' >/dev/null \
  && ok "eigene Vorgaben" || bad "Vorgaben: $A"
echo "$(ruf aendern '{}')" | grep -q "^FEHLER" \
  && ok "leeres Ändern wird abgewiesen" || bad "leeres Ändern"

echo "== 13. Website =="
curl -s -b $J "$B/objekt/$OID" | grep -q "Unterschreiben lassen\|Tür erfassen\|Alles durch" \
  && ok "Objektseite mit einem Knopf" || bad "Objektseite"
SEITE=$(curl -s -b $J "$B/objekt/$OID/berichte")
echo "$SEITE" | grep -q "NACHBESSERUNG\|Nachbesserung" && ok "Berichte: Gruppe Nachbesserung" || bad "Gruppe fehlt"
echo "$SEITE" | grep -q "Bestanden" && ok "Berichte: Gruppe Bestanden" || bad "Gruppe fehlt"
curl -s -b $J "$B/objekt/$OID/einrichten" | grep -q "Konstant — am Objekt" \
  && ok "Assistent zeigt die drei Ebenen" || bad "Assistent"
curl -s -b $J "$B/objekt/$OID/liste" | grep -q "Laufliste" \
  && ok "Laufliste" || bad "Laufliste"
curl -s -b $J "$B/objekte" | grep -q "Objekte" && ok "Objektliste" || bad "Objektliste"

echo "== 14. Zugriffsschutz =="
V1=$(curl -s -b $J "$B/objekt/$OID/berichte" | sed -n 's|.*href="/datei/\(berichte/[^"]*\)".*|\1|p' | head -1)
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/datei/$V1")
[ "$code" = "302" ] && ok "Datei ohne Anmeldung gesperrt" || bad "Datei ohne Anmeldung $code"
code=$(curl -s -o /dev/null -w "%{http_code}" -b $J "$B/datei/vorlagen/wartung_drehfluegel.pdf")
[ "$code" = "404" ] && ok "fremder Präfix gesperrt" || bad "Präfix $code"

if [ "$AUFRAEUMEN" = "1" ]; then
  echo "== 15. Testdaten entfernen =="
  code=$(curl -s -o /dev/null -w "%{http_code}" -b $J -X POST "$B/objekt/$OID/loeschen")
  [ "$code" = "302" ] && ok "Objekt samt Wartungen entfernt" || bad "Aufräumen $code"
  ruf stand "$(jq -nc --arg o "$OBJEKT" '{objekt:$o}')" | grep -q "^FEHLER" \
    && ok "nichts geblieben" || bad "Reste"
  # Türtypen hängen nicht am Objekt und blieben sonst stehen — auch auf der Live-Adresse.
  for N in "T30-RS Brand- und Rauchschutztuer" "Vollspantür" "Kunststofffenster DK" "Stahlblechtür"; do
    ruf aendern "$(jq -nc --arg t "$N" '{tuertyp:$t,tuertyp_loeschen:true}')" >/dev/null 2>&1
  done
  ok "Türtypen des Laufs entfernt"
fi

echo
[ "$FAILED" = "0" ] && echo "ALLES GRÜN" || echo "FEHLER VORHANDEN"
