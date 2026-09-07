/**
 * Kleinkram, den alle Datenmodule brauchen: Kennungen, Zeitrechnung, JSON-Spalten,
 * und die Zugriffsprüfung.
 */

const jetztFn = () => Date.now();
export const jetzt = jetztFn;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * ULID: 10 Zeichen Zeit, 16 Zeichen Zufall, Crockford-Base32. Zeitlich sortierbar — eine
 * Liste nach ID ist damit auch eine Liste nach Entstehungszeit, ganz ohne Index.
 */
export function ulid(zeit = Date.now()): string {
  let t = zeit;
  let kopf = "";
  for (let i = 0; i < 10; i++) {
    kopf = CROCKFORD[t % 32] + kopf;
    t = Math.floor(t / 32);
  }
  const zufall = crypto.getRandomValues(new Uint8Array(16));
  let rest = "";
  for (const b of zufall) rest += CROCKFORD[b % 32];
  return kopf + rest;
}

export function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Aus „Heselstücken 12, Hamburg" wird „Heselstuecken-12-Hamburg". */
export function slug(text: string, laenge = 40): string {
  const ersetzt = String(text ?? "")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss");
  return (
    ersetzt
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, laenge) || "objekt"
  );
}

/** Kaputtes JSON in einer Spalte darf keine Seite kosten. */
export function lies<T>(wert: unknown, ersatz: T): T {
  try {
    const o = JSON.parse(String(wert ?? ""));
    return o === null || o === undefined ? ersatz : (o as T);
  } catch {
    return ersatz;
  }
}

/** Datum + n Monate, als YYYY-MM-DD. Der 31. eines Monats rutscht auf den Monatsletzten. */
export function monateSpaeter(datum: string, monate: number): string {
  const d = new Date(`${datum}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const tag = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + monate);
  const letzter = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(tag, letzter));
  return d.toISOString().slice(0, 10);
}

/** Ganze Tage von heute bis zum Datum. Negativ = in der Vergangenheit. */
export function tageBis(datum: string, ab = heute()): number {
  const a = Date.parse(`${ab}T12:00:00Z`);
  const b = Date.parse(`${datum}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function zeitpunkt(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Zugriffsprüfung. In v2 sehen alle vier alles — die Funktion liefert immer `true`.
 * Sie wird trotzdem an jeder Stelle aufgerufen, an der ein Objekt angefasst wird, damit
 * die Mandantentrennung in v3 nur noch gefüllt werden muss (Abschnitt 12).
 */
export function darfObjekt(_person: string, _objektId: string): boolean {
  return true;
}

export function zugriffPruefen(person: string, objektId: string): void {
  if (!darfObjekt(person, objektId)) {
    throw new Error("Für dieses Objekt fehlt die Berechtigung.");
  }
}
