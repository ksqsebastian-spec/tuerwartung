/**
 * Die Planseite: das Rasterbild eines Geschosses mit den Vorschlägen darauf.
 *
 * Sie ist der Ort, an dem ein Mensch bestätigt, was Claude im Plan gefunden hat — und ohne
 * Import derselbe Ort, um bestehende Bauteile zu verorten. Das Bild ist optional: der Import
 * funktioniert auch ohne, dann eben als Liste statt als Karte.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import { esc, seite, umleitung } from "./layout";
import planClient from "./plan.client.js.txt";
import { geschosseListe, objektLesen } from "../daten/objekte";
import type { Geschoss, Objekt } from "../daten/objekte";
import { bauteileMitStand } from "../daten/bauteile";
import { importeListe, vorschlaegeLesen, zaehlen } from "../daten/importe";

/** Alles, was die Karte zeichnet — auch als `daten.json` zum Auffrischen. */
export async function planDaten(
  env: Env,
  objekt: Objekt,
  geschoss: Geschoss,
): Promise<Record<string, unknown>> {
  const vorschlaege = await vorschlaegeLesen(env.DB, {
    objekt_id: objekt.id,
    geschoss_id: geschoss.id,
    status: "alle",
  });
  const bauteile = (await bauteileMitStand(env.DB, objekt)).filter(
    (b) => b.geschoss_id === geschoss.id,
  );
  return {
    geschoss: { id: geschoss.id, name: geschoss.name },
    plan: geschoss.plan_schluessel
      ? {
          bild: `/datei/${geschoss.plan_schluessel}`,
          breite: geschoss.plan_breite,
          hoehe: geschoss.plan_hoehe,
        }
      : null,
    start: { x: geschoss.start_x, y: geschoss.start_y },
    vorschlaege: vorschlaege.map((v) => ({
      id: v.id,
      x: v.x,
      y: v.y,
      kennung: v.kennung,
      raumnummer: v.raumnummer,
      raum: v.raum,
      art: v.art,
      konfidenz: v.konfidenz,
      wartungspflichtig: v.wartungspflichtig === 1,
      status: v.status,
      text_nahe: v.text_nahe,
    })),
    bauteile: bauteile.map((b) => ({
      nr: b.nr,
      x: b.x,
      y: b.y,
      raum: b.raum || b.bezeichnung,
      kennung: b.kennung,
    })),
  };
}

export async function planSeite(
  env: Env,
  nutzer: Nutzer,
  objektId: string,
  geschossId: string,
  meldung?: string,
): Promise<Response> {
  const objekt = await objektLesen(env.DB, objektId);
  if (!objekt) return umleitung("/objekte");
  const geschosse = await geschosseListe(env.DB, objekt.id);
  const geschoss = geschosse.find((g) => g.id === geschossId) ?? geschosse[0];
  if (!geschoss) return umleitung(`/objekt/${objekt.id}/geschosse`);

  const daten = await planDaten(env, objekt, geschoss);
  const vorschlaege = daten.vorschlaege as { status: string }[];
  const importe = await importeListe(env.DB, objekt.id);
  const offenerImport = importe.find(
    (i) => i.geschoss_id === geschoss.id && i.status !== "bestaetigt",
  );
  const z = zaehlen(
    await vorschlaegeLesen(env.DB, {
      objekt_id: objekt.id,
      geschoss_id: geschoss.id,
      status: "alle",
    }),
  );

  const wechsel = geschosse
    .map(
      (g) =>
        `<a href="/objekt/${esc(objekt.id)}/plan/${esc(g.id)}"${
          g.id === geschoss.id ? ' aria-current="page"' : ""
        }>${esc(g.name)}</a>`,
    )
    .join("");

  const bild = geschoss.plan_schluessel
    ? `<div class="planflaeche" id="flaeche">
<div class="planbuehne" id="buehne">
<img src="/datei/${esc(geschoss.plan_schluessel)}" alt="Plan ${esc(geschoss.name)}" draggable="false">
</div>
<div class="planknoepfe">
<button type="button" id="kleiner" title="kleiner">−</button>
<button type="button" id="groesser" title="größer">+</button>
<button type="button" id="passend" title="zurücksetzen">⤢</button>
<button type="button" id="startknopf" title="Startpunkt des Rundgangs setzen">▶</button>
</div>
</div>
<div class="plankarte" id="karte" hidden></div>
<div class="legende">
<span><i class="marke sicher"></i> sicher (ab 0.85)</span>
<span><i class="marke unsicher"></i> unsicher (ab 0.6)</span>
<span><i class="marke vage"></i> vage</span>
<span><i class="marke an"></i> schon Bauteil</span>
<span><i class="marke pflicht sicher"></i> wartungspflichtig (dicker Rand)</span>
<span class="meta">Antippen öffnet das Kärtchen · Ziehen verschiebt · am Rechner j/k/a/x</span>
</div>`
    : `<div class="leer">Für dieses Geschoss gibt es noch kein Planbild.<br>
Ohne Bild werden die Vorschläge als Liste bestätigt — oder lade hier einen Plan hoch.</div>`;

  const hochladen = `<h2 class="abschnitt">Planbild</h2>
<p class="meta">PDF oder Bild. Ein PDF rendert der Browser selbst auf 2400 px Breite — der Server
bekommt nur das fertige Bild. Nötig ist es nicht: der Import geht auch ohne Karte.</p>
<div class="knopfleiste">
<label class="btn schmal leise" for="planfeld">Plan wählen</label>
<input id="planfeld" type="file" accept="image/*,application/pdf" hidden
  data-geschoss="${esc(geschoss.id)}">
<span class="meta" id="planstand"></span></div>`;

  return seite(
    `<div class="eyebrow"><a href="/objekt/${esc(objekt.id)}">${esc(objekt.name)}</a></div>
<div class="zeile oben"><h1 class="seite" style="margin-top:8px">Plan ${esc(geschoss.name)}</h1>
<nav class="reiter" style="margin:0;border:0">${wechsel}</nav></div>
${meldung ? `<div class="note" style="margin-bottom:18px">${esc(meldung)}</div>` : ""}

<div class="zeile" style="justify-content:space-between;align-items:center;margin-bottom:12px">
<span class="meta" id="zahlen">${z.offen} offen · ${z.angenommen} angenommen · ${z.verworfen} verworfen</span>
${
  offenerImport
    ? `<form method="post" action="/objekt/${esc(objekt.id)}/import/${esc(offenerImport.id)}" class="knopfleiste" style="margin:0">
<button class="btn schmal" name="tun" value="annehmen_ab_085">Alle ab 0.85 annehmen</button>
<button class="btn schmal leise" name="tun" value="annehmen_pflichtige">Wartungspflichtige annehmen</button>
<a class="btn schmal leise" href="/objekt/${esc(objekt.id)}/import/${esc(offenerImport.id)}">Als Liste</a>
</form>`
    : ""
}</div>

${bild}
${vorschlaege.length ? "" : '<p class="meta" style="margin-top:14px">Noch keine Vorschläge für dieses Geschoss. Hänge den Plan in Claude an und sag, wohin damit — <a href="/anleitung/import" style="text-decoration:underline">so geht es</a>.</p>'}
${hochladen}
<script type="application/json" id="daten">${JSON.stringify(daten).replace(/</g, "\\u003c")}</script>`,
    {
      titel: `Plan ${geschoss.name}`,
      nutzer,
      aktiv: "objekte",
      koerper: `data-geschoss="${esc(geschoss.id)}"${offenerImport ? ` data-import="${esc(offenerImport.id)}"` : ""}`,
      skript: planClient + PLAN_UPLOAD,
    },
  );
}

