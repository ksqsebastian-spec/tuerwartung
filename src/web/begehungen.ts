/**
 * Die Begehungsseiten: der Termin mit seinen Prüfungen, das Prüfraster je Bauteil und die
 * Unterschrift des Betreibers.
 *
 * Die Begehungsseite ist die Arbeitsfläche eines Termins — was geprüft ist, was noch fehlt,
 * welche Berichte in welcher Version daraus entstanden sind.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import {
  datum as datumAnzeige,
  esc,
  faelligChip,
  seite,
  textfeld,
  datumsfeld,
  umleitung,
  zeitpunkt,
} from "./layout";
import {
  BEWERTUNGEN,
  BEWERTUNGEN_KURZ,
  VORLAGEN,
  VORLAGEN_IDS,
  abweichungenKlartext,
  feldLabel,
  vorlage,
} from "../vorlagen";
import type { Bewertung } from "../vorlagen";
import { geschosseListe, objektLesen } from "../daten/objekte";
import { bauteileMitStand, inLaufreihenfolge, istFaellig } from "../daten/bauteile";
import type { BauteilMitStand } from "../daten/bauteile";
import { begehungLesen, pruefungenLesen } from "../daten/begehungen";
import type { Begehung } from "../daten/begehungen";
import { tuertypenListe, typOderVorrat } from "../daten/tuertypen";
import { TYPEN_VORRAT } from "../vorlagen/typenvorrat";
import { berichtsUebersicht } from "../pdf/berichte";
import { sammelberichteLesen } from "../daten/berichte";

/**
 * Eine Tür erfassen — und zwar über ihren Türtyp, nicht über eine nackte Vorlage.
 *
 * Vorher stand hier ein Auswahlfeld „Vorlage" und darunter die Punkte dieser Vorlage. Damit ging
 * die halbe Anwendung am eigenen Kern vorbei: die Checkliste, die jemand am Türtyp zurechtgelegt
 * hat, kam im Browser nie an, Pflichtfelder wurden nicht verlangt, Zusatzfelder gab es nicht, und
 * die falsche Vorlage war ein Klick weit weg.
 *
 * Jetzt ist es eine Frage nach der anderen: **was für eine Tür ist das?** — dann alles Weitere.
 * Bei einer Tür, die es schon gibt, entfällt die Frage, denn der Typ steht an ihr.
 */
