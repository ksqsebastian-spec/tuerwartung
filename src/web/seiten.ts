/**
 * Die Seiten der Arbeitsfläche.
 *
 * Was hier steht, ist bewusst wenig: eine Liste der Wartungen, eine Wartung mit ihren Türen,
 * ein Formular je Tür, die Berichte. Der Regelweg ist das Diktat — die Website ist zum
 * Nachsehen, Korrigieren und Herunterladen da.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import { esc, seite, umleitung } from "./layout";
import { BEWERTUNGEN, VORLAGEN, VORLAGEN_IDS, vorlage } from "../vorlagen";
import type { Tuer, Wartung } from "../daten/wartungen";
import {
  heute,
  personLesen,
  tuerenLesen,
  wartungLesen,
  wartungenListe,
} from "../daten/wartungen";
import { berichtsListe } from "../pdf/berichte";

/** Technische Feldnamen aus den Profilen, für Menschen beschriftet. */
const FELD_LABELS: Record<string, string> = {
  ETAGE: "Etage",
  RAUM: "Raum",
  FLUR: "Flur",
  RAUMBEZ: "Raumbezeichnung",
  TUERTYP: "Türtyp",
  FENSTERTYP: "Fenstertyp",
  HERSTELLER: "Hersteller",
  ABSENKDICHTUNG: "Absenkdichtung",
  OTS: "Obentürschließer",
  SPION: "Spion",
  ZULASSUNG: "Zulassung / Prüfzeugnis",
  FABRIK_BESCHLAEGE: "Fabrikat Beschläge",
};

const label = (feld: string) => FELD_LABELS[feld] ?? feld;

function textfeld(name: string, beschriftung: string, wert = "", extra = ""): string {
  return `<div class="feld"><label for="${esc(name)}">${esc(beschriftung)}</label>
<input class="field" id="${esc(name)}" name="${esc(name)}" value="${esc(wert)}" ${extra}></div>`;
}

function datumsfeld(name: string, beschriftung: string, wert = ""): string {
  return `<div class="feld"><label for="${esc(name)}">${esc(beschriftung)}</label>
<input class="field" type="date" id="${esc(name)}" name="${esc(name)}" value="${esc(wert)}"></div>`;
}

function zeitpunkt(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/* ── Anmeldung ────────────────────────────────────────────────────────────── */

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
<h1 class="seite">Türenwartung</h1>
<p class="lede" style="margin-top:14px;max-width:38ch">Diktiert vor Ort, gesammelt an einer Stelle,
fertige Wartungsprotokolle auf Knopfdruck.</p>
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
    {
      titel: "Anmelden",
      skript: `document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');
if(!b)return;navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){
var o=b.textContent;b.textContent='Kopiert';b.classList.add('done');
setTimeout(function(){b.textContent=o;b.classList.remove('done')},1500)})});`,
    },
  );
}

/* ── Wartungen ─────────────────────────────────────────────────────────────── */

export async function wartungenSeite(
  env: Env,
  nutzer: Nutzer,
  suche: string,
): Promise<Response> {
  const liste = await wartungenListe(env.DB, { suche: suche || undefined, limit: 100 });

  const zeilen = liste.length
    ? `<div class="liste">${liste
        .map((w) => {
          const fertig = w.tueren > 0 && w.offen === 0;
          return `<a class="posten" href="/wartung/${encodeURIComponent(w.id)}">
<div class="haupt">
  <div class="name">${esc(w.objekt || w.id)}</div>
  <div class="unter">${esc(w.datum)} · ${esc(VORLAGEN[w.vorlage]?.label ?? w.vorlage)}${
    w.betreiber ? ` · ${esc(w.betreiber)}` : ""
  }</div>
</div>
<span class="chip">${w.tueren} ${w.tueren === 1 ? "Tür" : "Türen"}</span>
${
  fertig
    ? '<span class="chip gut">Berichte fertig</span>'
    : `<span class="chip">${w.offen} offen</span>`
}</a>`;
        })
        .join("")}</div>`
    : `<div class="leer">Noch keine Wartung erfasst.<br>Diktiere im Chat oder lege hier eine an.</div>`;

  const neu = `<h2 class="abschnitt">Neue Wartung</h2>
<form class="karte" method="post" action="/wartungen">
<div class="felder">
  <div class="feld"><label for="vorlage">Vorlage</label>
    <select class="field" id="vorlage" name="vorlage">
    ${VORLAGEN_IDS.map((id) => `<option value="${esc(id)}">${esc(VORLAGEN[id].label)}</option>`).join("")}
    </select></div>
  ${textfeld("objekt", "Objekt / Adresse", "", "required placeholder=\"Heselstücken 12\"")}
  ${textfeld("betreiber", "Betreiber")}
  ${datumsfeld("datum", "Prüfdatum", heute())}
</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Wartung anlegen</button></div>
</form>`;

  return seite(
    `<div class="zeile oben"><h1 class="seite">Wartungen</h1>
<form method="get" style="min-width:220px">
<input class="field" name="suche" value="${esc(suche)}" placeholder="Suchen …" aria-label="Suchen">
</form></div>
${zeilen}
${neu}`,
    { titel: "Wartungen", nutzer, aktiv: "wartungen" },
  );
}