/**
 * Der Upload des Planbildes. Ein PDF wird im Browser gerendert (pdf.js von cdnjs, feste
 * Version) — der Worker bekommt nur ein PNG und muss weder Canvas noch PDF können.
 */
const PLAN_UPLOAD = `
const planfeld = document.getElementById('planfeld');
const planstand = document.getElementById('planstand');
async function pdfAlsBild(datei) {
  if (!window.pdfjsLib) {
    await new Promise((f, x) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
      s.type = 'module';
      s.onload = f; s.onerror = x;
      document.head.appendChild(s);
    });
    await new Promise((f) => setTimeout(f, 300));
  }
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const puffer = await datei.arrayBuffer();
  const pdf = await lib.getDocument({ data: puffer }).promise;
  const seite = await pdf.getPage(1);
  const roh = seite.getViewport({ scale: 1 });
  const skala = Math.min(2400 / roh.width, 4);
  const sicht = seite.getViewport({ scale: skala });
  const leinwand = document.createElement('canvas');
  leinwand.width = Math.round(sicht.width);
  leinwand.height = Math.round(sicht.height);
  const stift = leinwand.getContext('2d');
  stift.fillStyle = '#fff';
  stift.fillRect(0, 0, leinwand.width, leinwand.height);
  await seite.render({ canvasContext: stift, viewport: sicht }).promise;
  return leinwand;
}
async function bildAlsBild(datei) {
  const bild = await createImageBitmap(datei, { imageOrientation: 'from-image' });
  const faktor = Math.min(2400 / bild.width, 1);
  const leinwand = document.createElement('canvas');
  leinwand.width = Math.round(bild.width * faktor);
  leinwand.height = Math.round(bild.height * faktor);
  const stift = leinwand.getContext('2d');
  stift.fillStyle = '#fff';
  stift.fillRect(0, 0, leinwand.width, leinwand.height);
  stift.drawImage(bild, 0, 0, leinwand.width, leinwand.height);
  return leinwand;
}
planfeld?.addEventListener('change', async () => {
  const datei = planfeld.files[0];
  if (!datei) return;
  try {
    planstand.textContent = 'wird gerendert …';
    const leinwand = /pdf/i.test(datei.type) ? await pdfAlsBild(datei) : await bildAlsBild(datei);
    const blob = await new Promise((f) => leinwand.toBlob(f, 'image/png'));
    const form = new FormData();
    form.append('geschoss_id', planfeld.dataset.geschoss);
    form.append('breite', String(leinwand.width));
    form.append('hoehe', String(leinwand.height));
    form.append('dateiname', datei.name);
    form.append('bild', blob, 'plan.png');
    planstand.textContent = 'wird hochgeladen …';
    const r = await fetch('/api/plan', { method: 'POST', body: form });
    const d = await r.json();
    if (!r.ok) throw new Error(d.fehler || 'fehlgeschlagen');
    location.reload();
  } catch (e) {
    planstand.textContent = 'Plan ging nicht: ' + e.message;
  }
});`;
