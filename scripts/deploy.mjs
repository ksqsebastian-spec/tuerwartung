#!/usr/bin/env node
/**
 * Deployt den gebündelten Worker über die Cloudflare-API — Konfiguration aus wrangler.jsonc.
 * Der übliche Weg ist `npm run deploy` (Wrangler); dieses Skript ist der Ausweg, wenn nur ein
 * API-Token vorliegt. Es macht dasselbe: ein ES-Modul plus Metadaten als multipart/form-data
 * an /workers/scripts/<name>.
 *
 * Die Bindings kommen bewusst aus wrangler.jsonc und nicht aus Flags: die API ersetzt bei
 * jedem Upload ALLE Bindings. Ein vergessenes Flag löscht also stillschweigend ein Binding —
 * genau das ist beim Bauen dieses Projekts einmal passiert.
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
 *     node scripts/deploy.mjs wrangler.jsonc dist/worker.js
 */
import { readFileSync } from "node:fs";

const [configPath, file] = process.argv.slice(2);
if (!configPath || !file || configPath === "--help") {
  console.log(readFileSync(new URL(import.meta.url)).toString().split("*/")[0]);
  process.exit(configPath === "--help" ? 0 : 1);
}

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.error("CLOUDFLARE_API_TOKEN und CLOUDFLARE_ACCOUNT_ID müssen gesetzt sein.");
  process.exit(1);
}

/** jsonc: Zeilenkommentare raus, dann normales JSON. Reicht für unsere Configs. */
const config = JSON.parse(
  readFileSync(configPath, "utf8")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n"),
);

const bindings = [
  ...(config.kv_namespaces ?? []).map((k) => ({
    type: "kv_namespace",
    name: k.binding,
    namespace_id: k.id,
  })),
  ...(config.d1_databases ?? []).map((d) => ({
    type: "d1",
    name: d.binding,
    id: d.database_id,
  })),
  ...(config.r2_buckets ?? []).map((r) => ({
    type: "r2_bucket",
    name: r.binding,
    bucket_name: r.bucket_name,
  })),
  ...(config.services ?? []).map((s) => ({
    type: "service",
    name: s.binding,
    service: s.service,
  })),
  ...Object.entries(config.vars ?? {}).map(([name, text]) => ({
    type: "plain_text",
    name,
    text: String(text),
  })),
];

/*
 * Die API ersetzt bei jedem Upload ALLE Bindings — auch die per `wrangler secret put` gesetzten.
 * Also erst die vorhandenen holen und die Secrets unverändert wieder mitschicken.
 */
const vorhanden = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${config.name}/settings`,
  { headers: { Authorization: `Bearer ${token}` } },
).then((r) => r.json()).catch(() => ({ success: false }));

if (vorhanden.success) {
  for (const b of vorhanden.result?.bindings ?? []) {
    if (b.type === "secret_text" && !bindings.some((x) => x.name === b.name)) {
      bindings.push({ type: "inherit", name: b.name });
    }
  }
}

const metadata = {
  main_module: "worker.js",
  compatibility_date: config.compatibility_date,
  compatibility_flags: config.compatibility_flags ?? [],
  bindings,
  observability: config.observability ?? { enabled: true },
};

const form = new FormData();
form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
form.set(
  "worker.js",
  new Blob([readFileSync(file)], { type: "application/javascript+module" }),
  "worker.js",
);

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${config.name}`,
  { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: form },
);
const body = await res.json();
if (!body.success) {
  console.error("✗ Deployment fehlgeschlagen:", JSON.stringify(body.errors, null, 2));
  process.exit(1);
}

if (config.workers_dev !== false) {
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${config.name}/subdomain`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
    },
  );
}

const names = bindings.map((b) => b.name).join(", ") || "keine";
console.log(`✓ ${config.name} deployt — Bindings: ${names}`);
