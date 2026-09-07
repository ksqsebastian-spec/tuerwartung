/** Bindings und Secrets dieses Workers. Siehe wrangler.jsonc. */
export interface Env {
  /** OAuth-Clients, Grants, Codes, Tokens — und die Fehlversuchszähler der Anmeldung. */
  OAUTH_KV: KVNamespace;
  /** Personen, Objekte, Bauteile, Begehungen, Prüfungen, Mängel, Berichte. Quelle der Wahrheit. */
  DB: D1Database;
  /** Vorlagen-PDFs, Unterschriften, Fotos, Pläne, fertige Berichte. */
  R2: R2Bucket;

  HUB_URL?: string;

  /** Signiert die Sitzungs-Cookies der Website. Beliebige lange Zufallszeichenkette. */
  SITZUNGS_SCHLUESSEL: string;

  /**
   * Für den Bauplan-Import (Stufe 3): Türlisten lesen und Scans auswerten. Bis dahin nicht
   * gesetzt — deshalb optional, damit ein Deployment ohne dieses Secret läuft.
   */
  ANTHROPIC_API_KEY?: string;
}