/* ── Eine Wartung ──────────────────────────────────────────────────────────── */

export async function wartungSeite(
  env: Env,
  nutzer: Nutzer,
  id: string,
  meldung?: string,
): Promise<Response> {
  const w = await wartungLesen(env.DB, id);
  if (!w) return umleitung("/wartungen");
  const tueren = await tuerenLesen(env.DB, id);
  const v = vorlage(w.vorlage);
  const berichte = berichtsListe(tueren);
  const offen = tueren.filter((t) => t.status !== "generiert").length;

  const kopf = `<div class="zeile oben">
<div><div class="eyebrow">${esc(v.label)}</div>
<h1 class="seite" style="margin-top:8px">${esc(w.objekt || w.id)}</h1>
<p class="meta" style="margin-top:8px">${esc(w.id)}</p></div></div>

<div class="zahlen">
<div class="zahl"><div class="wert">${tueren.length}</div><div class="was">TÜREN</div></div>
<div class="zahl"><div class="wert">${tueren.filter((t) => Object.keys(t.checks).length).length}</div><div class="was">MIT ABWEICHUNG</div></div>
<div class="zahl"><div class="wert">${berichte.length}</div><div class="was">BERICHTE</div></div>
</div>`;

  const tuerListe = tueren.length
    ? `<div class="liste">${tueren.map((t) => tuerZeile(w, t, v.punkte.length)).join("")}</div>`
    : `<div class="leer">Noch keine Tür erfasst.</div>`;

  const erzeugen = `<div class="knopfleiste">
<button class="btn schmal" id="erzeugen" ${tueren.length ? "" : "disabled"}>
  ${offen ? `${offen} ${offen === 1 ? "Bericht" : "Berichte"} erzeugen` : "Berichte neu erzeugen"}
</button>
${berichte.length ? `<a class="btn schmal leise" href="/wartung/${encodeURIComponent(w.id)}/paket.zip">Alle als ZIP</a>` : ""}
<span class="stand" id="stand">${meldung ? esc(meldung) : ""}</span></div>`;

  const berichtListe = berichte.length
    ? `<h2 class="abschnitt">Berichte</h2><div class="liste">${berichte
        .map(
          (b) => `<a class="posten" href="/datei/${esc(b.schluessel)}">
<span class="nr">${b.nr}</span>
<div class="haupt"><div class="name">${esc(b.datei)}</div>
<div class="unter">${esc(zeitpunkt(b.erzeugt_am))}</div></div>
<span class="chip">PDF</span></a>`,
        )
        .join("")}</div>`
    : "";

  const skript = `
const knopf = document.getElementById('erzeugen');
const stand = document.getElementById('stand');
knopf?.addEventListener('click', async () => {
  knopf.disabled = true;
  stand.classList.add('laeuft');
  let gesamt = 0;
  for (let runde = 0; runde < 40; runde++) {
    stand.textContent = 'Erzeuge Berichte …' + (gesamt ? ' ' + gesamt + ' fertig' : '');
    const r = await fetch(location.pathname + '/erzeugen', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) { stand.classList.remove('laeuft'); stand.textContent = d.fehler || 'Fehlgeschlagen.'; knopf.disabled = false; return; }
    gesamt += d.erzeugt || 0;
    if (d.fertig || (d.erzeugt === 0 && d.fehler_je_tuer?.length)) break;
  }
  stand.classList.remove('laeuft');
  location.reload();
});`;

  return seite(
    `${kopf}
${meldung ? `<div class="note" style="margin-bottom:22px">${esc(meldung)}</div>` : ""}
<div class="zeile" style="justify-content:space-between;align-items:center">
<h2 class="abschnitt" style="margin:0">Türen</h2>
<a class="btn schmal leise" href="/wartung/${encodeURIComponent(w.id)}/tuer/neu">Tür hinzufügen</a></div>
<div style="height:14px"></div>
${tuerListe}
${erzeugen}
${berichtListe}
${stammdatenFormular(w)}`,
    { titel: w.objekt || w.id, nutzer, aktiv: "wartungen", skript },
  );
}

