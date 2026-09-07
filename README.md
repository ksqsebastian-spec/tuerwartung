# Türwerk

Türenwartung für Seehafer Elemente.

Der Bestand steht, die Fristen laufen mit, die Protokolle entstehen unterwegs. Ein Cloudflare
Worker, der drei Dinge ist:

1. **Arbeitsfläche im Browser** — Türtypen mit ihren Checklisten, Objekte mit ihrem Bestand,
   Türen mit ihrer Geschichte, Berichte.
2. **OAuth-geschützter MCP-Server** — Claude schreibt darüber jede diktierte Tür sofort weg.
3. **Berichtsgenerator** — füllt die Formular-PDFs aus, versioniert sie und legt sie in R2 ab.

Alles an einer Adresse, eine Anmeldung: wer sich auf der Website anmeldet, verbindet damit auch
Claude.

## Das Modell in einem Absatz

**Das Bauteil ist die feste Größe, nicht der Termin.** Ein **Objekt** (die Liegenschaft) trägt
seine **Bauteile** — Türen, Fenster, Feststellanlagen —, und jedes Bauteil trägt seine Geschichte
über die Jahre. Eine **Begehung** ist ein Termin an einem Objekt; sie erzeugt **Prüfungen** an
Bauteilen. Aus einer Prüfung mit Abweichung entsteht ein **Mangel**, der am Bauteil hängt, bis
ihn jemand freimeldet — auch über Jahre hinweg. Aus jeder Prüfung entsteht ein **Bericht**, und
zwar versioniert: ändert sich der Stand, entsteht eine neue Version daneben; was beim Kunden
liegt, bleibt genau so.

„Tür 12" meint deshalb das Bauteil Nr. 12 dieses Objekts — nächstes Jahr wieder dieselbe Tür.

## Wie es benutzt wird

**Vor Ort am Handy.** Der Monteur startet den Skill `tuerwerk-diktat`, sagt das Objekt und
diktiert dann Tür für Tür. Standard ist „alles in Ordnung" — er nennt nur die Ausnahmen:
„Tür 6, Punkt 8 nicht." Jede Tür geht sofort in die Datenbank; bricht das Gespräch ab, ist nichts
verloren. Kennt Türwerk das Objekt nicht, legt es das Objekt an: die erste Begehung ist die
Bestandsaufnahme. Hängt an einer Tür noch ein Mangel aus dem Vorjahr, fragt Claude danach. Auf
„Fertig" liest Claude zurück, nennt die fälligen Türen die noch fehlen — und erzeugt in
demselben Zug die Berichte und den Sammelbericht.

**Zuerst die Stammdaten.** Ein **Türtyp** — „T30 Flurtür Hörmann" — wählt das Formular, trägt
die Angaben, die für alle Türen dieser Art gleich sind (Hersteller, Zulassung), und legt fest,
was an jeder einzelnen Tür stehen muss, bevor geprüft werden darf. Aus der Vorlage entsteht dabei
**seine Checkliste**; die wird zurechtgelegt: Punkte umbenennen, ausblenden, eigene ergänzen,
dazu Felder wie Geschoss oder Kommentar. Im Chat mit `/tuertyp`, in der App unter **Stammdaten**.

**Dann die Türen.** `/tuer` im Chat oder `tuer_einrichten`: Türtyp nennen, dann fragt Türwerk
nach dem, was dieser Typ verlangt — eine Frage nach der anderen, bis alles steht. Vorher lässt
sich nichts prüfen, und das ist Absicht: was beim Anlegen fehlt, fehlt später im Bericht. Steht
die Ident-Nummer nur auf dem Typenschild, fotografiert der Monteur es und Claude liest sie ab.

