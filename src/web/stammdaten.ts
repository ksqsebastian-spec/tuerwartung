/**
 * Stammdaten und Checkliste — die zwei Seiten, die oben in der Leiste sitzen.
 *
 * Die Reihenfolge der Arbeit hat sich umgedreht: nicht mehr „diktier los, der Rest ergibt sich",
 * sondern erst den Türtyp einrichten, dann seine Checkliste zurechtlegen, dann Türen anlegen.
 * Deshalb stehen beide Seiten global und nicht am Objekt: ein Türtyp gilt über alle Objekte,
 * und seine Checkliste bleibt gleich — genau darum gehört sie nach oben.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import { esc, seite, textfeld, umleitung, zeitpunkt } from "./layout";
import { VORLAGEN, VORLAGEN_IDS, feldLabel } from "../vorlagen";
import { tuertypLesen, tuertypenListe } from "../daten/tuertypen";
import type { Tuertyp } from "../daten/tuertypen";
import { TYPEN_VORRAT } from "../vorlagen/typenvorrat";
import type { VorratsTyp } from "../vorlagen/typenvorrat";

/** Die Felder, die ein Türtyp als Stammdaten führen kann — aus seiner Vorlage. */
export function typFelder(art: string): string[] {
  return VORLAGEN[art]?.bauteilfelder ?? [];
}

function typZeile(t: Tuertyp): string {
  const punkte = t.punkte.filter((p) => p.aktiv).length;
  return `<a class="posten" href="/stammdaten/${esc(t.id)}">
<div class="haupt"><div class="name">${esc(t.name)}</div>
<div class="unter">${esc(VORLAGEN[t.art]?.label ?? t.art)} · ${punkte} Prüfpunkte${
    t.pflicht.length ? ` · Pflicht: ${esc(t.pflicht.map(feldLabel).join(", "))}` : ""
  }</div></div>
<span class="chip leise">${esc(t.art.replace("wartung_", ""))}</span></a>`;
}

/* ── Übersicht ─────────────────────────────────────────────────────────────── */

export async function stammdatenSeite(
  env: Env,
  nutzer: Nutzer,
  meldung?: string,
): Promise<Response> {
  const typen = await tuertypenListe(env.DB, { auch_stillgelegte: true });
  const aktiv = typen.filter((t) => t.aktiv);
  const still = typen.filter((t) => !t.aktiv);
  /* Was schon eingerichtet ist, steht nicht noch einmal im Vorrat. */
  const belegt = new Set(typen.map((t) => t.name.toLowerCase()));
  const vorrat = TYPEN_VORRAT.filter((v) => !belegt.has(v.name.toLowerCase()));

  const vorratZeile = (v: VorratsTyp) =>
    `<form method="post" action="/stammdaten/aus-vorrat" class="posten">
<input type="hidden" name="name" value="${esc(v.name)}">
<div class="haupt"><div class="name">${esc(v.name)}</div>
<div class="unter">${esc(v.beschreibung)}${
      v.pflicht.length ? ` · Pflicht: ${esc(v.pflicht.map(feldLabel).join(", "))}` : ""
    }</div></div>
<button class="btn schmal leise" type="submit">Übernehmen</button></form>`;

  return seite(
    `<h1 class="seite">Stammdaten</h1>
<div class="naechster"><p class="satz">${
      aktiv.length
        ? `${aktiv.length} ${aktiv.length === 1 ? "Türtyp" : "Türtypen"} eingerichtet. ` +
          "Ein Türtyp trägt, was für alle Türen dieser Art gleich ist — und seine Checkliste."
        : "Noch kein eigener Türtyp — nötig ist das auch nicht. Die häufigen liegen unten bereit " +
          "und entstehen, sobald du einen benutzt."
    }</p></div>
${meldung ? `<div class="note" style="margin-bottom:22px">${esc(meldung)}</div>` : ""}
${aktiv.length ? `<div class="liste">${aktiv.map(typZeile).join("")}</div>` : ""}
${
  still.length
    ? `<h2 class="abschnitt">Stillgelegt</h2><div class="liste">${still.map(typZeile).join("")}</div>`
    : ""
}

${
  vorrat.length
    ? `<h2 class="abschnitt">Häufige Türtypen</h2>
<p class="meta" style="margin-bottom:14px">Liegen bereit und sind noch nicht angelegt. Ein Klick
übernimmt einen samt Checkliste; danach lässt er sich umbenennen und anpassen. Beim Erfassen
einer Tür stehen sie ohnehin zur Auswahl — übernehmen musst du hier nichts.</p>
<div class="liste">${vorrat.map(vorratZeile).join("")}</div>`
    : ""
}

<details class="klapp" style="margin-top:30px">
<summary>Eigenen Türtyp anlegen <span class="meta">oder im Chat mit tuertyp_anlegen</span></summary>
<form class="karte" method="post" action="/stammdaten" style="margin-top:8px">
<div class="felder">
${textfeld("name", "Name", "", 'required placeholder="T30 Flurtür Hörmann"')}
<div class="feld"><label for="art">Vorlage</label>
<select class="field" id="art" name="art">
${VORLAGEN_IDS.map((id) => `<option value="${id}">${esc(VORLAGEN[id].label)}</option>`).join("")}
</select>
<p class="meta" style="margin-top:6px">Bestimmt das Formular und die Grund-Prüfpunkte.</p></div>
</div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Anlegen</button></div>
</form>
</details>`,
    { titel: "Stammdaten", nutzer, aktiv: "stammdaten" },
  );
}

