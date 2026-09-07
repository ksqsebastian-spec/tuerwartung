/**
 * Türwerk — ein Worker, drei Gesichter:
 *
 *   1. die Arbeitsfläche im Browser (Bestand ansehen, Prüfungen korrigieren, Berichte holen),
 *   2. der OAuth-geschützte MCP-Server, über den Claude beim Diktat schreibt,
 *   3. die Ablage der fertigen PDFs.
 *
 * Alles an einer Adresse und mit einer Anmeldung: wer sich hier anmeldet, verbindet damit auch
 * Claude. Das Routing ist ein einziges `switch` über Methode und Pfad — dieselbe Machart wie in
 * den anderen MCP-Servern des Hauses.
 */
import type { Env } from "./env";
import { abmeldeCookie, angemeldet, sitzungsCookie } from "./auth/sitzung";
import type { Nutzer } from "./auth/sitzung";
import {
  authServerMetadata,
  bearerPruefen,
  codeAusstellen,
  handleRegister,
  handleRevoke,
  handleToken,
  ladeClient,
  leseAuthParams,
  protectedResourceMetadata,
  unauthorized,
} from "./auth/oauth";
import { bremseLoesen, fehlversuch, gesperrt, pruefen } from "./auth/passwoerter";
import { PROTOCOL_VERSION, handleRpc, toolKatalog } from "./mcp/protokoll";
import { ANLEITUNG, TOOLS } from "./mcp/werkzeuge";
import { MARKE, fehlerSeite, umleitung } from "./web/layout";
import {
  anmeldeSeite,
  einstellungenSeite,
  freigabeSeite,
  verbindenSeite,
} from "./web/allgemein";
import { geschosseSeite, objektSeite, objekteSeite } from "./web/objekte";
import { bauteilSeite } from "./web/bauteile";
import { begehungSeite, pruefungSeite, unterschriftSeite } from "./web/begehungen";
import { maengelSeite, mangelSeite } from "./web/maengel";
import { heute, zugriffPruefen } from "./daten/basis";
import {
  personGesehen,
  personLesen,
  personSpeichern,
  personenListe,
} from "./daten/personen";
import {
  geschossAendern,
  geschossAnlegen,
  geschosseListe,
  objektAendern,
  objektAnlegen,
  objektLesen,
  objektLoeschen,
} from "./daten/objekte";
import { bauteilAendern, bauteilAnlegen, bauteileMitStand } from "./daten/bauteile";
import {
  begehungAendern,
  begehungAnlegen,
  begehungLesen,
  betreiberUnterschrift,
  pruefungErfassen,
} from "./daten/begehungen";
import { mangelAendern, mangelLesen, mangelSchliessen } from "./daten/maengel";
import { vorlage } from "./vorlagen";
import type { Bewertung } from "./vorlagen";
import { berichtePaket, berichteErzeugen, sammelberichtErzeugen } from "./pdf/berichte";

