/**
 * Web-Sitzung und Anmelde-Zustand — beides signierte Zeichenketten, kein Speicher nötig.
 *
 * Eine Sitzung ist ein Cookie aus Nutzlast + HMAC. Der Server muss nichts nachschlagen, um zu
 * wissen, wer da ist; abgelaufen ist sie, wenn ihr Verfallsdatum durch ist. Denselben Mechanismus
 * benutzt die Umleitung zu Google: der Zustand trägt das Ziel mit und kommt unverfälscht zurück.
 */
import { b64url, fromB64url, timingSafeEqual } from "../shared/crypto";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const COOKIE = "tw_sitzung";
const SITZUNG_TAGE = 14;

export interface Nutzer {
  /** Kurzkennung, klein geschrieben — marc, tobias, nils, kerim. */
  benutzer: string;
  name: string;
}

async function schluessel(geheim: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(geheim), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Beliebige Daten signiert verpacken. */
export async function siegeln(geheim: string, daten: unknown, gueltigMs: number): Promise<string> {
  const nutzlast = b64url(enc.encode(JSON.stringify({ d: daten, exp: Date.now() + gueltigMs })));
  const sig = await crypto.subtle.sign("HMAC", await schluessel(geheim), enc.encode(nutzlast));
  return `${nutzlast}.${b64url(new Uint8Array(sig))}`;
}

/** Gegenstück zu `siegeln`. null, wenn manipuliert oder abgelaufen. */
export async function oeffnen<T>(geheim: string, wert: string | null): Promise<T | null> {
  if (!wert) return null;
  const [nutzlast, sig] = wert.split(".");
  if (!nutzlast || !sig) return null;
  const erwartet = await crypto.subtle.sign("HMAC", await schluessel(geheim), enc.encode(nutzlast));
  if (!timingSafeEqual(b64url(new Uint8Array(erwartet)), sig)) return null;
  try {
    const inhalt = JSON.parse(dec.decode(fromB64url(nutzlast))) as { d: T; exp: number };
    if (!inhalt.exp || inhalt.exp < Date.now()) return null;
    return inhalt.d;
  } catch {
    return null;
  }
}

function ausCookies(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const teil of header.split(";")) {
    const [k, ...rest] = teil.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Wer ist da? null, wenn niemand angemeldet ist. */
export async function angemeldet(request: Request, geheim: string): Promise<Nutzer | null> {
  return oeffnen<Nutzer>(geheim, ausCookies(request.headers.get("cookie"), COOKIE));
}

export async function sitzungsCookie(geheim: string, nutzer: Nutzer): Promise<string> {
  const wert = await siegeln(geheim, nutzer, SITZUNG_TAGE * 24 * 60 * 60 * 1000);
  return `${COOKIE}=${encodeURIComponent(wert)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${
    SITZUNG_TAGE * 24 * 60 * 60
  }`;
}

export const abmeldeCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
