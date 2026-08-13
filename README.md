# Türenwartung

Diktat vor Ort, fertige Wartungsprotokolle am Ende. Ein Cloudflare Worker, der drei Dinge ist:

1. **Arbeitsfläche im Browser** — Wartungen ansehen, korrigieren, Berichte herunterladen.
2. **OAuth-geschützter MCP-Server** — Claude schreibt darüber jede diktierte Tür sofort weg.
3. **Berichtsgenerator** — füllt die Formular-PDFs aus und legt sie in R2 ab.

Alles an einer Adresse, eine Anmeldung: wer sich auf der Website anmeldet, verbindet damit auch
Claude.

## Wie es benutzt wird

**Vor Ort am Handy.** Der Monteur startet den Skill `tuerenwartung-diktat`, sagt Objekt und
Vorlage, und diktiert dann Tür für Tür. Standard ist „alles in Ordnung" — er nennt nur die
Ausnahmen: „Tür 6, Punkt 8 nicht." Jede Tür geht sofort in die Datenbank; bricht das Gespräch ab,
ist nichts verloren. Auf „Fertig" liest Claude alles zurück, auf „Go" entstehen die PDFs.

**Am Rechner.** Die Website zeigt dieselben Daten: Wartungen, Türen mit dem vollständigen
Prüfpunkt-Raster zum Nachbessern, die fertigen Berichte einzeln oder als ZIP.

## Aufbau

```
src/
  index.ts            Router — ein switch über Methode und Pfad
  auth/               Anmeldung (Benutzer + Passwort), Sitzungs-Cookies, OAuth 2.1
  mcp/                MCP-Protokoll und die 13 Tools
  daten/              D1-Zugriff: Wartungen, Türen, Personen
  pdf/                Formular-Overlay (pdf-lib), ZIP, Erzeugungslauf
  vorlagen/           Profile, Cheatsheets und Formular-PDFs der drei Vorlagen
  web/                Seiten und Gestaltung
  shared/             Krypto und Stylesheet, übernommen aus `mcpees`
schema.sql            D1-Schema
scripts/konten.mjs    Konten anlegen und Passwörter setzen
```

Die drei Vorlagen (Drehflügeltüren, Fenster, Feststellanlagen) stammen unverändert aus dem Skill
`tuerenwartung-diktat`: dieselben Koordinaten-Profile, dieselben Cheatsheets, dieselben PDFs. Das
Python-Skript `fill_pdf_overlay.py` ist nach pdf-lib übersetzt — ein Profil, das dort funktioniert
hat, funktioniert hier. Alles drei ist **einkompiliert**, damit ein Deployment vollständig ist und
kein Zustand beim Aufsetzen vergessen werden kann.

Die Prüfpunkte werden aus den Cheatsheet-Tabellen gelesen. Nummer und Klartext stehen damit an
genau einer Stelle: der Monteur diktiert „Punkt 7", die Website zeigt „7 — Kontrolle auf
Verschmutzungen", das PDF kreuzt die richtige Zeile an.

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

Der Durchstich lässt sich gegen den laufenden Entwicklungsserver prüfen — Anmeldung, Wartung,
Türen, Berichte, der komplette OAuth-Tanz und ein paar MCP-Aufrufe:

```bash
npm run konten -- marc:Marc --passwort=test-test-1234
npx wrangler d1 execute tuerwartung --local --file konten.sql
bash scripts/e2e.sh
```

`wrangler.jsonc` zeigt mit `main` auf das fertige Bündel, nicht auf die Quelle: die Vorlagen-PDFs
und Cheatsheets brauchen eigene esbuild-Loader, die Wrangler nicht kennt. `npm run dev` und
`npm run deploy` bauen deshalb vorher von selbst.

Vor dem ersten Deployment einmalig:

```bash
wrangler d1 execute tuerwartung --remote --file schema.sql
wrangler secret put SITZUNGS_SCHLUESSEL      # lange Zufallszeichenkette
```

## Bindings

| Binding | Was |
|---|---|
| `DB` | D1 `tuerwartung` — Wartungen, Türen, Personen |
| `R2` | R2 `tuerwartung` — fertige Berichte (`berichte/…`), Unterschriften (`unterschriften/…`) |
| `OAUTH_KV` | Clients, Grants, Tokens, Fehlversuchszähler |
| `SITZUNGS_SCHLUESSEL` | Secret, signiert die Sitzungs-Cookies |
