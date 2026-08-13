/**
 * ZIP ohne Komprimierung (Methode 0 „stored").
 *
 * PDFs sind bereits komprimiert; ein zweiter Durchgang bringt fast nichts und kostet CPU-Zeit,
 * die im Worker knapp ist. Deshalb reicht der einfachste vollständige ZIP-Schreiber: lokale
 * Header, zentrales Verzeichnis, End-of-Central-Directory.
 */

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(daten: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < daten.length; i++) c = CRC_TABELLE[(c ^ daten[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS-Zeitstempel. Ohne ihn schreiben manche Entpacker 1980 in die Dateiliste. */
function dosZeit(d: Date): { zeit: number; datum: number } {
  return {
    zeit: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    datum: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEintrag {
  name: string;
  daten: Uint8Array;
}

export function zipBauen(eintraege: ZipEintrag[], zeitpunkt = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { zeit, datum } = dosZeit(zeitpunkt);
  const lokale: Uint8Array[] = [];
  const verzeichnis: Uint8Array[] = [];
  let versatz = 0;

  for (const e of eintraege) {
    const name = enc.encode(e.name);
    const summe = crc32(e.daten);

    const kopf = new DataView(new ArrayBuffer(30));
    kopf.setUint32(0, 0x04034b50, true); // Signatur
    kopf.setUint16(4, 20, true); // benötigte Version
    kopf.setUint16(6, 0x0800, true); // Flags: Namen sind UTF-8
    kopf.setUint16(8, 0, true); // Methode: stored
    kopf.setUint16(10, zeit, true);
    kopf.setUint16(12, datum, true);
    kopf.setUint32(14, summe, true);
    kopf.setUint32(18, e.daten.length, true);
    kopf.setUint32(22, e.daten.length, true);
    kopf.setUint16(26, name.length, true);
    kopf.setUint16(28, 0, true); // extra
    lokale.push(new Uint8Array(kopf.buffer), name, e.daten);

    const eintrag = new DataView(new ArrayBuffer(46));
    eintrag.setUint32(0, 0x02014b50, true);
    eintrag.setUint16(4, 20, true); // erzeugende Version
    eintrag.setUint16(6, 20, true);
    eintrag.setUint16(8, 0x0800, true);
    eintrag.setUint16(10, 0, true);
    eintrag.setUint16(12, zeit, true);
    eintrag.setUint16(14, datum, true);
    eintrag.setUint32(16, summe, true);
    eintrag.setUint32(20, e.daten.length, true);
    eintrag.setUint32(24, e.daten.length, true);
    eintrag.setUint16(28, name.length, true);
    eintrag.setUint32(42, versatz, true);
    verzeichnis.push(new Uint8Array(eintrag.buffer), name);

    versatz += 30 + name.length + e.daten.length;
  }

  const verzeichnisGroesse = verzeichnis.reduce((n, t) => n + t.length, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true);
  ende.setUint16(8, eintraege.length, true);
  ende.setUint16(10, eintraege.length, true);
  ende.setUint32(12, verzeichnisGroesse, true);
  ende.setUint32(16, versatz, true);

  const teile = [...lokale, ...verzeichnis, new Uint8Array(ende.buffer)];
  const gesamt = teile.reduce((n, t) => n + t.length, 0);
  const out = new Uint8Array(gesamt);
  let pos = 0;
  for (const t of teile) {
    out.set(t, pos);
    pos += t.length;
  }
  return out;
}