const SERVER_INFO = {
  name: "tuerwerk",
  title: "Türwerk — Türenwartung Seehafer Elemente",
  version: "2.0.0",
  websiteUrl: "https://seehafer-elemente.de",
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, authorization, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "www-authenticate, mcp-protocol-version",
  "access-control-max-age": "86400",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

/** Nur eigene Pfade sind als Weiterleitungsziel zulässig — sonst wird die Anmeldung zur Schleuder. */
function sicheresZiel(wert: string | null): string {
  return wert && wert.startsWith("/") && !wert.startsWith("//") ? wert : "/objekte";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const pfad = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    /*
     * Ohne Sitzungsschlüssel wäre jede Anmeldung wertlos, und der Fehler käme sonst erst tief
     * in der Krypto als 500 heraus. Lieber einmal klar sagen, was fehlt.
     */
    if (!env.SITZUNGS_SCHLUESSEL) {
      return fehlerSeite(
        "Nicht eingerichtet",
        "Das Secret SITZUNGS_SCHLUESSEL fehlt. Einmal 'wrangler secret put SITZUNGS_SCHLUESSEL' " +
          "mit einer langen Zufallszeichenkette setzen.",
        503,
      );
    }

    /* ── Öffentlich ──────────────────────────────────────────────────────── */

    switch (`${request.method} ${pfad}`) {
      case "GET /icon.svg":
      case "GET /favicon.svg":
      case "GET /favicon.ico":
        return new Response(MARKE, {
          headers: {
            "content-type": "image/svg+xml",
            "cache-control": "public, max-age=86400",
            ...CORS,
          },
        });

      case "GET /.well-known/oauth-authorization-server":
      case "GET /.well-known/oauth-authorization-server/mcp":
        return json(authServerMetadata(origin));

      case "GET /.well-known/oauth-protected-resource":
      case "GET /.well-known/oauth-protected-resource/mcp":
        return json(protectedResourceMetadata(origin));

      case "POST /register":
        return handleRegister(request, env);

      case "POST /token":
        return handleToken(request, env);

      case "POST /revoke":
        return handleRevoke(request, env);

      /** Öffentlicher Katalog — der Hub baut daraus seine Übersicht, ohne Anmeldung. */
      case "GET /tools.json":
        return json({
          server: {
            name: SERVER_INFO.name,
            version: SERVER_INFO.version,
            protocolVersion: PROTOCOL_VERSION,
          },
          mcpUrl: `${origin}/mcp`,
          auth: "oauth2",
          tools: toolKatalog(TOOLS),
        });

      case "GET /mcp":
        // Zustandslos: kein server-initiierter SSE-Strom.
        return json(
          { error: "method_not_allowed", error_description: "MCP läuft hier über POST /mcp." },
          405,
        );

      case "DELETE /mcp":
        return new Response(null, { status: 204, headers: CORS });

      case "POST /mcp": {
        const sitzung = await bearerPruefen(request, env);
        if (!sitzung) return unauthorized(origin, "Gültiges Bearer-Token erforderlich.");
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
        }
        const antwort = await handleRpc(
          body,
          { env, nutzer: sitzung.nutzer, origin },
          TOOLS,
          SERVER_INFO,
          ANLEITUNG,
        );
        if (antwort === null) return new Response(null, { status: 202, headers: CORS });
        return json(antwort);
      }

      case "GET /anmeldung":
        return anmeldeSeite(origin, await konten(env), {
          weiter: url.searchParams.get("weiter") ?? undefined,
        });

      case "POST /anmeldung":
        return anmelden(request, env, origin);

      case "GET /abmelden":
        return umleitung("/", abmeldeCookie);
    }

    /* ── Anmeldung prüfen ────────────────────────────────────────────────── */

    const nutzer = await angemeldet(request, env.SITZUNGS_SCHLUESSEL);

    /* Die Freigabeseite braucht die Anmeldung, führt aber selbst hin. */
    if (pfad === "/authorize") {
      return authorize(request, env, url, origin, nutzer);
    }

    if (!nutzer) {
      if (pfad === "/") return anmeldeSeite(origin, await konten(env));
      return umleitung(`/anmeldung?weiter=${encodeURIComponent(url.pathname + url.search)}`);
    }

    /* ── Angemeldet ──────────────────────────────────────────────────────── */

    const meldung = url.searchParams.get("meldung") ?? undefined;

    switch (`${request.method} ${pfad}`) {
      case "GET /":
        return umleitung("/objekte");

      case "GET /objekte":
        return objekteSeite(env, nutzer, url.searchParams.get("suche") ?? "", meldung);

      case "POST /objekte": {
        const form = await request.formData();
        const o = await objektAnlegen(env.DB, {
          name: String(form.get("name") ?? "").trim(),
          adresse: String(form.get("adresse") ?? ""),
          betreiber: String(form.get("betreiber") ?? ""),
          intervall_monate: Number(form.get("intervall_monate") ?? 12) || 12,
          angelegt_von: nutzer.benutzer,
        });
        return umleitung(`/objekt/${o.id}`);
      }

      case "GET /maengel":
        return maengelSeite(env, nutzer, {
          objekt: url.searchParams.get("objekt") ?? "",
          status: url.searchParams.get("status") ?? "",
          faellig_bis: url.searchParams.get("faellig_bis") ?? "",
        });

      case "GET /verbinden":
        return verbindenSeite(origin, nutzer);

      case "GET /einstellungen":
        return einstellungenSeite(env, nutzer, meldung);

      case "POST /einstellungen": {
        const form = await request.formData();
        const vorgaben: Record<string, string> = {};
        for (const feld of ["pruefer", "befaehigung", "ort", "rechtsgrundlagen"]) {
          vorgaben[feld] = String(form.get(feld) ?? "").trim();
        }
        await personSpeichern(env.DB, nutzer.benutzer, { vorgaben });
        return umleitung("/einstellungen?meldung=Vorgaben+gespeichert.");
      }

      case "POST /einstellungen/unterschrift": {
        const form = await request.formData();
        const datei = form.get("bild") as unknown as
          | { size: number; arrayBuffer(): Promise<ArrayBuffer> }
          | null;
        if (!datei || typeof datei.arrayBuffer !== "function" || !datei.size) {
          return fehlerSeite("Keine Datei", "Es wurde kein Bild ausgewählt.");
        }
        if (datei.size > 2 * 1024 * 1024) {
          return fehlerSeite("Zu groß", "Die Unterschrift darf höchstens 2 MB haben.");
        }
        const schluessel = `unterschriften/${nutzer.benutzer}.png`;
        await env.R2.put(schluessel, await datei.arrayBuffer(), {
          httpMetadata: { contentType: "image/png" },
        });
        await personSpeichern(env.DB, nutzer.benutzer, { unterschrift: schluessel });
        return umleitung("/einstellungen?meldung=Unterschrift+hinterlegt.");
      }
    }

    /* Pfade mit Kennung. */
    const teile = pfad.split("/").filter(Boolean);

    if (teile[0] === "datei") {
      return datei(env, teile.slice(1).map(decodeURIComponent).join("/"));
    }

    if (teile[0] === "objekt" && teile[1]) {
      return objektRoute(request, env, nutzer, decodeURIComponent(teile[1]), teile, url);
    }

    if (teile[0] === "begehung" && teile[1]) {
      return begehungRoute(request, env, nutzer, decodeURIComponent(teile[1]), teile, url);
    }

    if (teile[0] === "mangel" && teile[1]) {
      return mangelRoute(request, env, nutzer, decodeURIComponent(teile[1]), teile, url);
    }

    return fehlerSeite("Nicht gefunden", `${request.method} ${pfad} gibt es hier nicht.`, 404);
  },
} satisfies ExportedHandler<Env>;

