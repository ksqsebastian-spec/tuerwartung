#!/usr/bin/env node
/**
 * Die eine Abnahme, die `scripts/e2e.sh` nicht leisten kann: der Rundgang **im Browser**,
 * mit getrenntem Netz. Legt sich ein Objekt mit fünf Türen an, lädt den Rundgang, trennt die
 * Verbindung, erfasst zwei Türen, hängt ein Foto an, legt eine unbekannte Tür an, verbindet
 * wieder und prüft, dass alles auf dem Server steht. Räumt am Ende hinter sich auf.
 *
 * Playwright ist bewusst **keine Abhängigkeit dieses Projekts** — der Worker braucht es nicht.
 * Einmalig danebenlegen und laufen lassen:
 *
 *   npm install --no-save playwright     # landet nicht in package.json
 *   node scripts/rundgang-offline.mjs
 *
 *   [URL] [BENUTZER] [PASSWORT]   (Standard: http://127.0.0.1:8787 marc test-test-1234)
 *
 * Gedacht für den Entwicklungsserver. Das Verhalten, um das es geht, steckt im Browser und ist
 * gegen die Live-Instanz dasselbe; deren Serverseite deckt `scripts/e2e.sh` ab.
 */
import { chromium } from "playwright";

const B = process.argv[2] || "http://127.0.0.1:8787";
const BENUTZER = process.argv[3] || "marc";
const PASSWORT = process.argv[4] || "test-test-1234";

let fehler = 0;
const ok = (t) => console.log("  OK   " + t);
const bad = (t) => { console.log("  FEHL " + t); fehler++; };

/* Ein winziges JPEG, damit es etwas zum Hochladen gibt. */
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywt" +
  "QFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09P" +
  "T09PT09PT09PT09PT09PT09PT0//wAARCAAgADADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcI" +
  "CQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRol" +
  "JicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ip" +
  "qrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAA" +
  "AAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLR" +
  "ChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaX" +
  "mJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEA" +
  "PwDCs7S2ls57q7uJYkikSMCKESElgx7suPufrTvK0j/n+vv/AADT/wCO0Q/8i/ef9fUH/oE1UK97Vt6nAX/K0j/n+vv/" +
  "AADT/wCO0eVpH/P9ff8AgGn/AMdqhRT5X3FfyL/laR/z/X3/AIBp/wDHabeWltFZwXVpcSypLI8ZEsIjIKhT2Zs/f/Sq" +
  "VX5v+Rfs/wDr6n/9AhpaprUYQ/8AIv3n/X1B/wCgTVQq7Z3dtFZz2t3byypLIkgMUwjIKhh3Vs/f/SnebpH/AD433/gY" +
  "n/xqjVN6AUKKv+bpH/Pjff8AgYn/AMao83SP+fG+/wDAxP8A41T5n2FbzKFX5v8AkX7P/r6n/wDQIaPN0j/nxvv/AAMT" +
  "/wCNU28u7aWzgtbS3liSKR5CZZhISWCjsq4+5+tLVtaDP//Z",
  "base64",
);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => bad("Seitenfehler: " + e.message));

/* ── Anmelden und Testdaten anlegen ───────────────────────────────────────── */
await p.goto(B + "/anmeldung");
await p.selectOption("#benutzer", BENUTZER).catch(() => p.fill("#benutzer", BENUTZER));
await p.fill("#passwort", PASSWORT);
await p.click("button[type=submit]");
await p.waitForLoadState("networkidle");

const name = "E2E Rundgang " + Date.now();
const objektId = await p.evaluate(async (n) => {
  const form = new URLSearchParams({ name: n, adresse: "Teststrasse 1, 22523 Hamburg", intervall_monate: "12" });
  const r = await fetch("/objekte", { method: "POST", body: form, redirect: "follow" });
  return new URL(r.url).pathname.split("/").pop();
}, name);

await p.evaluate(async (id) => {
  for (let nr = 1; nr <= 5; nr++) {
    await fetch("/objekt/" + id + "/bauteil/neu", {
      method: "POST",
      body: new URLSearchParams({
        nr: String(nr), art: "wartung_drehfluegel", raum: "Flur " + nr,
        raumnummer: "1.0" + nr, wartungspflichtig: "1", aktiv: "1",
      }),
    });
  }
}, objektId);

