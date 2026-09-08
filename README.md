# Türwerk

Türenwartung für Seehafer Elemente.

Einmal einrichten, dann diktieren, dann liegen die Protokolle da. Ein Cloudflare Worker, der
drei Dinge ist:

1. **Arbeitsfläche im Browser** — Objekte mit ihrem Bestand, Türtypen mit ihren Checklisten,
   Berichte.
2. **OAuth-geschützter MCP-Server** — sechs Werkzeuge, über die Claude jede diktierte Tür sofort
   wegschreibt.
3. **Berichtsgenerator** — füllt die Formular-PDFs aus, versioniert sie und legt sie in R2 ab.

Alles an einer Adresse, eine Anmeldung: wer sich auf der Website anmeldet, verbindet damit auch
Claude.

## Das Modell in einem Absatz

**Der Türtyp steht vor allem, die Tür ist die feste Größe — nicht der Termin.** Ein **Türtyp**
trägt, was für alle Türen seiner Art gleich ist, und bringt **seine Checkliste** mit. Ein
**Objekt** (die Liegenschaft) trägt seine **Türen** — auch Fenster und Feststellanlagen —, jede
von einem Türtyp, und jede trägt ihre Geschichte über die Jahre. Eine **Wartung** ist ein Termin
an einem Objekt; sie erzeugt **Prüfungen** an Türen. Eine Abweichung heißt: die Tür hat nicht
bestanden — das bleibt an der Tür hängen und wird beim nächsten Mal abgefragt, auch über Jahre.
Aus jeder Prüfung entsteht ein **Bericht**, versioniert: ändert sich der Stand, entsteht eine
neue Version daneben; was beim Kunden liegt, bleibt genau so.

„Tür 12" meint deshalb die Tür Nr. 12 dieses Objekts — nächstes Jahr wieder dieselbe.

Diese drei Ebenen sind die ganze Ordnung, und der Einrichtungs-Assistent zeigt sie so:

| | steht am | Beispiel |
|---|---|---|
| **konstant** | Objekt | Adresse, Betreiber, Zugang, Intervall, Rechtsgrundlagen |
| **wiederholt** | Türtyp | Hersteller, Zulassung, die Prüfpunkte |
| **variabel** | Tür | Ident-Nummer, Raum, Etage, das Ergebnis |

## Wie es benutzt wird

**Vorher, im Büro** — `/objekt/<id>/einrichten`. Drei Schritte mit Haken:

1. **Die Liegenschaft.** Adresse, Betreiber, Ansprechpartner mit Telefon und vor allem **wie man
   reinkommt** („Schlüssel beim Hausmeister"). Das Feld, das die vergebliche Anfahrt verhindert.
2. **Die Türen.** Am schnellsten aus der Türenliste des Bauvorhabens: Datei in Claude hängen,
   „lies das ein". Claude liest sie, meldet die Zeilen über `einrichten`, liest den Bericht vor
   und holt die Freigabe — Türtypen, Geschosse, Nummern und Laufreihenfolge entstehen dabei von
   selbst. Ein ganzes Haus sind fünf Aufrufe statt achtzig. Ohne Freigabe entstehen keine Türen;
   das ist der Punkt, an dem ein Mensch entscheidet.
3. **Die Türtypen.** Was sich je Art wiederholt, samt Checkliste: Punkte umbenennen, ausblenden,
   eigene ergänzen. Einrichten muss man dafür nichts — die gängigen Typen liegen im **Vorrat**
   (T30, T30-RS, T90, Rauchschutz, Vollspan, Alu-Rohrrahmen, Feststellanlagen, Kunststoff-,
   Holz- und Alufenster) und entstehen beim ersten Gebrauch.

Am Ende steht die **Laufliste** (`/objekt/<id>/liste`): alle Türen in Laufreihenfolge, Geschoss
für Geschoss, dazu je Türtyp seine Prüfpunkte. Das ist, was vor Ort abgearbeitet wird.

**Vor Ort am Handy.** Der Monteur startet den Skill `tuerwerk-diktat` oder sagt `/wartung`,
nennt das Objekt und diktiert Tür für Tür. Standard ist „alles in Ordnung" — er nennt nur die
Ausnahmen: „Tür 6, Punkt 8 nicht." Jede Tür geht sofort in die Datenbank; bricht das Gespräch ab,
ist nichts verloren. Hing an einer Tür beim letzten Mal etwas offen, fragt Claude danach. Auf
„Fertig" liest Claude zurück, nennt die fälligen Türen die noch fehlen, erzeugt die Berichte und
den Sammelbericht und gibt den Link zur Unterschrift.

**Danach.** Die Berichte liegen auf der Objektseite, getrennt nach **bestanden** und
**Nachbesserung** — in der Ansicht und als zwei Ordner im ZIP. Der Betreiber unterschreibt auf
dem Handy unter `/begehung/<id>/unterschrift`; danach entstehen die Berichte in neuer Version,
mit Unterschrift und Klarnamen im Formular.

## Die sechs Werkzeuge

| Werkzeug | wofür |
|---|---|
| `stand` | Lagebild, ein Objekt mit Bestand und Checklisten, oder die Geschichte einer Tür |
| `wartung_starten` | Termin am Objekt; bringt fällige Türen, Checklisten und offene Befunde mit |
| `tuer_erfassen` | eine Tür oder ein Schwung, sofort geschrieben |
| `wartung_fertig` | zurücklesen, Berichte und Sammelbericht in einem Zug |
| `einrichten` | Objekt, Türtypen und Bestand — auch aus einer Türenliste, mit Freigabe |
| `aendern` | korrigieren, was schon steht |

Dazu zwei Schrägstrich-Befehle im Client (`/wartung`, `/fertig`) und drei Ressourcen zum
Nachschlagen (`tuerwerk://bestand`, `tuerwerk://checklisten`, `tuerwerk://anleitung/import`).

Vorher waren es vierundvierzig Werkzeuge mit 48 KB Beschreibung. Der Ablauf hat aber vier
Schritte, und für ein kleines Modell am Telefon ist jeder zusätzliche Name eine Abzweigung, an
der es falsch abbiegen kann — und Text, den es vor jedem Wort mitliest.

## Aufbau

```
src/
  index.ts            Router — ein switch über Methode und Pfad
  reihenfolge.ts      Laufreihenfolge der Türen (Geschoss, Raumnummer, Weg)
  auth/               Anmeldung (Benutzer + Passwort), Sitzungs-Cookies, OAuth 2.1
  mcp/                die sechs Werkzeuge (werkzeuge.ts), die Handgriffe dahinter
                      (tuertypen_werkzeuge, import_werkzeuge), Prompts und Ressourcen
  import/             Anleitung für den Agenten, Zusammenführung Liste + Plan
  daten/              D1-Zugriff: tuertypen, objekte, bauteile, begehungen, importe,
                      berichte, personen, basis (IDs, Fristen, Zugriff)
  pdf/                Formular-Overlay (pdf-lib), Deckblatt, ZIP, Erzeugungslauf
  vorlagen/           Profile, Cheatsheets und Formular-PDFs der drei Vorlagen,
                      dazu typenvorrat.ts: die gängigen Türtypen
  web/                Seiten und Gestaltung, darunter einrichten.ts (Assistent + Laufliste)
schema.sql            D1-Schema
scripts/konten.mjs    Konten anlegen und Passwörter setzen
scripts/e2e.sh        End-to-End-Prüfung gegen einen laufenden Server
KONZEPT.md            Die Spezifikation, aus der Türwerk 2 entstanden ist
```

Die drei Vorlagen (Drehflügeltüren, Fenster, Feststellanlagen) stammen aus dem alten Skill
`tuerenwartung-diktat`: dieselben Koordinaten-Profile, dieselben Cheatsheets, dieselben PDFs.
Alles drei ist **einkompiliert**, damit ein Deployment vollständig ist und kein Zustand beim
Aufsetzen vergessen werden kann.

Die Prüfpunkte werden aus den Cheatsheet-Tabellen gelesen. Nummer und Klartext stehen damit an
genau einer Stelle: der Monteur diktiert „Punkt 7", die Website zeigt „7 — Kontrolle auf
Verschmutzungen", das PDF kreuzt die richtige Zeile an.

### Fristen

Nirgends gespeichert, immer gerechnet: **Fälligkeit einer Tür** = Datum der letzten Prüfung plus
Intervall (der Tür, sonst des Objekts, Standard zwölf Monate). Ohne Prüfung: sofort fällig. Die
Fälligkeit eines Objekts ist die seiner frühesten Tür. Rot heißt überfällig, gelb heißt innerhalb
von 30 Tagen.

### Was beim letzten Mal offen war

Ebenfalls nicht gespeichert, sondern gelesen: die jüngste frühere Prüfung einer Tür, sofern sie
„Nachbesserung" ergab. Damit fragt Claude beim nächsten Termin von selbst danach, ohne dass
irgendwo ein zweiter Zustand gepflegt werden muss, der irgendwann nicht mehr zur Prüfung passt.
Eine eigene Mängelverwaltung gab es einmal; sie sagte dasselbe an zweiter Stelle.

### Bauplan-Import

Türwerk liest keine Pläne — der Agent liest sie. Du hängst den Grundriss oder die Türenliste in
Claude, sagst „importier das nach Türwerk", und Claude holt sich mit
`tuerwerk://anleitung/import` das Format, meldet die gefundenen Türen über `einrichten` als
**Vorschläge** und berichtet, was dabei herauskam. Erst `einrichten` mit `freigeben` macht daraus
Türen. Kein API-Schlüssel, kein KI-Aufruf aus dem Worker.

Aus der Spalte Türtyp entstehen die **Türtypen** samt Stammdaten und Checkliste — steht der Name
im Vorrat, gilt der Vorrat —, aus der Spalte Ebene die **Geschosse** in der richtigen
Reihenfolge; Nummern und Laufreihenfolge vergibt der Server. Was in einer Türenliste steht, gilt
als wartungspflichtig, sofern nichts anderes dabeisteht. Der Aufruf darf sich wiederholen: eine
Kennung, die schon als offener Vorschlag liegt, kommt nicht noch einmal dazu.

Kommt der Plan **nach** der Liste, ist das kein zweiter Bestand: bekannte Kennungen bekommen ihre
Position direkt an der Tür, ohne zweite Freigabe. Die Planseite (`/objekt/<id>/plan/<geschoss>`)
zeigt das Rasterbild mit Markern nach Konfidenz; das Bild rendert der Browser (PDFs über pdf.js),
der Worker legt es nur ab.

### Versionierte Berichte

Jede Prüfung trägt einen `stand_hash`: SHA-256 über alles, was ins PDF geht — Objekt, Termin,
Tür, Prüfung, Unterschriften. Erzeugt wird nur dort, wo dieser Hash von dem der neuesten Version
abweicht. Zweimal hintereinander aufgerufen entsteht also keine zweite Version; nach einer
Änderung entsteht `v2` neben `v1`, und `v1` bleibt unter seinem R2-Schlüssel abrufbar.

## Anmeldung

Vier feste Konten, keine Selbstregistrierung. Passwörter liegen als PBKDF2-SHA256-Hash in D1,
verglichen wird zeitkonstant; nach zehn Fehlversuchen ist ein Konto 15 Minuten gesperrt.

```bash
npm run konten -- marc:Marc tobias:Tobias nils:Nils kerim:Kerim   # neue Passwörter
npm run konten -- marc                                            # nur eines zurücksetzen
wrangler d1 execute tuerwartung --remote --file konten.sql
```

Das Skript druckt die Klartextpasswörter **einmal** und schreibt nur den Hash. `konten.sql` steht
in `.gitignore`.

## MCP-Zugang

`POST /mcp`, zustandslos, Bearer-Token. OAuth 2.1 mit Dynamic Client Registration und PKCE (S256
zwingend) — Claude registriert sich selbst, der Monteur meldet sich einmal an und erlaubt den
Zugriff. Wer im Token steckt, liegt verschlüsselt in KV: der Schlüssel wird aus dem Token selbst
abgeleitet, wer nur KV lesen kann, bekommt Chiffretext.

Der öffentliche Katalog steht unter `/tools.json` — der Hub kann ihn abgreifen.

## Entwickeln und Deployen

```bash
npm install
npm run dev        # baut und startet wrangler dev auf :8787 (lokales D1/R2)
npm run build      # Typecheck + Bündel nach dist/worker.js
npm run deploy     # baut und deployt (wrangler login vorausgesetzt)
```

Für `npm run dev` braucht es eine Datei `.dev.vars` mit `SITZUNGS_SCHLUESSEL="…"` (steht in
`.gitignore`).

Der Durchstich lässt sich gegen den laufenden Entwicklungsserver prüfen — Anmeldung, OAuth-Tanz,
die sechs Werkzeuge von Ende zu Ende, Website. Der Lauf braucht `jq` und räumt seine Testdaten
selbst weg:

```bash
npm run konten -- marc:Marc --passwort=test-test-1234
npx wrangler d1 execute tuerwartung --local --file konten.sql
bash scripts/e2e.sh                                            # lokal
PASSWORT=… bash scripts/e2e.sh https://tuerwerk.ksqsebastian.workers.dev   # live
```

`wrangler.jsonc` zeigt mit `main` auf das fertige Bündel, nicht auf die Quelle: die Vorlagen-PDFs
und Cheatsheets brauchen eigene esbuild-Loader, die Wrangler nicht kennt. `npm run dev` und
`npm run deploy` bauen deshalb vorher von selbst.

Vor dem ersten Deployment einmalig:

```bash
npm run schema                               # legt die Tabellen an (DROP + CREATE)
wrangler secret put SITZUNGS_SCHLUESSEL      # lange Zufallszeichenkette
```

`npm run schema` ist wiederholbar und setzt den Bestand zurück — `personen` bleibt erhalten.

## Bindings

| Binding | Was |
|---|---|
| `DB` | D1 `tuerwartung` — Türtypen, Objekte, Türen, Wartungen, Prüfungen, Berichte, Personen |
| `R2` | R2 `tuerwartung` — Berichte (`berichte/…`), Pläne (`plaene/…`), Unterschriften |
| `OAUTH_KV` | Clients, Grants, Tokens, Fehlversuchszähler |
| `SITZUNGS_SCHLUESSEL` | Secret, signiert die Sitzungs-Cookies |