/* ── Anmeldung ─────────────────────────────────────────────────────────────── */

async function konten(env: Env): Promise<{ benutzer: string; name: string }[]> {
  try {
    const liste = await personenListe(env.DB);
    return liste.map((p) => ({ benutzer: p.benutzer, name: p.name || p.benutzer }));
  } catch {
    // Solange das Schema nicht steht, lieber ein freies Feld als eine kaputte Seite.
    return [];
  }
}

async function anmelden(request: Request, env: Env, origin: string): Promise<Response> {
  const form = await request.formData();
  const benutzer = String(form.get("benutzer") ?? "").trim().toLowerCase();
  const passwort = String(form.get("passwort") ?? "");
  const weiter = sicheresZiel(String(form.get("weiter") ?? "") || null);
  if (!benutzer || !passwort) {
    return anmeldeSeite(origin, await konten(env), {
      fehler: "Benutzer und Passwort eingeben.",
      benutzer,
      weiter,
    });
  }

  if (await gesperrt(env.OAUTH_KV, benutzer)) {
    return anmeldeSeite(origin, await konten(env), {
      fehler: "Zu viele Fehlversuche. In 15 Minuten noch einmal probieren.",
      benutzer,
      weiter,
    });
  }

  const person = await personLesen(env.DB, benutzer);
  const passt = person?.passwort_hash ? await pruefen(passwort, person.passwort_hash) : false;
  if (!person || !passt) {
    await fehlversuch(env.OAUTH_KV, benutzer);
    return anmeldeSeite(origin, await konten(env), {
      fehler: "Benutzer oder Passwort stimmt nicht.",
      benutzer,
      weiter,
    });
  }

  await bremseLoesen(env.OAUTH_KV, benutzer);
  await personGesehen(env.DB, benutzer);
  const angemeldeter: Nutzer = { benutzer: person.benutzer, name: person.name || person.benutzer };
  return umleitung(weiter, await sitzungsCookie(env.SITZUNGS_SCHLUESSEL, angemeldeter));
}

/* ── /authorize ────────────────────────────────────────────────────────────── */