**Ein neues Objekt** richtet `/einrichten` ein: Adresse, Betreiber, Ansprechpartner mit Telefon,
Wartungsvertrag und vor allem **wie man reinkommt** („Schlüssel beim Hausmeister", „Anmeldung im
Sekretariat"). Der Zugang steht danach auf der Objektseite — das Feld, das die vergebliche
Anfahrt verhindert.

**Ein Bauplan** ist zwei Schritte: Claude liest die Datei und gibt die gefundenen Türen mit
`bauplan_uebernehmen` ab, dann liest es vor, was gefunden wurde, und holt die Freigabe. Ohne
Freigabe entstehen keine Bauteile — das ist der Punkt, an dem ein Mensch entscheidet.

**So wenig Eingabe wie möglich.** Was der Server ausrechnen kann, fragt er nicht: die Etage einer
Tür erkennt er aus Raumnummer, ETAGE oder Flur; eine Abweichung macht die Prüfung von selbst zu
„nicht bestanden"; `lage` beantwortet „was ist zu tun?" in einem Aufruf statt in vieren. Und der
Connector bringt Schrägstrich-Befehle mit — **/wartung, /tuertyp, /tuer, /tag, /abschluss,
/einrichten, /bauplan** —, damit auch der Einstieg nicht formuliert werden muss.

## Wie die Oberfläche aufgebaut ist

Oben in der Leiste: **Objekte · Stammdaten · Checkliste**. Stammdaten und Checkliste stehen dort,
weil sie über allen Objekten gelten — ein Türtyp und seine Punkte bleiben gleich, egal an welcher
Liegenschaft man steht.

**Ein Objekt** (`/objekt/:id`) hat zwei Reiter, mehr nicht:

- **Bestand** — alle Türen mit ihrem Ergebnis: bestanden, nicht bestanden, noch nicht geprüft.
  Darüber ein Satz, der sagt wo man steht, und ein Knopf, der weiterführt.
- **Berichte** — je Termin die PDFs mit allen Versionen, Sammelbericht, ZIP.

Einen „Termin" gibt es in der Oberfläche nicht: wer eine Tür erfasst, meint den heutigen Termin
an diesem Objekt, und der entsteht dabei von selbst. Kein „Begehung starten", kein „fortsetzen".
Intern trägt die Begehung weiterhin die Prüfungen und Berichte.

**Der Rundgang** (`/rundgang/:begehung`) ist die Gegenrichtung: selber tippen, auch ohne Netz.
Ein Service Worker legt die Seite in den Cache, IndexedDB hält Daten, Warteschlange und Fotos;
hochgeschoben wird, sobald wieder Verbindung da ist. Unterwegs lassen sich unbekannte Türen
anlegen und Fotos aufnehmen.

**Der Betreiber unterschreibt** auf dem Handy unter `/begehung/<id>/unterschrift`. Danach
entstehen die Berichte in neuer Version, mit Unterschrift und Klarnamen im Formular.

## Aufbau

```
src/
  index.ts            Router — ein switch über Methode und Pfad
  reihenfolge.ts      Laufreihenfolge der Bauteile (Geschoss, Raumnummer, Weg)
  web/rundgang.client.js.txt, web/plan.client.js.txt, web/sw.js.txt
                      die Browser-Skripte, als Text einkompiliert
  auth/               Anmeldung (Benutzer + Passwort), Sitzungs-Cookies, OAuth 2.1
  mcp/                MCP-Protokoll, die 44 Tools (werkzeuge + import_werkzeuge),
                      dazu prompts.ts: die vier Schrägstrich-Befehle und die Ressourcen
  import/             Anleitung für den Agenten, Zusammenführung Liste + Plan
  daten/              D1-Zugriff: objekte, bauteile, begehungen, maengel, fotos,
                      berichte, touren, sync, personen, basis (IDs, Fristen, Zugriff)
  pdf/                Formular-Overlay (pdf-lib), Deckblatt, ZIP, Erzeugungslauf
  vorlagen/           Profile, Cheatsheets und Formular-PDFs der drei Vorlagen
  web/                Seiten und Gestaltung
  shared/             Krypto und Stylesheet, übernommen aus `mcpees`
schema.sql            D1-Schema v2
scripts/konten.mjs    Konten anlegen und Passwörter setzen
scripts/e2e.sh        End-to-End-Prüfung gegen einen laufenden Server
scripts/rundgang-offline.mjs
                      die Abnahme des Rundgangs im Browser, mit getrenntem Netz
KONZEPT.md            Die Spezifikation von Türwerk 2 (Stufen 1–4)
```

Die drei Vorlagen (Drehflügeltüren, Fenster, Feststellanlagen) stammen aus dem alten Skill
`tuerenwartung-diktat`: dieselben Koordinaten-Profile, dieselben Cheatsheets, dieselben PDFs. Das
Python-Skript `fill_pdf_overlay.py` ist nach pdf-lib übersetzt. Alles drei ist **einkompiliert**,
damit ein Deployment vollständig ist und kein Zustand beim Aufsetzen vergessen werden kann.

Die Prüfpunkte werden aus den Cheatsheet-Tabellen gelesen. Nummer und Klartext stehen damit an
genau einer Stelle: der Monteur diktiert „Punkt 7", die Website zeigt „7 — Kontrolle auf
Verschmutzungen", das PDF kreuzt die richtige Zeile an.

### Fristen

Nirgends gespeichert, immer gerechnet: **Fälligkeit eines Bauteils** = Datum der letzten Prüfung
plus Intervall (des Bauteils, sonst des Objekts, Standard zwölf Monate). Ohne Prüfung: sofort
fällig. Die Fälligkeit eines Objekts ist die seines frühesten Bauteils. Rot heißt überfällig,
gelb heißt innerhalb von 30 Tagen.

### Offline

Der Rundgang ist die einzige Seite ohne Netzzwang. Jede Erfassung wird lokal in eine
Warteschlange geschrieben und mit einer selbst erzeugten `op_id` versehen; `POST /api/sync`
trägt sie in `sync_ops` ein, und eine bereits bekannte `op_id` bleibt wirkungslos — Wiederholen
ist damit harmlos. Prüfen zwei Geräte dasselbe Bauteil, gewinnt die jüngere Erfassung
(`geprueft_am`). Ist eine im Rundgang vergebene Türnummer inzwischen belegt, legt der Server sie
um und schickt die Zuordnung zurück, die der Client in seine wartenden Operationen einträgt.

### Bauplan-Import

Türwerk liest keine Pläne — der Agent liest sie. Du hängst den Grundriss oder die Türliste in
Claude, sagst „importier das nach Türwerk", und Claude holt sich mit `import_anleitung` das
Format, meldet die gefundenen Türen als **Vorschläge** und berichtet, was dabei herauskam. Erst
eine Freigabe macht daraus Bauteile — im Gespräch („nimm alle ab 0.85") oder auf der Planseite,
die das Rasterbild mit Markern nach Konfidenz zeigt. Das Bild rendert der Browser (PDFs über
pdf.js), der Worker legt es nur ab. Kein API-Schlüssel, kein KI-Aufruf aus dem Worker.

Liegen Türliste und Plan vor, führt `import_zusammenfuehren` sie zusammen: gleiche Kennung,
sonst gleiche Raumnummer, wenn dort auf beiden Seiten genau eine Tür steht. Position kommt vom
Plan, Felder von der Liste; was nicht sicher zusammenpasst, bleibt getrennt stehen.

### Versionierte Berichte

Jede Prüfung trägt einen `stand_hash`: SHA-256 über alles, was ins PDF geht — Objekt, Begehung,
Bauteil, Prüfung, Fotos, Unterschriften. `berichte_erzeugen` legt nur dort eine neue Version an,
wo dieser Hash von dem der neuesten Version abweicht. Zweimal hintereinander aufgerufen entsteht
also keine zweite Version; nach einer Änderung entsteht `v2` neben `v1`, und `v1` bleibt unter
seinem R2-Schlüssel abrufbar.

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

Der öffentliche Katalog steht unter `/tools.json`, gleiche Machart wie bei `hero-mcp` und
`tarifcheck` — der Hub kann ihn abgreifen.

Neben den Tools bietet der Server **Prompts** (`/wartung`, `/tuertyp`, `/tuer`, `/tag`, `/abschluss`, `/einrichten`, `/bauplan` —
fertige Gesprächsanfänge, die im Client als Befehle erscheinen) und **Ressourcen**
(`tuerwerk://bestand`, `tuerwerk://checklisten`, `tuerwerk://anleitung/import` —
Nachschlagewissen, das der Client anhängen kann, ohne dass ein Tool-Aufruf im Gespräch steht).

## Entwickeln und Deployen

```bash
npm install
npm run dev        # baut und startet wrangler dev auf :8787 (lokales D1/R2)
npm run build      # Typecheck + Bündel nach dist/worker.js
npm run deploy     # baut und deployt (wrangler login vorausgesetzt)
```

Für `npm run dev` braucht es eine Datei `.dev.vars` mit `SITZUNGS_SCHLUESSEL="…"` (steht in
`.gitignore`).

Der Durchstich lässt sich gegen den laufenden Entwicklungsserver prüfen — die Abnahmekriterien
der Stufe 1 aus `KONZEPT.md`, dazu Anmeldung, OAuth-Tanz und Website. Der Lauf braucht `jq` und
räumt seine Testdaten am Ende selbst weg:

```bash
npm run konten -- marc:Marc --passwort=test-test-1234
npx wrangler d1 execute tuerwartung --local --file konten.sql
bash scripts/e2e.sh                                            # lokal
PASSWORT=… bash scripts/e2e.sh https://tuerwerk.ksqsebastian.workers.dev   # live
```

Der Rundgang im Browser, mit getrenntem Netz, ist die eine Abnahme, die ein Bash-Skript nicht
leisten kann. Playwright ist deshalb keine Abhängigkeit des Projekts, sondern wird für den
Lauf danebengelegt:

```bash
npm install --no-save playwright
node scripts/rundgang-offline.mjs
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
Stammt eine Datenbank noch aus Türwerk 1, fehlt der Tabelle `personen` die Spalte `rolle`; die
holt man einmalig nach:

```bash
npx wrangler d1 execute tuerwartung --remote --file schema_personen_rolle.sql
```

## Bindings

| Binding | Was |
|---|---|
| `DB` | D1 `tuerwartung` — Türtypen, Objekte, Bauteile, Begehungen, Prüfungen, Berichte, Personen |
| `R2` | R2 `tuerwartung` — Berichte (`berichte/…`), Fotos (`fotos/…`), Pläne (`plaene/…`), Unterschriften (`unterschriften/…`) |
| `OAUTH_KV` | Clients, Grants, Tokens, Fehlversuchszähler |
| `SITZUNGS_SCHLUESSEL` | Secret, signiert die Sitzungs-Cookies |
| `ANTHROPIC_API_KEY` | vorgesehen, aber **nicht benutzt** — der Bauplan-Import läuft über den Agenten (Abschnitt 7.0) |

## Stand

Umgesetzt sind **Stufe 1 bis 3** aus `KONZEPT.md`, Abschnitt 14 — und darüber hinaus der
Umbau auf **Türtypen mit eigener Checkliste** (Abschnitt 1.2): Stammdaten und Checkliste oben
in der Leiste, ein Objekt nur noch mit Bestand und Berichten, geführtes Einrichten von Objekt,
Türtyp und Tür. Dazu Fristen, versionierte Berichte, Betreiber-Unterschrift, Sammelbericht,
Rundgang ohne Netz, Fotos und der Bauplan-Import über den Agenten mit Planseite.

**Entfallen** sind Mängel und Touren als eigene Features: eine Tür hat bestanden oder nicht,
und das steht im Bestand. Was beim letzten Mal nicht in Ordnung war, wird beim nächsten Mal
abgefragt — mehr Verwaltung braucht es nicht.

Der Vorlagen-Editor aus Stufe 4 hat sich damit weitgehend erledigt: eine eigene Checkliste je
Türtyp gibt es jetzt. Offen bleibt nur, ein viertes **Formular-PDF** ohne Deployment
hinzuzufügen.

Zur Probe wurde ein frei lizenzierter Grundriss aus Wikimedia Commons durch den Import geschickt
(„2 bhk Bungalow floor plan", 7 Türen): alle sieben gefunden, keine falsche, die Marker sitzen
auf den Türen. Mit einem echten Kundenplan und dessen Türliste ist das zu wiederholen — dann
zählt die Trefferquote gegen eine Zahl, die nicht vom Leser selbst stammt.