function tuerZeile(w: Wartung, t: Tuer, punkte: number): string {
  const abweichungen = Object.entries(t.checks);
  const beschreibung =
    [t.felder.ETAGE && `Etage ${t.felder.ETAGE}`, t.felder.RAUM, t.felder.RAUMBEZ]
      .filter(Boolean)
      .join(" · ") || "ohne Ortsangabe";
  const merkmale = abweichungen.length
    ? `<span class="chip mangel">${abweichungen.length} von ${punkte} nicht i.O.</span>`
    : `<span class="chip gut">alles i.O.</span>`;
  return `<a class="posten" href="/wartung/${encodeURIComponent(w.id)}/tuer/${t.nr}">
<span class="nr">${t.nr}</span>
<div class="haupt"><div class="name">${esc(beschreibung)}</div>
<div class="unter">${esc(t.ergebnis || "—")}${t.hinweise ? ` · ${esc(t.hinweise.slice(0, 60))}` : ""}</div></div>
${merkmale}
${t.status === "generiert" ? '<span class="chip voll">Bericht</span>' : ""}</a>`;
}

function stammdatenFormular(w: Wartung): string {
  return `<h2 class="abschnitt">Stammdaten</h2>
<form class="karte" method="post" action="/wartung/${encodeURIComponent(w.id)}">
<div class="felder">
${textfeld("objekt", "Objekt / Adresse", w.objekt)}
${textfeld("betreiber", "Betreiber", w.betreiber)}
${textfeld("ident", "Ident-Nummer", w.ident)}
${textfeld("tuertyp", "Türtyp", w.tuertyp)}
${textfeld("pruefer", "Prüfer", w.pruefer)}
${textfeld("befaehigung", "Befähigungsnachweis", w.befaehigung)}
${datumsfeld("datum", "Prüfdatum", w.datum)}
${textfeld("ort", "Prüfort", w.ort)}
${datumsfeld("letzte_pruefung", "Letzte Prüfung", w.letzte_pruefung)}
${datumsfeld("naechste_pruefung", "Nächste Prüfung", w.naechste_pruefung)}
${textfeld("beteiligte", "Beteiligte / Messgeräte", w.beteiligte)}
</div>
<div class="feld" style="margin-top:16px"><label for="rechtsgrundlagen">Rechtsgrundlagen</label>
<textarea class="field" id="rechtsgrundlagen" name="rechtsgrundlagen">${esc(w.rechtsgrundlagen)}</textarea></div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Stammdaten speichern</button>
<span class="meta">Wirkt auf alle Türen — Berichte werden neu erzeugt.</span></div>
</form>`;
}

/* ── Eine Tür ──────────────────────────────────────────────────────────────── */