export async function pruefungSeite(
  env: Env,
  nutzer: Nutzer,
  begehungId: string,
  nr: number | null,
  opt: { typ?: string; meldung?: string } = {},
): Promise<Response> {
  const begehung = await begehungLesen(env.DB, begehungId);
  if (!begehung) return umleitung("/objekte");
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) return umleitung("/objekte");

  const bauteile = await bauteileMitStand(env.DB, objekt, { auch_stillgelegte: true });
  const bauteil = nr === null ? null : (bauteile.find((b) => b.nr === nr) ?? null);
  const pruefungen = await pruefungenLesen(env.DB, begehung.id);
  const pruefung = bauteil ? pruefungen.find((p) => p.bauteil_id === bauteil.id) : undefined;
  const vorige = pruefungen[pruefungen.length - 1];

  /*
   * Woher der Türtyp kommt, in dieser Reihenfolge: was gerade gewählt wurde, was an der Tür
   * steht, was die zuletzt erfasste Tür hatte. Die letzte Regel spart im Treppenhaus jeden
   * zweiten Klick — dort steht zwanzigmal derselbe Typ.
   */
  const wahl =
    opt.typ !== undefined
      ? opt.typ.trim() /* leer heißt: der Nutzer will ausdrücklich neu wählen */
      : bauteil?.tuertyp_id || (bauteil ? "" : (vorige?.bauteil.tuertyp_id ?? ""));
  const typ = wahl ? await typOderVorrat(env.DB, wahl) : null;

  const nummer = bauteil?.nr ?? (bauteile.length ? Math.max(...bauteile.map((b) => b.nr)) + 1 : 1);
  const zurueck = `/begehung/${esc(begehung.id)}`;

  /* Ohne Typ geht es nicht weiter — also erst diese eine Frage, und sonst nichts auf der Seite. */
  if (!typ) {
    return typenwahlSeite(env, nutzer, begehung, objekt.name, nummer, bauteil?.nr ?? null);
  }

  const v = vorlage(typ.art);
  const felder = { ...typ.felder, ...(bauteil?.felder ?? {}) };
  const checks = pruefung?.checks ?? {};

  /* Die Punkte des Türtyps, nicht die der Vorlage: umbenannt, ausgeblendet, eigene ergänzt. */
  const punkte = typ.punkte
    .filter((p) => p.aktiv)
    .map((p) => {
      const gewaehlt = (checks[p.nr] as string) ?? "io";
      const knoepfe = (["io", "nio", "nz", "sb"] as const)
        .map(
          (bw) => `<label title="${esc(BEWERTUNGEN[bw])}">
<input type="radio" name="p_${esc(p.nr)}" value="${bw}"${gewaehlt === bw ? " checked" : ""}>
<span>${esc(BEWERTUNGEN_KURZ[bw])}</span></label>`,
        )
        .join("");
      return `<div class="punkt"><div class="txt"><b>${esc(p.nr)}</b>${esc(p.text)}${
        p.eigen ? ' <span class="chip leise">eigen</span>' : ""
      }</div>
<div class="wahl">${knoepfe}</div></div>`;
    })
    .join("");

  /*
   * Erst die Pflichtfelder des Typs, dann seine Zusatzfelder, dann der Rest der Vorlage. Was
   * Pflicht ist, ist auch im Formular Pflicht — der Server prüft es noch einmal, aber ein
   * Browser, der gleich meckert, erspart den Weg dorthin.
   */
  const pflicht = new Set(typ.pflicht);
  const zusatzSchluessel = new Set(typ.zusatz.map((z) => z.schluessel));
  const feldZeile = (f: string, label: string, muss: boolean) =>
    `<div class="feld"><label for="f_${esc(f)}">${esc(label)}${muss ? " *" : ""}</label>
<input class="field" id="f_${esc(f)}" name="f_${esc(f)}" value="${esc(felder[f] ?? "")}"${
      muss ? " required" : ""
    }></div>`;

  const restFelder = v.bauteilfelder.filter(
    (f) => !["RAUM", "FLUR", "RAUMBEZ"].includes(f) && !pflicht.has(f) && !zusatzSchluessel.has(f),
  );

  const ziel = `/begehung/${encodeURIComponent(begehung.id)}/pruefung/${bauteil ? bauteil.nr : "neu"}`;
  const ort =
    bauteil && [bauteil.raumnummer, bauteil.raum, bauteil.flur].filter(Boolean).join(" · ");

  return seite(
    `<div class="zeile oben"><div>
<div class="eyebrow"><a href="${zurueck}">${esc(objekt.name)} · ${esc(
      datumAnzeige(begehung.datum),
    )}</a></div>
<h1 class="seite" style="margin-top:8px">Tür ${nummer}</h1>
<p class="meta" style="margin-top:8px">${esc(typ.name)} · ${esc(
      VORLAGEN[typ.art]?.label ?? typ.art,
    )} · ${typ.punkte.filter((p) => p.aktiv).length} Prüfpunkte${
      ort ? ` · ${esc(ort)}` : ""
    }</p>
<div class="leiseleiste"><a href="${zurueck}/pruefung/${
      bauteil ? bauteil.nr : "neu"
    }?typ=">Anderer Türtyp</a>${
      typ.id ? ` · <a href="/checkliste/${esc(typ.id)}">Checkliste ansehen</a>` : ""
    }</div></div></div>
${opt.meldung ? `<div class="note" style="margin:22px 0">${esc(opt.meldung)}</div>` : ""}

<form class="karte" method="post" action="${esc(ziel)}">
<input type="hidden" name="tuertyp" value="${esc(typ.id ?? typ.name)}">
<div class="felder">
${bauteil ? "" : textfeld("nr", "Nummer", String(nummer))}
${textfeld("raumnummer", "Raumnummer", bauteil?.raumnummer ?? "")}
${textfeld("raum", "Raum", bauteil?.raum ?? "")}
${textfeld("flur", "Flur", bauteil?.flur ?? "")}
${[...pflicht].map((f) => feldZeile(f, feldLabel(f), true)).join("")}
${typ.zusatz.map((z) => feldZeile(z.schluessel, z.label || feldLabel(z.schluessel), z.pflicht)).join("")}
</div>
${
  pflicht.size
    ? `<p class="meta">Mit * markierte Felder müssen stehen, bevor geprüft werden kann — so
verlangt es der Türtyp.</p>`
    : ""
}
${
  /*
   * Hersteller, Zulassung, Obentürschließer — das steht am Türtyp und ist für alle seine Türen
   * gleich. Es hier je Tür abzufragen war der Grund, warum das Formular acht Felder lang war,
   * bevor der erste Prüfpunkt kam. Jetzt liegt es eingeklappt darunter, für den Einzelfall.
   */
  restFelder.length
    ? `<details class="klapp" style="margin-top:8px">
<summary>Weitere Angaben <span class="meta">stehen meist schon am Türtyp</span></summary>
<div class="felder" style="margin-top:12px">
${restFelder.map((f) => feldZeile(f, feldLabel(f), false)).join("")}
</div></details>`
    : ""
}

<h2 class="abschnitt">Prüfpunkte</h2>
<p class="meta">Standard ist „in Ordnung". Nur ändern, was abweicht — eine Abweichung heißt
automatisch „nicht bestanden".</p>
<div class="punkte">${punkte}</div>

<div class="feld" style="margin-top:22px"><label for="hinweise">Hinweise / Bemerkungen</label>
<textarea class="field" id="hinweise" name="hinweise">${esc(pruefung?.hinweise ?? "")}</textarea>
<div class="hinweis">Wird bei einer Abweichung zur Beschreibung des Mangels.</div></div>

<div class="knopfleiste">
<button class="btn schmal" type="submit">Prüfung speichern</button>
<a class="btn schmal leise" href="${zurueck}">Zurück</a>
${bauteil ? `<a class="btn schmal leise" href="/objekt/${esc(objekt.id)}/bauteil/${bauteil.nr}">Bauteil</a>` : ""}
</div></form>`,
    { titel: `Tür ${nummer}`, nutzer, aktiv: "objekte" },
  );
}

