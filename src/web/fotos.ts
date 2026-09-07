/**
 * Der Fotobereich, wie er auf Prüfungs-, Bauteil- und Mangelseite gleich aussieht:
 * eine Reihe Bilder, darunter ein Knopf, der die Kamera öffnet.
 *
 * Verkleinert wird im Browser (längste Kante 1600 px, JPEG 0.82) — ein Handyfoto hat sonst
 * vier Megabyte, und der Monteur steht im Funkloch. Hochgeladen wird über dieselbe
 * Schnittstelle wie im Rundgang, samt `op_id`: doppelt gesendet schadet nicht.
 */
import { esc, zeitpunkt } from "./layout";
import type { Foto } from "../daten/fotos";

export function fotoBereich(
  fotos: Foto[],
  ziel: { begehung_id?: string; bauteil_id: string; bauteil_nr: number } | null,
): string {
  const bilder = fotos.length
    ? `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px" id="fotogalerie">${fotos
        .map(
          (f) => `<figure style="margin:0">
<a href="/datei/${esc(f.r2_schluessel)}" title="${esc(f.notiz)}">
<img src="/datei/${esc(f.r2_schluessel)}" alt="${esc(f.notiz || "Foto")}"
  style="height:130px;border-radius:12px;border:1px solid var(--line);display:block"></a>
<figcaption class="meta" style="font-size:.74rem;margin-top:5px">${esc(
            [f.notiz, zeitpunkt(f.aufgenommen_am)].filter(Boolean).join(" · "),
          )}</figcaption></figure>`,
        )
        .join("")}</div>`
    : `<p class="meta">Noch kein Foto.</p>`;

  if (!ziel?.begehung_id) return bilder;

  return `${bilder}
<div class="knopfleiste" style="margin-top:16px">
<label class="btn schmal leise" for="kamera">Foto aufnehmen</label>
<input id="kamera" type="file" accept="image/*" capture="environment" hidden
  data-begehung="${esc(ziel.begehung_id)}" data-nr="${ziel.bauteil_nr}">
<span class="meta" id="fotostand"></span></div>`;
}

/** Das Gegenstück im Browser. Wird als `skript` an `seite()` gehängt. */
export const FOTO_SKRIPT = `
const kamera = document.getElementById('kamera');
kamera?.addEventListener('change', async () => {
  const datei = kamera.files[0];
  if (!datei) return;
  const stand = document.getElementById('fotostand');
  stand.textContent = 'wird verkleinert …';
  try {
    const bild = await createImageBitmap(datei, { imageOrientation: 'from-image' });
    const faktor = Math.min(1600 / Math.max(bild.width, bild.height), 1);
    const leinwand = document.createElement('canvas');
    leinwand.width = Math.round(bild.width * faktor);
    leinwand.height = Math.round(bild.height * faktor);
    const stift = leinwand.getContext('2d');
    stift.fillStyle = '#fff';
    stift.fillRect(0, 0, leinwand.width, leinwand.height);
    stift.drawImage(bild, 0, 0, leinwand.width, leinwand.height);
    const blob = await new Promise((f) => leinwand.toBlob(f, 'image/jpeg', 0.82));
    const form = new FormData();
    form.append('op_id', (crypto.randomUUID?.() || 'op-' + Date.now() + '-' + Math.random()));
    form.append('begehung_id', kamera.dataset.begehung);
    form.append('bauteil_nr', kamera.dataset.nr);
    form.append('breite', String(leinwand.width));
    form.append('hoehe', String(leinwand.height));
    form.append('bild', blob, 'foto.jpg');
    stand.textContent = 'wird hochgeladen …';
    const r = await fetch('/api/foto', { method: 'POST', body: form });
    const d = await r.json();
    if (!r.ok) throw new Error(d.fehler || 'fehlgeschlagen');
    stand.textContent = 'Foto gespeichert';
    location.reload();
  } catch (e) {
    stand.textContent = 'Foto ging nicht: ' + e.message;
  }
});`;
