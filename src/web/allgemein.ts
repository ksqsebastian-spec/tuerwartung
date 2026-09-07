/**
 * Die Seiten, die nicht zum Bestand gehören: Anmeldung, Freigabe für Claude, Einstellungen
 * und die Anleitung zum Verbinden. Aus `seiten.ts` von v1 übernommen, nur auf die neue
 * Sprache gebracht (Objekt und Bauteil statt Wartung und Tür).
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import { KOPIER_SKRIPT, esc, seite, textfeld } from "./layout";
import { personLesen } from "../daten/personen";

export function anmeldeSeite(
  origin: string,
  konten: { benutzer: string; name: string }[],
  optionen: { fehler?: string; benutzer?: string; weiter?: string; knapp?: boolean } = {},
): Response {
  const auswahl = konten.length
    ? `<select class="field" id="benutzer" name="benutzer" autofocus>
${konten
  .map(
    (k) =>
      `<option value="${esc(k.benutzer)}"${optionen.benutzer === k.benutzer ? " selected" : ""}>${esc(k.name)}</option>`,
  )
  .join("")}</select>`
    : `<input class="field" id="benutzer" name="benutzer" value="${esc(optionen.benutzer ?? "")}"
        placeholder="Benutzername" autocapitalize="off" autocorrect="off" required autofocus>`;

  const mcpHinweis = optionen.knapp
    ? ""
    : `<h2 class="abschnitt">Für Claude</h2>
<p class="meta">Der MCP-Server dieser App läuft unter</p>
<div class="urlbar" style="margin-top:10px"><input readonly value="${esc(origin)}/mcp" onclick="this.select()">
<button class="copy" data-copy="${esc(origin)}/mcp">Kopieren</button></div>`;

  return seite(
    `<div style="max-width:420px">
<h1 class="seite">Türwerk</h1>
<p class="lede" style="margin-top:14px;max-width:38ch">Der Bestand steht, die Fristen laufen mit,
die Protokolle entstehen unterwegs.</p>
${optionen.fehler ? `<div class="err" style="margin-top:24px">${esc(optionen.fehler)}</div>` : ""}
<form class="karte" method="post" action="/anmeldung" style="margin-top:28px">
${optionen.weiter ? `<input type="hidden" name="weiter" value="${esc(optionen.weiter)}">` : ""}
<div class="feld"><label for="benutzer">Wer bist du?</label>${auswahl}</div>
<div class="feld" style="margin-top:16px"><label for="passwort">Passwort</label>
<input class="field" id="passwort" name="passwort" type="password" autocomplete="current-password" required></div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Anmelden</button></div>
</form>
${mcpHinweis}
</div>`,
    { titel: "Anmelden", skript: KOPIER_SKRIPT },
  );
}

/* ── Einstellungen ─────────────────────────────────────────────────────────── */

export async function einstellungenSeite(
  env: Env,
  nutzer: Nutzer,
  meldung?: string,
): Promise<Response> {
  const p = await personLesen(env.DB, nutzer.benutzer);
  const v = p?.vorgaben ?? {};
  return seite(
    `<h1 class="seite">Einstellungen</h1>
${meldung ? `<div class="note" style="margin:22px 0">${esc(meldung)}</div>` : ""}

<h2 class="abschnitt">Vorgaben</h2>
<p class="meta">Füllen jede neue Begehung vor, damit sie nicht jedes Mal diktiert werden müssen.</p>
<form class="karte" method="post" action="/einstellungen" style="margin-top:14px">
<div class="felder">
${textfeld("pruefer", "Prüfer", v.pruefer ?? nutzer.name)}
${textfeld("befaehigung", "Befähigungsnachweis", v.befaehigung ?? "Sachkundiger DGWZ")}
${textfeld("ort", "Prüfort", v.ort ?? "Hamburg")}
${textfeld("rechtsgrundlagen", "Rechtsgrundlagen", v.rechtsgrundlagen ?? "DIN 18650, DGUV, Herstellervorgaben")}
</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Speichern</button></div>
</form>

<h2 class="abschnitt">Unterschrift</h2>
<p class="meta">PNG mit durchsichtigem Hintergrund. Wird in jeden Bericht gesetzt, den du erzeugst.
${p?.unterschrift ? "Aktuell ist eine hinterlegt." : "Aktuell ist keine hinterlegt — das Feld bleibt leer."}</p>
${p?.unterschrift ? `<img src="/datei/${esc(p.unterschrift)}" alt="Unterschrift" style="max-height:70px;margin:16px 0;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px">` : ""}
<form class="karte" method="post" action="/einstellungen/unterschrift" enctype="multipart/form-data" style="margin-top:14px">
<div class="feld"><label for="bild">PNG auswählen</label>
<input class="field" type="file" id="bild" name="bild" accept="image/png" required></div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Hochladen</button></div>
</form>`,
    { titel: "Einstellungen", nutzer, aktiv: "einstellungen" },
  );
}