export async function tuerSeite(
  env: Env,
  nutzer: Nutzer,
  wartungId: string,
  nr: number | null,
): Promise<Response> {
  const w = await wartungLesen(env.DB, wartungId);
  if (!w) return umleitung("/wartungen");
  const v = vorlage(w.vorlage);
  const tueren = await tuerenLesen(env.DB, wartungId);
  const t = nr === null ? null : tueren.find((x) => x.nr === nr) ?? null;
  const nummer = t?.nr ?? (tueren.length ? Math.max(...tueren.map((x) => x.nr)) + 1 : 1);
  const vorige = tueren.filter((x) => x.nr < nummer).pop() ?? null;

  /* Neue Tür: Ortsangaben der vorigen sind fast immer der bessere Startwert als leer. */
  const felder = t?.felder ?? (vorige ? { ...vorige.felder, RAUM: "", RAUMBEZ: "" } : {});
  const checks = t?.checks ?? {};

  const punkte = v.punkte
    .map((p) => {
      const gewaehlt = (checks[p.nr] as string) ?? "io";
      const knoepfe = (["io", "nio", "nz", "sb"] as const)
        .map(
          (b) => `<label title="${esc(BEWERTUNGEN[b])}">
<input type="radio" name="p_${esc(p.nr)}" value="${b}"${gewaehlt === b ? " checked" : ""}>
<span>${b === "io" ? "i.O." : b === "nio" ? "nicht" : b === "nz" ? "entf." : "Bem."}</span></label>`,
        )
        .join("");
      return `<div class="punkt"><div class="txt"><b>${esc(p.nr)}</b>${esc(p.text)}</div>
<div class="wahl">${knoepfe}</div></div>`;
    })
    .join("");

  const ziel = `/wartung/${encodeURIComponent(wartungId)}/tuer/${t ? t.nr : "neu"}`;

  return seite(
    `<div class="zeile oben"><div>
<div class="eyebrow">${esc(w.objekt || w.id)}</div>
<h1 class="seite" style="margin-top:8px">Tür ${nummer}</h1></div></div>

<form class="karte" method="post" action="${esc(ziel)}">
<div class="felder">
${v.tuerfelder.map((f) => textfeld(`f_${f}`, label(f), felder[f] ?? "")).join("")}
<div class="feld"><label for="ergebnis">Ergebnis</label>
<select class="field" id="ergebnis" name="ergebnis">
${["bestanden", "Nachbesserung"]
  .map(
    (e) =>
      `<option value="${esc(e)}"${(t?.ergebnis || "bestanden") === e ? " selected" : ""}>${esc(e)}</option>`,
  )
  .join("")}
</select></div>
</div>

<h2 class="abschnitt">Prüfpunkte</h2>
<p class="meta">Standard ist „in Ordnung". Nur ändern, was abweicht.</p>
<div class="punkte">${punkte}</div>

<div class="feld" style="margin-top:22px"><label for="hinweise">Hinweise / Bemerkungen</label>
<textarea class="field" id="hinweise" name="hinweise">${esc(t?.hinweise ?? "")}</textarea></div>

<div class="knopfleiste">
<button class="btn schmal" type="submit">Tür speichern</button>
<a class="btn schmal leise" href="/wartung/${encodeURIComponent(wartungId)}">Zurück</a>
${
  t
    ? `<button class="btn schmal gefahr" type="submit" formaction="${esc(ziel)}/loeschen"
        onclick="return confirm('Tür ${t.nr} wirklich löschen?')">Löschen</button>`
    : ""
}
</div></form>`,
    { titel: `Tür ${nummer}`, nutzer, aktiv: "wartungen" },
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
<p class="meta">Füllen jede neue Wartung vor, damit sie nicht jedes Mal diktiert werden müssen.</p>
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
<li><b>Starten</b> — „Türenwartung Objekt Heselstücken 12, Vorlage Drehflügel."</li>
<li><b>Diktieren</b> — Tür für Tür. Standard ist alles in Ordnung, du nennst nur die Ausnahmen:
„Tür 6, Punkt 8 nicht." Jede Tür landet sofort hier.</li>
<li><b>Serie</b> — „Wie davor, außer Etage 2."</li>
<li><b>Fertig</b> — Claude liest zurück, du bestätigst, dann „Go" für die Berichte.</li>
</ul>

<h2 class="abschnitt">Tools</h2>
<p class="meta">Der Katalog steht öffentlich unter <a href="/tools.json" style="text-decoration:underline">/tools.json</a>.</p>`,
    {
      titel: "Claude verbinden",
      nutzer,
      aktiv: "verbinden",
      skript: `document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');
if(!b)return;navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){
var o=b.textContent;b.textContent='Kopiert';b.classList.add('done');
setTimeout(function(){b.textContent=o;b.classList.remove('done')},1500)})});`,
    },
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
Wartungen lesen und schreiben und Berichte erzeugen. Der Zugriff lässt sich jederzeit widerrufen.</p>

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
