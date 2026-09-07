# Türwerk

Türenwartung für Seehafer Elemente.

Der Bestand steht, die Fristen laufen mit, die Protokolle entstehen unterwegs. Ein Cloudflare
Worker, der drei Dinge ist:

1. **Arbeitsfläche im Browser** — Objekte mit ihrem Bestand, Bauteile mit ihrer Geschichte,
   Begehungen, Mängel, Berichte.
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
„Fertig" liest Claude zurück und nennt die fälligen Türen, die noch fehlen; auf „Go" entstehen
die PDFs.

**Am Rechner.** Die Website zeigt dieselben Daten: Objekte nach Fälligkeit sortiert, den Bestand
in Laufreihenfolge, je Bauteil die Historie aller Jahre, das vollständige Prüfpunkt-Raster zum
Nachbessern, die Mängel mit ihren Fristen und die Berichte einzeln, als Sammelbericht oder als ZIP.

**Der Betreiber unterschreibt** auf dem Handy unter `/begehung/<id>/unterschrift`. Danach
entstehen die Berichte in neuer Version, mit Unterschrift und Klarnamen im Formular.

## Aufbau

```
src/
  index.ts            Router — ein switch über Methode und Pfad
  reihenfolge.ts      Laufreihenfolge der Bauteile (Geschoss, Raumnummer, Weg)
  auth/               Anmeldung (Benutzer + Passwort), Sitzungs-Cookies, OAuth 2.1
  mcp/                MCP-Protokoll und die 25 Tools
  daten/              D1-Zugriff: objekte, bauteile, begehungen, maengel, fotos,
                      berichte, personen, basis (IDs, Fristen, Zugriffsprüfung)
  pdf/                Formular-Overlay (pdf-lib), Deckblatt, ZIP, Erzeugungslauf
  vorlagen/           Profile, Cheatsheets und Formular-PDFs der drei Vorlagen
  web/                Seiten und Gestaltung
  shared/             Krypto und Stylesheet, übernommen aus `mcpees`
schema.sql            D1-Schema v2
scripts/konten.mjs    Konten anlegen und Passwörter setzen
scripts/e2e.sh        End-to-End-Prüfung gegen einen laufenden Server
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
| `DB` | D1 `tuerwartung` — Objekte, Bauteile, Begehungen, Prüfungen, Mängel, Berichte, Personen |
| `R2` | R2 `tuerwartung` — Berichte (`berichte/…`), Fotos (`fotos/…`), Pläne (`plaene/…`), Unterschriften (`unterschriften/…`) |
| `OAUTH_KV` | Clients, Grants, Tokens, Fehlversuchszähler |
| `SITZUNGS_SCHLUESSEL` | Secret, signiert die Sitzungs-Cookies |
| `ANTHROPIC_API_KEY` | Secret, erst ab Stufe 3 (Bauplan-Import) nötig |

## Stand

Umgesetzt ist **Stufe 1** aus `KONZEPT.md`, Abschnitt 14: Bestand, Fristen, Mängel-Lebenslauf,
versionierte Berichte, Betreiber-Unterschrift, Sammelbericht, die v2-Tools und -Routen.

Das Datenmodell trägt die späteren Stufen bereits (Tabellen `fotos`, `importe`, `vorschlaege`,
`touren`, `sync_ops`, Plan- und Positionsspalten), bedient sie aber noch nicht:

- **Stufe 2** — Rundgang am Handy (offline), Fotos, Tagestour.
- **Stufe 3** — Bauplan-Import, Plan-Bestätigung, Route.
- **Stufe 4** — Vorlagen-Editor.