async function authorize(
  request: Request,
  env: Env,
  url: URL,
  origin: string,
  nutzer: Nutzer | null,
): Promise<Response> {
  const quelle = request.method === "POST" ? await request.formData() : url.searchParams;
  const parsed = leseAuthParams(quelle as URLSearchParams | FormData);
  if ("error" in parsed) return fehlerSeite("Ungültige Anfrage", parsed.error);

  const client = await ladeClient(env, parsed.client_id);
  if (!client) {
    return fehlerSeite("Unbekannter Client", "Diese client_id ist nicht registriert.");
  }
  if (!client.redirect_uris.includes(parsed.redirect_uri)) {
    return fehlerSeite(
      "Ungültige redirect_uri",
      "Die redirect_uri gehört nicht zu diesem Client. Aus Sicherheitsgründen wird nicht weitergeleitet.",
    );
  }

  const felder: Record<string, string> = {
    client_id: parsed.client_id,
    redirect_uri: parsed.redirect_uri,
    state: parsed.state,
    code_challenge: parsed.code_challenge,
    scope: parsed.scope,
    response_type: "code",
    code_challenge_method: "S256",
  };

  if (!nutzer) {
    return anmeldeSeite(origin, await konten(env), {
      weiter: url.pathname + url.search,
      knapp: true,
    });
  }

  if (request.method === "GET") {
    return freigabeSeite(nutzer, client.client_name, client.client_uri, felder);
  }

  const ziel = new URL(parsed.redirect_uri);
  if (String((quelle as FormData).get("entscheidung")) !== "ja") {
    ziel.searchParams.set("error", "access_denied");
    if (parsed.state) ziel.searchParams.set("state", parsed.state);
    return Response.redirect(ziel.toString(), 302);
  }

  const code = await codeAusstellen(env, client, parsed, nutzer);
  ziel.searchParams.set("code", code);
  if (parsed.state) ziel.searchParams.set("state", parsed.state);
  return Response.redirect(ziel.toString(), 302);
}

/* ── Dateien ───────────────────────────────────────────────────────────────── */

async function datei(env: Env, schluessel: string): Promise<Response> {
  /* Nur diese vier Ablagen sind über diesen Weg lesbar — Vorlagen und Importe nicht. */
  if (!/^(berichte|fotos|plaene|unterschriften)\//.test(schluessel)) {
    return fehlerSeite("Nicht gefunden", "Diesen Pfad gibt es nicht.", 404);
  }
  const obj = await env.R2.get(schluessel);
  if (!obj) return fehlerSeite("Nicht gefunden", "Die Datei gibt es nicht (mehr).", 404);
  const name = schluessel.split("/").pop()!;
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "private, max-age=60",
    },
  });
}

/* ── Objekt ────────────────────────────────────────────────────────────────── */