/**
 * Die eine Frage vor allen anderen: was für eine Tür ist das?
 *
 * Eingerichtete Typen zuerst, darunter der Vorrat. Der Vorrat ist der Grund, warum diese Seite
 * nie leer ist — ohne ihn stünde hier am ersten Tag „noch kein Türtyp" und der Weg wäre zu Ende.
 */
async function typenwahlSeite(
  env: Env,
  nutzer: Nutzer,
  begehung: Begehung,
  objektName: string,
  nummer: number,
  bauteilNr: number | null,
): Promise<Response> {
  const eigene = await tuertypenListe(env.DB);
  const belegt = new Set(eigene.map((t) => t.name.toLowerCase()));
  const offen = TYPEN_VORRAT.filter((v) => !belegt.has(v.name.toLowerCase()));
  const ziel = `/begehung/${encodeURIComponent(begehung.id)}/pruefung/${
    bauteilNr === null ? "neu" : bauteilNr
  }`;

  const posten = (name: string, wahl: string, unter: string) =>
    `<a class="posten" href="${esc(ziel)}?typ=${encodeURIComponent(wahl)}">
<div class="haupt"><div class="name">${esc(name)}</div>
<div class="unter">${esc(unter)}</div></div></a>`;

  /* Nach Art gruppiert: sechzehn Namen am Stück liest niemand, drei kurze Listen schon. */
  const gruppen = VORLAGEN_IDS.map((id) => ({
    id,
    label: VORLAGEN[id].label,
    typen: offen.filter((v) => v.art === id),
  })).filter((g) => g.typen.length);

  return seite(
    `<div class="eyebrow"><a href="/begehung/${esc(begehung.id)}">${esc(objektName)} · ${esc(
      datumAnzeige(begehung.datum),
    )}</a></div>
<h1 class="seite" style="margin-top:8px">Tür ${nummer}</h1>
<p class="satz" style="margin-top:10px">Was für eine Tür ist das? Der Typ bestimmt die
Checkliste und was an der Tür stehen muss.</p>

${
  eigene.length
    ? `<h2 class="abschnitt">Eingerichtet</h2>
<div class="liste">${eigene
        .map((t) =>
          posten(
            t.name,
            t.id,
            `${VORLAGEN[t.art]?.label ?? t.art} · ${t.punkte.filter((p) => p.aktiv).length} Prüfpunkte`,
          ),
        )
        .join("")}</div>`
    : ""
}

${
  offen.length
    ? `<h2 class="abschnitt">Häufige Typen</h2>
<p class="meta" style="margin-bottom:14px">Noch nicht eingerichtet — wird beim Speichern angelegt,
mit der Checkliste seiner Vorlage. Umbenennen und anpassen geht danach in den Stammdaten.</p>
${gruppen
        .map(
          (g) => `<h3 class="unterabschnitt">${esc(g.label)}</h3>
<div class="liste">${g.typen.map((v) => posten(v.name, v.name, v.beschreibung)).join("")}</div>`,
        )
        .join("")}`
    : ""
}

<div class="knopfleiste" style="margin-top:26px">
<a class="btn schmal leise" href="/stammdaten">Eigenen Türtyp anlegen</a>
<a class="btn schmal leise" href="/begehung/${esc(begehung.id)}">Abbrechen</a></div>`,
    { titel: `Tür ${nummer}`, nutzer, aktiv: "objekte" },
  );
}

