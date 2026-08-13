#!/usr/bin/env node
/**
 * Konten anlegen oder Passwörter zurücksetzen.
 *
 * Es gibt keine Selbstregistrierung — wer die App benutzen darf, wird hier eingetragen. Das
 * Skript erzeugt je Konto ein Passwort, druckt es EINMAL auf die Konsole und gibt das passende
 * SQL aus. Gespeichert wird nur der PBKDF2-Hash; das Klartextpasswort existiert danach nirgends
 * mehr, also weitergeben, solange es auf dem Schirm steht.
 *
 *   node scripts/konten.mjs marc:Marc tobias:Tobias nils:Nils kerim:Kerim
 *   node scripts/konten.mjs marc                       # nur Passwort neu setzen
 *   node scripts/konten.mjs marc --passwort=eigenes    # Passwort selbst vorgeben
 *
 * Das ausgegebene SQL anwenden mit:
 *   wrangler d1 execute tuerwartung --remote --file konten.sql
 */
import { writeFileSync } from "node:fs";

const RUNDEN = 100_000;

const WOERTER = [
  "anker", "beschlag", "dichtung", "eiche", "feder", "griff", "hebel", "kante",
  "lager", "riegel", "scharnier", "schiene", "stift", "welle", "zarge", "zylinder",
];

function passwortVorschlag() {
  const z = crypto.getRandomValues(new Uint32Array(3));
  return `${WOERTER[z[0] % WOERTER.length]}-${WOERTER[z[1] % WOERTER.length]}-${String(z[2] % 10000).padStart(4, "0")}`;
}

const b64url = (bytes) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hashen(passwort) {
  const salz = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passwort), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salz, iterations: RUNDEN }, material, 256,
  );
  return `pbkdf2$${RUNDEN}$${b64url(salz)}$${b64url(new Uint8Array(bits))}`;
}

const args = process.argv.slice(2);
const vorgabe = args.find((a) => a.startsWith("--passwort="))?.split("=")[1];
const konten = args.filter((a) => !a.startsWith("--"));
if (!konten.length) {
  console.error(readmeAuszug());
  process.exit(1);
}

const zeilen = [];
const tabelle = [];
for (const eintrag of konten) {
  const [benutzer, name] = eintrag.split(":");
  const kennung = benutzer.trim().toLowerCase();
  const passwort = vorgabe ?? passwortVorschlag();
  const hash = await hashen(passwort);
  const anzeige = (name ?? kennung).replace(/'/g, "''");
  zeilen.push(
    `INSERT INTO personen (benutzer, name, passwort_hash, vorgaben, zuletzt_gesehen)\n` +
      `VALUES ('${kennung}', '${anzeige}', '${hash}', '{}', NULL)\n` +
      `ON CONFLICT (benutzer) DO UPDATE SET name = excluded.name, passwort_hash = excluded.passwort_hash;`,
  );
  tabelle.push({ Benutzer: kennung, Name: name ?? kennung, Passwort: passwort });
}

writeFileSync("konten.sql", zeilen.join("\n\n") + "\n");
console.table(tabelle);
console.log("\nSQL geschrieben nach konten.sql — anwenden mit:");
console.log("  wrangler d1 execute tuerwartung --remote --file konten.sql\n");
console.log("Die Passwörter stehen nur hier. Weitergeben, dann dieses Fenster schließen.");

function readmeAuszug() {
  return "Aufruf: node scripts/konten.mjs marc:Marc tobias:Tobias nils:Nils kerim:Kerim";
}