async function objektRoute(
  request: Request,
  env: Env,
  nutzer: Nutzer,
  id: string,
  teile: string[],
  url: URL,
): Promise<Response> {
  const objekt = await objektLesen(env.DB, id);
  if (!objekt) return fehlerSeite("Nicht gefunden", "Dieses Objekt gibt es nicht.", 404);
  zugriffPruefen(nutzer.benutzer, objekt.id);
  const meldung = url.searchParams.get("meldung") ?? undefined;

  if (teile.length === 2) {
    if (request.method === "GET") {
      return objektSeite(env, nutzer, objekt.id, {
        meldung,
        nurFaellige: url.searchParams.get("faellig") === "1",
      });
    }
    if (request.method === "POST") {
      const form = await request.formData();
      const patch: Record<string, unknown> = {};
      for (const feld of [
        "name", "adresse", "plz", "betreiber", "betreiber_kontakt", "ident",
        "rechtsgrundlagen", "notizen",
      ]) {
        if (form.get(feld) !== null) patch[feld] = String(form.get(feld));
      }
      const intervall = Number(form.get("intervall_monate"));
      if (Number.isFinite(intervall) && intervall > 0) patch.intervall_monate = intervall;
      await objektAendern(env.DB, objekt.id, patch);
      return umleitung(`/objekt/${objekt.id}?meldung=Stammdaten+gespeichert.`);
    }
  }

  if (teile.length === 3 && teile[2] === "loeschen" && request.method === "POST") {
    /* Der Ausnahmefall: Fehlanlage oder Testlauf. Im Alltag wird stillgelegt, nicht gelöscht. */
    const schluessel = await objektLoeschen(env.DB, objekt.id);
    for (const k of schluessel) await env.R2.delete(k);
    return umleitung("/objekte?meldung=Objekt+entfernt.");
  }

  if (teile.length === 3 && teile[2] === "begehung" && request.method === "POST") {
    const person = await personLesen(env.DB, nutzer.benutzer);
    const v = person?.vorgaben ?? {};
    const b = await begehungAnlegen(env.DB, {
      objekt_id: objekt.id,
      datum: heute(),
      pruefer: v.pruefer ?? nutzer.name,
      befaehigung: v.befaehigung,
      ort: v.ort,
      angelegt_von: nutzer.benutzer,
    });
    return umleitung(`/begehung/${b.id}`);
  }

  if (teile.length === 3 && teile[2] === "geschosse") {
    if (request.method === "GET") return geschosseSeite(env, nutzer, objekt.id, meldung);
    if (request.method === "POST") {
      const form = await request.formData();
      for (const g of await geschosseListe(env.DB, objekt.id)) {
        const name = form.get(`name_${g.id}`);
        const reihenfolge = form.get(`reihenfolge_${g.id}`);
        const patch: { name?: string; reihenfolge?: number } = {};
        if (name !== null && String(name).trim()) patch.name = String(name).trim();
        if (reihenfolge !== null && String(reihenfolge).trim() !== "") {
          const zahl = Number(reihenfolge);
          if (Number.isFinite(zahl)) patch.reihenfolge = zahl;
        }
        await geschossAendern(env.DB, g.id, patch);
      }
      const neu = String(form.get("neu") ?? "").trim();
      if (neu) await geschossAnlegen(env.DB, objekt.id, neu);
      return umleitung(`/objekt/${objekt.id}/geschosse?meldung=Geschosse+gespeichert.`);
    }
  }

  if (teile.length === 4 && teile[2] === "bauteil") {
    const kennung = teile[3];
    const nr = kennung === "neu" ? null : Number(kennung);
    if (nr !== null && !Number.isFinite(nr)) {
      return fehlerSeite("Ungültiges Bauteil", `'${kennung}' ist keine Nummer.`, 400);
    }
    if (request.method === "GET") {
      return bauteilSeite(env, nutzer, objekt.id, nr, meldung);
    }
    if (request.method === "POST") {
      const form = await request.formData();
      const art = String(form.get("art") ?? "wartung_drehfluegel");
      const v = vorlage(art);
      const felder: Record<string, string> = {};
      for (const feld of v.bauteilfelder) {
        const wert = form.get(`f_${feld}`);
        if (wert !== null) felder[feld] = String(wert).trim();
      }
      const intervall = Number(form.get("intervall_monate"));
      const gemeinsam = {
        art,
        kennung: String(form.get("kennung") ?? "").trim(),
        geschoss_id: String(form.get("geschoss_id") ?? "") || null,
        raumnummer: String(form.get("raumnummer") ?? "").trim(),
        raum: String(form.get("raum") ?? "").trim(),
        flur: String(form.get("flur") ?? "").trim(),
        bezeichnung: String(form.get("bezeichnung") ?? "").trim(),
        felder,
        intervall_monate: Number.isFinite(intervall) && intervall > 0 ? intervall : null,
        wartungspflichtig: form.get("wartungspflichtig") ? 1 : 0,
        aktiv: form.get("aktiv") ? 1 : 0,
      };
      const bestehende = await bauteileMitStand(env.DB, objekt, { auch_stillgelegte: true });
      const vorhanden = nr === null ? null : bestehende.find((b) => b.nr === nr);
      if (vorhanden) {
        const gewuenschteNr = Number(form.get("nr"));
        await bauteilAendern(env.DB, vorhanden.id, {
          ...gemeinsam,
          nr: Number.isFinite(gewuenschteNr) && gewuenschteNr > 0 ? gewuenschteNr : undefined,
        });
        return umleitung(`/objekt/${objekt.id}/bauteil/${vorhanden.nr}?meldung=Gespeichert.`);
      }
      const gewuenschteNr = Number(form.get("nr"));
      const b = await bauteilAnlegen(env.DB, {
        objekt_id: objekt.id,
        ...gemeinsam,
        nr: Number.isFinite(gewuenschteNr) && gewuenschteNr > 0 ? gewuenschteNr : undefined,
      });
      return umleitung(`/objekt/${objekt.id}/bauteil/${b.nr}?meldung=Angelegt.`);
    }
  }

  return fehlerSeite("Nicht gefunden", "Diesen Weg gibt es hier nicht.", 404);
}

