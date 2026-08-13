/**
 * Anmeldung mit Benutzer und Passwort.
 *
 * Vier feste Konten, keine Selbstregistrierung. Passwörter liegen als PBKDF2-SHA256-Hash in der
 * Datenbank — im Format `pbkdf2$runden$salz$hash`, dasselbe wie beim tarifcheck-Server. Verglichen
 * wird zeitkonstant, damit die Antwortdauer nicht verrät, wie weit ein Rateversuch gekommen ist.
 *
 * Gegen Durchprobieren zählt KV die Fehlversuche je Benutzer und Stunde. Das ist keine Festung,
 * aber es macht ein Wörterbuch über eine Handvoll Konten unbrauchbar.
 */
import { b64url, fromB64url, timingSafeEqual } from "../shared/crypto";

const enc = new TextEncoder();
const RUNDEN = 100_000;

export const MAX_FEHLVERSUCHE = 10;
const SPERRE_SEKUNDEN = 15 * 60;

/** Erzeugt einen Hash im Format `pbkdf2$runden$salz$hash`. */
export async function hashen(passwort: string, runden = RUNDEN): Promise<string> {
  const salz = crypto.getRandomValues(new Uint8Array(16));
  const hash = await ableiten(passwort, salz, runden);
  return `pbkdf2$${runden}$${b64url(salz)}$${b64url(hash)}`;
}

export async function pruefen(passwort: string, gespeichert: string): Promise<boolean> {
  const [verfahren, rundenText, salzText, hashText] = String(gespeichert).split("$");
  if (verfahren !== "pbkdf2" || !rundenText || !salzText || !hashText) return false;
  const runden = Number(rundenText);
  if (!Number.isFinite(runden) || runden < 1000) return false;
  const hash = await ableiten(passwort, fromB64url(salzText), runden);
  return timingSafeEqual(b64url(hash), hashText);
}

async function ableiten(passwort: string, salz: Uint8Array, runden: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", enc.encode(passwort), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salz as BufferSource, iterations: runden },
    material,
    256,
  );
  return new Uint8Array(bits);
}

/* ── Bremse ────────────────────────────────────────────────────────────────── */

const bremseSchluessel = (benutzer: string) => `bremse:${benutzer.toLowerCase()}`;

export async function gesperrt(kv: KVNamespace, benutzer: string): Promise<boolean> {
  const stand = await kv.get(bremseSchluessel(benutzer));
  return Number(stand ?? 0) >= MAX_FEHLVERSUCHE;
}

export async function fehlversuch(kv: KVNamespace, benutzer: string): Promise<void> {
  const schluessel = bremseSchluessel(benutzer);
  const stand = Number((await kv.get(schluessel)) ?? 0) + 1;
  await kv.put(schluessel, String(stand), { expirationTtl: SPERRE_SEKUNDEN });
}

export async function bremseLoesen(kv: KVNamespace, benutzer: string): Promise<void> {
  await kv.delete(bremseSchluessel(benutzer));
}

/* ── Passwörter erzeugen ───────────────────────────────────────────────────── */

const WOERTER = [
  "anker", "beschlag", "dichtung", "eiche", "feder", "griff", "hebel", "kante",
  "lager", "riegel", "scharnier", "schiene", "stift", "welle", "zarge", "zylinder",
];

/**
 * Ein Passwort, das sich mit Handschuhen auf einer Handytastatur tippen lässt: zwei Wörter,
 * vier Ziffern, alles klein, keine Sonderzeichen. Rund 44 Bit Entropie — genug, weil nach zehn
 * Fehlversuchen ohnehin Schluss ist.
 */
export function passwortVorschlag(): string {
  const zufall = crypto.getRandomValues(new Uint32Array(3));
  const a = WOERTER[zufall[0] % WOERTER.length];
  const b = WOERTER[zufall[1] % WOERTER.length];
  const zahl = String(zufall[2] % 10000).padStart(4, "0");
  return `${a}-${b}-${zahl}`;
}