const begehungId = await p.evaluate(async (id) => {
  const r = await fetch("/objekt/" + id + "/begehung", { method: "POST", body: new URLSearchParams() });
  return new URL(r.url).pathname.split("/").pop();
}, objektId);

/* ── Rundgang laden, dann Netz trennen ────────────────────────────────────── */
await p.goto(B + "/rundgang/" + begehungId);
await p.waitForSelector("#haken .reihe", { timeout: 15000 });
const offen = await p.$$eval("#haken .reihe:not(.fertig)", (n) => n.map((x) => x.dataset.nr));
offen.length === 5 ? ok("Rundgang geladen, 5 Türen offen") : bad("Türen: " + offen.length);

await ctx.setOffline(true);
ok("Netz getrennt");

await p.click(`#haken .reihe[data-nr="${offen[0]}"]`);
await p.waitForSelector("#sichern");
await p.click('label:has(input[name="p_2"][value="nio"])');
await p.fill("#hinweise", "Offline erfasst");
await p.click("#sichern");
await p.waitForSelector("#haken");

await p.click(`#haken .reihe[data-nr="${offen[1]}"]`);
await p.waitForSelector("#sichern");
await p.click("#sichern");
await p.waitForSelector("#haken");

await p.click("#neu");
await p.waitForSelector("#sichern");
await p.setInputFiles("#kamera", { name: "foto.jpg", mimeType: "image/jpeg", buffer: JPEG });
await p.waitForFunction(() => document.getElementById("fotostand")?.textContent?.includes("gemerkt"),
  null, { timeout: 10000 }).then(() => ok("Foto offline gemerkt")).catch(() => bad("Foto nicht gemerkt"));
await p.click("#sichern");
await p.waitForSelector("#haken");

const wartend = await p.textContent("#stand");
/wartet|warten/.test(wartend) ? ok("Warteschlange: " + wartend.trim()) : bad("Stand: " + wartend);
(await p.textContent("#zahl")) === "3 von 6"
  ? ok("offline erfasst: 3 von 6") : bad("Zahl: " + (await p.textContent("#zahl")));

/* ── Netz zurück ──────────────────────────────────────────────────────────── */
await ctx.setOffline(false);
await p.click("#stand");
await p.waitForFunction(() => document.getElementById("stand")?.textContent?.startsWith("alles übertragen"),
  null, { timeout: 30000 }).then(() => ok("alles übertragen")).catch(() => bad("Abgleich hängt"));

/* ── Serverstand prüfen ───────────────────────────────────────────────────── */
const stand = await p.evaluate(async (id) => (await fetch("/begehung/" + id + "/stand.json")).json(), begehungId);
stand.gesamt === 6 ? ok("neue Tür mit Server-Nummer angelegt") : bad("Bauteile: " + stand.gesamt);
stand.geprueft === 3 ? ok("drei Prüfungen auf dem Server") : bad("Prüfungen: " + stand.geprueft);
stand.bauteile.find((b) => b.nr === Number(offen[0]))?.abweichungen === 1
  ? ok("Abweichung übertragen") : bad("Abweichung fehlt");

const lauf = await p.evaluate(async (id) =>
  (await fetch("/begehung/" + id + "/erzeugen", { method: "POST" })).json(), begehungId);
lauf.erzeugt === 3 ? ok("drei Berichte erzeugt") : bad("Berichte: " + JSON.stringify(lauf));
const mitAnhang = await p.evaluate(async (id) => {
  const r = await fetch("/api/rundgang/" + id);
  return (await r.json()).bauteile.length;
}, begehungId);
mitAnhang === 6 ? ok("Rundgang kennt die neue Tür") : bad("Rundgang: " + mitAnhang);

/* ── Aufräumen ────────────────────────────────────────────────────────────── */
await p.evaluate(async (id) => fetch("/objekt/" + id + "/loeschen", { method: "POST" }), objektId);
ok("Testdaten entfernt");

await browser.close();
console.log("");
console.log(fehler === 0 ? "ALLES GRÜN" : "FEHLER VORHANDEN");
process.exit(fehler === 0 ? 0 : 1);