/* ── Begehung ──────────────────────────────────────────────────────────────── */

async function begehungRoute(
  request: Request,
  env: Env,
  nutzer: Nutzer,
  id: string,
  teile: string[],
  url: URL,
): Promise<Response> {
  const begehung = await begehungLesen(env.DB, id);
  if (!begehung) return fehlerSeite("Nicht gefunden", "Diese Begehung gibt es nicht.", 404);
  zugriffPruefen(nutzer.benutzer, begehung.objekt_id);
  const meldung = url.searchParams.get("meldung") ?? undefined;

  if (teile.length === 2) {
    if (request.method === "GET") return begehungSeite(env, nutzer, begehung.id, meldung);
    if (request.method === "POST") {
      const form = await request.formData();
      const patch: Record<string, string> = {};
      for (const feld of ["datum", "pruefer", "befaehigung", "ort", "beteiligte", "status"]) {
        if (form.get(feld) !== null) patch[feld] = String(form.get(feld));
      }
      await begehungAendern(env.DB, begehung.id, patch);
      return umleitung(`/begehung/${begehung.id}?meldung=Stammdaten+gespeichert.`);
    }
  }

  if (teile.length === 3 && teile[2] === "paket.zip") {
    try {
      const paket = await berichtePaket(env, begehung.id);
      return new Response(paket.daten as BodyInit, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${paket.name}"`,
          "cache-control": "no-store",
        },
      });
    } catch (e) {
      return fehlerSeite("Kein Paket", (e as Error).message, 404);
    }
  }

  if (teile.length === 3 && teile[2] === "erzeugen" && request.method === "POST") {
    try {
      return json(await berichteErzeugen(env, begehung.id, { nutzer: nutzer.benutzer }));
    } catch (e) {
      return json({ fehler: (e as Error).message }, 400);
    }
  }

  if (teile.length === 3 && teile[2] === "sammelbericht" && request.method === "POST") {
    try {
      const s = await sammelberichtErzeugen(env, begehung.id, nutzer.benutzer);
      return json({ ...s, fertig: true, erzeugt: 1 });
    } catch (e) {
      return json({ fehler: (e as Error).message }, 400);
    }
  }

  if (teile.length === 3 && teile[2] === "unterschrift") {
    if (request.method === "GET") return unterschriftSeite(env, nutzer, begehung.id, meldung);
    if (request.method === "POST") {
      const form = await request.formData();
      const bild = String(form.get("bild") ?? "");
      const name = String(form.get("name") ?? "").trim();
      const treffer = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(bild);
      if (!treffer) {
        return fehlerSeite("Keine Unterschrift", "Das Unterschriftsfeld war leer.");
      }
      const roh = atob(treffer[1]);
      const bytes = new Uint8Array(roh.length);
      for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
      if (bytes.length > 2 * 1024 * 1024) {
        return fehlerSeite("Zu groß", "Die Unterschrift darf höchstens 2 MB haben.");
      }
      const schluessel = `unterschriften/betreiber/${begehung.id}.png`;
      await env.R2.put(schluessel, bytes, { httpMetadata: { contentType: "image/png" } });
      await betreiberUnterschrift(env.DB, begehung.id, schluessel, name);
      /* Die Unterschrift ändert den Stand — die Berichte entstehen in neuer Version. */
      let meldungText = "Unterschrift+gespeichert.";
      try {
        const lauf = await berichteErzeugen(env, begehung.id, { nutzer: nutzer.benutzer });
        meldungText = `Unterschrift+gespeichert,+${lauf.erzeugt}+Berichte+neu.`;
      } catch {
        /* Ohne Prüfungen gibt es noch nichts zu erzeugen — das ist kein Fehler. */
      }
      return umleitung(`/begehung/${begehung.id}?meldung=${meldungText}`);
    }
  }

  if (teile.length === 4 && teile[2] === "pruefung") {
    const kennung = teile[3];
    const nr = kennung === "neu" ? null : Number(kennung);
    if (nr !== null && !Number.isFinite(nr)) {
      return fehlerSeite("Ungültige Prüfung", `'${kennung}' ist keine Bauteilnummer.`, 400);
    }
    if (request.method === "GET") {
      return pruefungSeite(env, nutzer, begehung.id, nr);
    }
    if (request.method === "POST") {
      const objekt = await objektLesen(env.DB, begehung.objekt_id);
      if (!objekt) return fehlerSeite("Nicht gefunden", "Objekt fehlt.", 404);
      const form = await request.formData();
      const art = String(form.get("art") ?? "") || undefined;
      const bestehende = await bauteileMitStand(env.DB, objekt, { auch_stillgelegte: true });
      const vorhanden = nr === null ? null : bestehende.find((b) => b.nr === nr);
      const vorlagenId = vorhanden?.art ?? art ?? "wartung_drehfluegel";
      const v = vorlage(vorlagenId);

      const felder: Record<string, string> = {};
      for (const feld of v.bauteilfelder) {
        const wert = form.get(`f_${feld}`);
        if (wert !== null) felder[feld] = String(wert).trim();
      }
      /* Nur Abweichungen speichern — „in Ordnung" ist der Standard und braucht keinen Eintrag. */
      const checks: Record<string, Bewertung> = {};
      for (const p of v.punkte) {
        const wert = String(form.get(`p_${p.nr}`) ?? "io");
        if (wert !== "io") checks[p.nr] = wert as Bewertung;
      }
      const gewuenschteNr = Number(form.get("nr"));

      const e = await pruefungErfassen(
        env.DB,
        objekt,
        begehung,
        {
          nr: vorhanden ? vorhanden.nr : Number.isFinite(gewuenschteNr) ? gewuenschteNr : undefined,
          art: vorlagenId,
          felder,
          checks,
          ergebnis: String(form.get("ergebnis") ?? "bestanden"),
          hinweise: String(form.get("hinweise") ?? "").trim(),
          raumnummer: String(form.get("raumnummer") ?? "").trim(),
          raum: String(form.get("raum") ?? "").trim(),
          flur: String(form.get("flur") ?? "").trim(),
        },
        nutzer.benutzer,
      );
      return umleitung(`/begehung/${begehung.id}?meldung=Tür+${e.bauteil.nr}+gespeichert.`);
    }
  }

  return fehlerSeite("Nicht gefunden", "Diesen Weg gibt es hier nicht.", 404);
}

