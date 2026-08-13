/** Bindings und Secrets dieses Workers. Siehe wrangler.jsonc. */
export interface Env {
  /** OAuth-Clients, Grants, Codes, Tokens — und die Fehlversuchszähler der Anmeldung. */
  OAUTH_KV: KVNamespace;
  /** Personen, Wartungen, Türen. Quelle der Wahrheit. */
  DB: D1Database;
  /** Vorlagen-PDFs, Unterschriften, fertige Berichte. */
  R2: R2Bucket;

  HUB_URL?: string;

  /** Signiert die Sitzungs-Cookies der Website. Beliebige lange Zufallszeichenkette. */
  SITZUNGS_SCHLUESSEL: string;
}
