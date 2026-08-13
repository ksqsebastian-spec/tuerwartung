/**
 * Token- und Verschlüsselungs-Primitive.
 *
 * Kernidee: der HERO-API-Key liegt NIE im Klartext in KV. Er wird mit einem Schlüssel
 * verschlüsselt, der aus dem OAuth-Token selbst abgeleitet ist. In KV steht nur der
 * SHA-256-Hash des Tokens als Schlüsselname plus der Chiffretext — wer nur die KV-Daten
 * hat (Backup, Leak, Support-Zugriff), kann die HERO-Keys nicht lesen. Nur der Client,
 * der das Bearer-Token hält, kann sie entschlüsseln.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Kryptografisch sicheres Token mit sprechendem Präfix. */
export function randomToken(prefix: string): string {
  return prefix + b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Zeitkonstanter Vergleich — verhindert Timing-Orakel auf Secrets. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("hero-mcp/kv"), info: enc.encode("props-v1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Verschlüsselt beliebige JSON-Daten unter einem Secret (i.d.R. das Token selbst). */
export async function sealJSON(secret: string, data: unknown): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(data)),
  );
  return b64url(iv) + "." + b64url(new Uint8Array(ct));
}

/** Gegenstück zu sealJSON. Wirft, wenn das Secret nicht passt oder der Chiffretext manipuliert ist. */
export async function openJSON<T>(secret: string, sealed: string): Promise<T> {
  const [ivPart, ctPart] = sealed.split(".");
  if (!ivPart || !ctPart) throw new Error("malformed ciphertext");
  const key = await deriveKey(secret);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(ivPart) },
    key,
    fromB64url(ctPart),
  );
  return JSON.parse(dec.decode(pt)) as T;
}

/** PKCE S256: prüft, ob der verifier zum gespeicherten challenge passt. */
export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return timingSafeEqual(b64url(new Uint8Array(d)), challenge);
}