/* ── Mangel ────────────────────────────────────────────────────────────────── */

async function mangelRoute(
  request: Request,
  env: Env,
  nutzer: Nutzer,
  id: string,
  teile: string[],
  url: URL,
): Promise<Response> {
  const m = await mangelLesen(env.DB, id);
  if (!m) return fehlerSeite("Nicht gefunden", "Diesen Mangel gibt es nicht.", 404);
  zugriffPruefen(nutzer.benutzer, m.objekt_id);

  if (teile.length === 2) {
    if (request.method === "GET") {
      return mangelSeite(env, nutzer, m.id, url.searchParams.get("meldung") ?? undefined);
    }
    if (request.method === "POST") {
      const form = await request.formData();
      const patch: Record<string, unknown> = {};
      for (const feld of ["beschreibung", "prioritaet", "zustaendig", "status"]) {
        if (form.get(feld) !== null) patch[feld] = String(form.get(feld));
      }
      const frist = String(form.get("frist") ?? "").trim();
      patch.frist = frist || null;
      await mangelAendern(env.DB, m.id, patch);
      return umleitung(`/mangel/${m.id}?meldung=Gespeichert.`);
    }
  }

  if (teile.length === 3 && teile[2] === "schliessen" && request.method === "POST") {
    const form = await request.formData();
    await mangelSchliessen(
      env.DB,
      m.id,
      String(form.get("freimeldung") ?? "").trim(),
      nutzer.benutzer,
    );
    return umleitung(`/mangel/${m.id}?meldung=Als+behoben+gemeldet.`);
  }

  return fehlerSeite("Nicht gefunden", "Diesen Weg gibt es hier nicht.", 404);
}