/* ── Claude verbinden ──────────────────────────────────────────────────────── */

export function verbindenSeite(origin: string, nutzer: Nutzer): Response {
  return seite(
    `<h1 class="seite">Claude verbinden</h1>
<p class="lede" style="margin-top:14px">Ein MCP-Server, dieselbe Anmeldung. Was du hier siehst,
sieht Claude auch — und schreibt hinein, während du diktierst.</p>

<h2 class="abschnitt">Server-URL</h2>
<div class="urlbar"><input readonly value="${esc(origin)}/mcp" onclick="this.select()">
<button class="copy" data-copy="${esc(origin)}/mcp">Kopieren</button></div>
<p class="meta" style="margin-top:12px">In Claude unter <b>Einstellungen → Connectors → Connector
hinzufügen</b> einfügen. Beim Verbinden meldest du dich mit demselben Benutzer und Passwort an
wie hier (${esc(nutzer.name)}).</p>

<h2 class="abschnitt">So läuft es vor Ort</h2>
<ul class="points">
<li><b>Starten</b> — „Türenwartung Kita Heselstücken." Kennt Türwerk das Objekt nicht, legt es
das Objekt an; die erste Begehung ist die Bestandsaufnahme.</li>
<li><b>Diktieren</b> — Tür für Tür. Standard ist alles in Ordnung, du nennst nur die Ausnahmen:
„Tür 6, Punkt 8 nicht." Jede Tür landet sofort hier. „Tür 12" ist dabei das Bauteil Nr. 12 des
Objekts — nächstes Jahr dieselbe Tür.</li>
<li><b>Serie</b> — „Wie davor, außer Etage 2."</li>
<li><b>Altlasten</b> — war im Vorjahr etwas offen, fragt Claude danach: „behoben?"</li>
<li><b>Fertig</b> — Claude liest zurück und nennt die fälligen Türen, die noch fehlen.
Dann „Go" für die Berichte.</li>
</ul>

<h2 class="abschnitt">Tools</h2>
<p class="meta">Der Katalog steht öffentlich unter <a href="/tools.json" style="text-decoration:underline">/tools.json</a>.</p>`,
    { titel: "Claude verbinden", nutzer, aktiv: "verbinden", skript: KOPIER_SKRIPT },
  );
}

/* ── Freigabeseite für den MCP-Client ──────────────────────────────────────── */

export function freigabeSeite(
  nutzer: Nutzer,
  clientName: string,
  clientUri: string | undefined,
  params: Record<string, string>,
): Response {
  const versteckt = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return seite(
    `<div style="max-width:480px">
<h1 class="seite">Zugriff erlauben</h1>
<p class="body" style="margin-top:14px;color:var(--ink-2)">Dieser Client darf danach in deinem Namen
den Bestand lesen und schreiben, Prüfungen erfassen und Berichte erzeugen. Der Zugriff lässt sich
jederzeit widerrufen.</p>

<div class="client" style="display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:14px;padding:15px 17px;margin:24px 0">
<span style="width:8px;height:8px;border-radius:50%;background:#12833f"></span>
<div><div style="font-weight:600">${esc(clientName)}</div>
${clientUri ? `<div class="meta" style="font-size:.82rem">${esc(clientUri)}</div>` : ""}</div></div>

<div class="note">Angemeldet als <b>${esc(nutzer.name)}</b></div>

<form method="post" style="margin-top:24px">${versteckt}
<div class="knopfleiste"><button class="btn schmal" type="submit" name="entscheidung" value="ja">Erlauben</button>
<button class="btn schmal leise" type="submit" name="entscheidung" value="nein">Ablehnen</button></div>
</form></div>`,
    { titel: "Zugriff erlauben" },
  );
}
