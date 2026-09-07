#!/usr/bin/env node
/**
 * Bündelt den Worker zu genau einer ESM-Datei.
 *
 * Kein Wrangler im Spiel: das Deployment läuft über die Cloudflare-API (scripts/deploy.mjs),
 * und die will ein einzelnes Modul. esbuild ist reine Bauzeit-Abhängigkeit.
 *
 * Die Koordinaten-Profile (.json), Cheatsheets (.md) und Formular-PDFs (.pdf) der Vorlagen werden
 * mit einkompiliert — sie ändern sich selten und gehören zum Programm, nicht in die Datenbank.
 * Ebenso die Browser-Skripte (.txt): der Rundgang und sein Service Worker stehen als eigene
 * Dateien im Baum, damit sie lesbar bleiben, und werden als Text eingebettet — kein
 * ASSETS-Binding, kein zweiter Zustand beim Aufsetzen.
 *
 *   node scripts/bundle.mjs <entry.ts> <out.js>
 */
import { build } from "esbuild";
import { statSync } from "node:fs";

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error("Aufruf: node scripts/bundle.mjs <entry.ts> <out.js>");
  process.exit(1);
}

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "neutral",
  minify: false, // lesbar halten: der Bundle ist das, was live läuft
  legalComments: "none",
  conditions: ["worker", "browser"],
  loader: { ".md": "text", ".txt": "text", ".pdf": "base64" },
  mainFields: ["module", "main"],
});

console.log(`✓ ${outfile} — ${(statSync(outfile).size / 1024).toFixed(1)} KB`);