/* ── Ein Türtyp ────────────────────────────────────────────────────────────── */

export async function tuertypSeite(
  env: Env,
  nutzer: Nutzer,
  id: string,
  meldung?: string,
): Promise<Response> {
  const t = await tuertypLesen(env.DB, id);
  if (!t) return umleitung("/stammdaten");
  const felder = typFelder(t.art);
  /* An einem Typ, an dem nie eine Tür hing, ist nichts zu bewahren — der darf ganz weg. */
  const benutzt = Number(
    (
      await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM bauteile WHERE tuertyp_id = ?1)
              + (SELECT COUNT(*) FROM vorschlaege WHERE tuertyp_id = ?1) AS n`,
      )
        .bind(t.id)
        .first()
    )?.n ?? 0,
  );

  const kasten = (feld: string) =>
    `<label class="kaestchen"><input type="checkbox" name="pflicht" value="${esc(feld)}"${
      t.pflicht.includes(feld) ? " checked" : ""
    }> ${esc(feldLabel(feld))}</label>`;

  return seite(
    `<div class="eyebrow"><a href="/stammdaten">Stammdaten</a></div>
<h1 class="seite" style="margin-top:8px">${esc(t.name)}</h1>
<p class="meta" style="margin-top:8px">${esc(VORLAGEN[t.art]?.label ?? t.art)} · ${
      t.punkte.filter((p) => p.aktiv).length
    } Prüfpunkte · angelegt ${esc(zeitpunkt(t.angelegt_am))}</p>
<div class="leiseleiste"><a href="/checkliste/${esc(t.id)}">Checkliste anpassen</a></div>
${meldung ? `<div class="note" style="margin:22px 0">${esc(meldung)}</div>` : ""}

<form class="karte" method="post" action="/stammdaten/${esc(t.id)}" style="margin-top:22px">
<div class="felder">
${textfeld("name", "Name", t.name)}
${textfeld("beschreibung", "Beschreibung", t.beschreibung)}
</div>

<h2 class="abschnitt">Gemeinsame Angaben</h2>
<p class="meta" style="margin-bottom:14px">Was hier steht, gilt für jede Tür dieses Typs und
muss nicht wiederholt werden.</p>
<div class="felder">
${felder
  .map((f) => textfeld(`feld_${f}`, feldLabel(f), t.felder[f] ?? ""))
  .join("")}
</div>

<h2 class="abschnitt">Muss vor der Prüfung stehen</h2>
<p class="meta" style="margin-bottom:14px">Solange eines davon an einer Tür fehlt, ist sie nicht
bereit — weder im Chat noch hier.</p>
<div class="kaestchen-reihe">${felder.map(kasten).join("")}
<label class="kaestchen"><input type="checkbox" name="pflicht" value="IDENT"${
      t.pflicht.includes("IDENT") ? " checked" : ""
    }> Ident-Nummer</label></div>

<h2 class="abschnitt">Zusätzlich je Tür erfassen</h2>
<p class="meta" style="margin-bottom:14px">Eigene Felder, die es in der Vorlage nicht gibt —
ein Feld je Zeile, als <code>KURZNAME = Beschriftung</code>. Ein Stern dahinter macht es zur
Pflicht.</p>
<div class="feld"><label for="zusatz">Zusatzfelder</label>
<textarea class="field" id="zusatz" name="zusatz" rows="4"
  placeholder="GESCHOSS = Geschoss&#10;KOMMENTAR = Kommentar">${esc(
      t.zusatz
        .map((z) => `${z.schluessel} = ${z.label}${z.pflicht ? " *" : ""}`)
        .join("\n"),
    )}</textarea></div>

<div class="knopfleiste"><button class="btn schmal" type="submit">Speichern</button>
<span class="meta">Wirkt auf künftige Prüfungen; erzeugte Berichte bleiben.</span></div>
</form>

<div class="knopfleiste">
<form method="post" action="/stammdaten/${esc(t.id)}/stilllegen"
  onsubmit="return confirm('${esc(t.name)} stilllegen? Bestehende Türen behalten ihre Historie.')">
<button class="btn schmal gefahr" type="submit">${
      t.aktiv ? "Türtyp stilllegen" : "Wieder in Betrieb nehmen"
    }</button>
</form>${
      benutzt
        ? ""
        : `
<form method="post" action="/stammdaten/${esc(t.id)}/loeschen"
  onsubmit="return confirm('${esc(t.name)} löschen? Es hängt keine Tür daran.')">
<button class="btn schmal leise" type="submit">Löschen</button>
</form>`
    }
</div>
<p class="meta" style="margin-top:10px">${
      benutzt
        ? `${benutzt} ${benutzt === 1 ? "Tür hängt" : "Türen hängen"} an diesem Typ — löschen ` +
          "geht nicht mehr, stilllegen schon."
        : "Noch keine Tür an diesem Typ."
    }</p>`,
    { titel: t.name, nutzer, aktiv: "stammdaten" },
  );
}

/* ── Checkliste ────────────────────────────────────────────────────────────── */

export async function checklisteSeite(
  env: Env,
  nutzer: Nutzer,
  id: string | null,
  meldung?: string,
): Promise<Response> {
  const typen = await tuertypenListe(env.DB);
  const t = id ? await tuertypLesen(env.DB, id) : typen[0] ?? null;

  if (!t) {
    return seite(
      `<h1 class="seite">Checkliste</h1>
<div class="naechster"><p class="satz">Die Checkliste hängt am Türtyp — und noch gibt es keinen.
Leg unter Stammdaten einen an, dann steht sie hier.</p>
<div class="knopfleiste" style="margin:0">
<a class="btn schmal" href="/stammdaten">Zu den Stammdaten</a></div></div>`,
      { titel: "Checkliste", nutzer, aktiv: "checkliste" },
    );
  }

  const umschalter =
    typen.length > 1
      ? `<nav class="reiter">${typen
          .map(
            (x) =>
              `<a href="/checkliste/${esc(x.id)}"${
                x.id === t.id ? ' aria-current="page"' : ""
              }>${esc(x.name)}</a>`,
          )
          .join("")}</nav>`
      : "";

  const zeilen = t.punkte
    .map(
      (p) => `<div class="punktzeile${p.aktiv ? "" : " aus"}">
<span class="marke">${esc(p.nr)}</span>
<input class="field" name="text_${esc(p.nr)}" value="${esc(p.text)}" aria-label="Text zu Punkt ${esc(p.nr)}">
<label class="kaestchen"><input type="checkbox" name="aktiv" value="${esc(p.nr)}"${
        p.aktiv ? " checked" : ""
      }> sichtbar</label>
${p.eigen ? '<span class="chip leise">eigen</span>' : ""}
</div>`,
    )
    .join("");

  return seite(
    `${umschalter}
<h1 class="seite">Checkliste</h1>
<p class="meta" style="margin-top:8px">${esc(t.name)} · ${esc(
      VORLAGEN[t.art]?.label ?? t.art,
    )}</p>
<div class="naechster"><p class="satz">Diese Punkte gelten für jede Tür dieses Typs — beim
Diktieren wie im Bericht. Text ändern, Haken wegnehmen zum Ausblenden, unten eigene ergänzen.</p></div>
${meldung ? `<div class="note" style="margin-bottom:22px">${esc(meldung)}</div>` : ""}

<form method="post" action="/checkliste/${esc(t.id)}">
<div class="punktliste-bearbeiten">${zeilen}</div>
<div class="feld" style="margin-top:20px"><label for="neu">Eigene Punkte ergänzen</label>
<textarea class="field" id="neu" name="neu" rows="3"
  placeholder="Ein Punkt je Zeile"></textarea>
<p class="meta" style="margin-top:6px">Eigene Punkte bekommen Nummern ab 900. Das Formular hat
für sie kein Kästchen — im Bericht stehen sie unter „Hinweise".</p></div>
<div class="knopfleiste"><button class="btn schmal" type="submit">Speichern</button>
<button class="btn schmal leise" type="submit" name="tun" value="zuruecksetzen"
  onclick="return confirm('Alle Anpassungen verwerfen und die Punkte der Vorlage wiederherstellen?')">
Auf Vorlage zurücksetzen</button></div>
</form>`,
    { titel: `Checkliste ${t.name}`, nutzer, aktiv: "checkliste" },
  );
}

/** „GESCHOSS = Geschoss *" je Zeile → Zusatzfelder. */
export function zusatzfelderLesen(text: string): { schluessel: string; label: string; pflicht: boolean }[] {
  const out: { schluessel: string; label: string; pflicht: boolean }[] = [];
  for (const zeile of text.split("\n")) {
    const roh = zeile.trim();
    if (!roh) continue;
    const pflicht = roh.endsWith("*");
    const ohneStern = pflicht ? roh.slice(0, -1).trim() : roh;
    const [links, rechts] = ohneStern.split("=");
    const schluessel = (links ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    if (!schluessel) continue;
    out.push({ schluessel, label: (rechts ?? links).trim(), pflicht });
  }
  return out;
}