/* ── Unterschrift des Betreibers ───────────────────────────────────────────── */

export async function unterschriftSeite(
  env: Env,
  nutzer: Nutzer,
  begehungId: string,
  meldung?: string,
): Promise<Response> {
  const begehung = await begehungLesen(env.DB, begehungId);
  if (!begehung) return umleitung("/objekte");
  const objekt = await objektLesen(env.DB, begehung.objekt_id);
  if (!objekt) return umleitung("/objekte");

  /* Das Feld ist bewusst groß und ohne Rahmenwerk: ein Finger auf einem Handy, mehr nicht. */
  const skript = `
const feld = document.getElementById('feld');
const ctx = feld.getContext('2d');
const knopf = document.getElementById('senden');
let malt = false, leer = true;

function groesse() {
  const breite = feld.parentElement.clientWidth;
  const dpr = window.devicePixelRatio || 1;
  const daten = leer ? null : feld.toDataURL('image/png');
  feld.width = Math.round(breite * dpr);
  feld.height = Math.round(220 * dpr);
  feld.style.height = '220px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111';
  if (daten) { const bild = new Image(); bild.onload = () => ctx.drawImage(bild, 0, 0, breite, 220); bild.src = daten; }
}
groesse();
window.addEventListener('resize', groesse);

function punkt(e) {
  const r = feld.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
feld.addEventListener('pointerdown', (e) => {
  feld.setPointerCapture(e.pointerId);
  malt = true; leer = false; knopf.disabled = false;
  const p = punkt(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
});
feld.addEventListener('pointermove', (e) => {
  if (!malt) return;
  e.preventDefault();
  const p = punkt(e); ctx.lineTo(p.x, p.y); ctx.stroke();
});
for (const art of ['pointerup', 'pointercancel', 'pointerleave']) {
  feld.addEventListener(art, () => { malt = false; });
}
document.getElementById('leeren').addEventListener('click', () => {
  ctx.clearRect(0, 0, feld.width, feld.height);
  leer = true; knopf.disabled = true;
});

document.getElementById('form').addEventListener('submit', (e) => {
  if (leer) { e.preventDefault(); return; }
  /* Auf höchstens 800 × 300 verkleinern — mehr braucht das PDF nicht. */
  const ziel = document.createElement('canvas');
  const faktor = Math.min(800 / feld.width, 300 / feld.height, 1);
  ziel.width = Math.round(feld.width * faktor);
  ziel.height = Math.round(feld.height * faktor);
  ziel.getContext('2d').drawImage(feld, 0, 0, ziel.width, ziel.height);
  document.getElementById('bild').value = ziel.toDataURL('image/png');
});`;

  return seite(
    `<div class="eyebrow"><a href="/begehung/${esc(begehung.id)}">${esc(objekt.name)} · ${esc(
      datumAnzeige(begehung.datum),
    )}</a></div>
<h1 class="seite" style="margin-top:8px">Betreiber unterschreibt</h1>
<p class="lede" style="margin-top:12px;max-width:46ch">Mit dem Finger unterschreiben. Danach
entstehen die Berichte neu — mit der Unterschrift an ihrer Stelle im Formular.</p>
${meldung ? `<div class="note" style="margin:22px 0">${esc(meldung)}</div>` : ""}
${
  begehung.betreiber_unterschrift
    ? `<p class="meta" style="margin-top:18px">Bisher unterschrieben von <b>${esc(
        begehung.betreiber_name,
      )}</b> am ${esc(zeitpunkt(begehung.unterschrieben_am))}.</p>
<img src="/datei/${esc(begehung.betreiber_unterschrift)}" alt="Unterschrift"
  style="max-height:90px;margin:14px 0;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px">`
    : ""
}

<form class="karte" id="form" method="post" action="/begehung/${esc(begehung.id)}/unterschrift"
  style="margin-top:22px">
<input type="hidden" name="bild" id="bild">
<div class="felder">
${textfeld("name", "Name des Unterzeichnenden", begehung.betreiber_name, "required")}
</div>
<div style="margin-top:18px">
<canvas id="feld" style="width:100%;background:#fff;border:1px dashed var(--line-strong);
  border-radius:14px;touch-action:none"></canvas>
</div>
<div class="knopfleiste">
<button class="btn schmal" type="submit" id="senden" disabled>Unterschreiben</button>
<button class="btn schmal leise" type="button" id="leeren">Leeren</button>
<a class="btn schmal leise" href="/begehung/${esc(begehung.id)}">Zurück</a></div>
</form>`,
    { titel: "Unterschrift", nutzer, aktiv: "objekte", skript },
  );
}

export type { BauteilMitStand, Bewertung };
