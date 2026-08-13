/**
 * Türenwartung — ein Worker, drei Gesichter:
 *
 *   1. die Arbeitsfläche im Browser (Wartungen ansehen, korrigieren, Berichte holen),
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
  tuerSeite,
  verbindenSeite,
  wartungSeite,
  wartungenSeite,
} from "./web/seiten";
import {
  naechsteNr,
  personGesehen,
  personLesen,
  personSpeichern,
  personenListe,
  tuerLoeschen,
  tuerSpeichern,
  wartungAendern,
  wartungAnlegen,
} from "./daten/wartungen";
import type { Bewertung } from "./vorlagen";
import { vorlage } from "./vorlagen";
import { berichtePaket, berichteErzeugen } from "./pdf/berichte";

const SERVER_INFO = {
  name: "tuerwartung",
  title: "Türenwartung Seehafer Elemente",
  version: "1.0.0",
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
  return wert && wert.startsWith("/") && !wert.startsWith("//") ? wert : "/wartungen";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const pfad = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
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
          server: { name: SERVER_INFO.name, version: SERVER_INFO.version, protocolVersion: PROTOCOL_VERSION },
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

    switch (`${request.method} ${pfad}`) {
      case "GET /":
        return umleitung("/wartungen");

      case "GET /wartungen":
        return wartungenSeite(env, nutzer, url.searchParams.get("suche") ?? "");

      case "POST /wartungen": {
        const form = await request.formData();
        const w = await wartungAnlegen(env.DB, {
          vorlage: String(form.get("vorlage") ?? ""),
          objekt: String(form.get("objekt") ?? ""),
          betreiber: String(form.get("betreiber") ?? ""),
          datum: String(form.get("datum") ?? ""),
          angelegt_von: nutzer.benutzer,
        });
        return umleitung(`/wartung/${encodeURIComponent(w.id)}`);
      }

      case "GET /verbinden":
        return verbindenSeite(origin, nutzer);

      case "GET /einstellungen":
        return einstellungenSeite(env, nutzer, url.searchParams.get("meldung") ?? undefined);

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
      return datei(env, teile.slice(1).join("/"));
    }

    if (teile[0] === "wartung" && teile[1]) {
      const id = decodeURIComponent(teile[1]);

      if (teile.length === 2) {
        if (request.method === "GET") {
          return wartungSeite(env, nutzer, id, url.searchParams.get("meldung") ?? undefined);
        }
        if (request.method === "POST") {
          const form = await request.formData();
          const patch: Record<string, string> = {};
          for (const feld of [
            "objekt", "betreiber", "ident", "tuertyp", "pruefer", "befaehigung", "datum",
            "ort", "rechtsgrundlagen", "letzte_pruefung", "naechste_pruefung", "beteiligte",
          ]) {
            if (form.get(feld) !== null) patch[feld] = String(form.get(feld));
          }
          await wartungAendern(env.DB, id, patch);
          return umleitung(`/wartung/${encodeURIComponent(id)}?meldung=Stammdaten+gespeichert.`);
        }
      }

      if (teile.length === 3 && teile[2] === "paket.zip") {
        try {
          const paket = await berichtePaket(env, id);
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
          const lauf = await berichteErzeugen(env, id);
          return json({ ...lauf, fehler_je_tuer: lauf.fehler });
        } catch (e) {
          return json({ fehler: (e as Error).message }, 400);
        }
      }

      if (teile[2] === "tuer" && teile[3]) {
        return tuerRoute(request, env, nutzer, id, teile);
      }
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
  const nutzer: Nutzer = { benutzer: person.benutzer, name: person.name || person.benutzer };
  return umleitung(weiter, await sitzungsCookie(env.SITZUNGS_SCHLUESSEL, nutzer));
}

/* ── /authorize ────────────────────────────────────────────────────────────── */

async function authorize(
  request: Request,
  env: Env,
  url: URL,
  origin: string,
  nutzer: Nutzer | null,
): Promise<Response> {
  const quelle =
    request.method === "POST" ? await request.formData() : url.searchParams;
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
  // Nur die beiden Ablagen sind über diesen Weg lesbar — Vorlagen und alles andere nicht.
  if (!/^(berichte|unterschriften)\//.test(schluessel)) {
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

/* ── Türen ─────────────────────────────────────────────────────────────────── */

async function tuerRoute(
  request: Request,
  env: Env,
  nutzer: Nutzer,
  wartungId: string,
  teile: string[],
): Promise<Response> {
  const kennung = teile[3];
  const nr = kennung === "neu" ? null : Number(kennung);
  if (nr !== null && !Number.isFinite(nr)) {
    return fehlerSeite("Ungültige Tür", `'${kennung}' ist keine Türnummer.`, 400);
  }

  if (request.method === "GET" && teile.length === 4) {
    return tuerSeite(env, nutzer, wartungId, nr);
  }

  if (request.method === "POST" && teile.length === 5 && teile[4] === "loeschen" && nr !== null) {
    await tuerLoeschen(env.DB, wartungId, nr);
    return umleitung(`/wartung/${encodeURIComponent(wartungId)}?meldung=Tür+${nr}+gelöscht.`);
  }

  if (request.method === "POST" && teile.length === 4) {
    const w = await env.DB.prepare("SELECT vorlage FROM wartungen WHERE id = ?")
      .bind(wartungId)
      .first<{ vorlage: string }>();
    if (!w) return fehlerSeite("Nicht gefunden", "Diese Wartung gibt es nicht.", 404);
    const v = vorlage(w.vorlage);

    const form = await request.formData();
    const felder: Record<string, string> = {};
    for (const feld of v.tuerfelder) {
      const wert = String(form.get(`f_${feld}`) ?? "").trim();
      if (wert) felder[feld] = wert;
    }
    /* Nur Abweichungen speichern — „in Ordnung" ist der Standard und braucht keinen Eintrag. */
    const checks: Record<string, Bewertung> = {};
    for (const p of v.punkte) {
      const wert = String(form.get(`p_${p.nr}`) ?? "io");
      if (wert !== "io") checks[p.nr] = wert as Bewertung;
    }

    await tuerSpeichern(env.DB, wartungId, {
      nr: nr ?? (await naechsteNr(env.DB, wartungId)),
      felder,
      checks,
      ergebnis: String(form.get("ergebnis") ?? "bestanden"),
      hinweise: String(form.get("hinweise") ?? "").trim(),
    });
    return umleitung(`/wartung/${encodeURIComponent(wartungId)}`);
  }

  return fehlerSeite("Nicht gefunden", "Diesen Weg gibt es nicht.", 404);
}
