/**
 * OAuth-2.1-Authorization-Server für den MCP-Zugang.
 *
 * Übernommen aus dem HERO-/sevdesk-Gerüst (mcpees/shared/src/oauth.ts) und an einer Stelle
 * geändert: dort tippt der Nutzer einen Fremdsystem-Schlüssel in ein Formular, hier meldet er
 * sich mit seinem Konto dieser App an. Alles andere ist gleich geblieben.
 *
 * Umgesetzt sind die Teile, die die MCP-Auth-Spec verlangt:
 *   - RFC 8414  Authorization Server Metadata
 *   - RFC 9728  Protected Resource Metadata (+ WWW-Authenticate auf 401)
 *   - RFC 7591  Dynamic Client Registration (Claude registriert sich selbst)
 *   - RFC 7636  PKCE mit S256 — Pflicht, nicht optional
 *   - Refresh-Token-Rotation
 *
 * Wer im Token steckt, liegt nie im Klartext in KV: die Angaben werden mit einem aus dem
 * jeweiligen Token abgeleiteten Schlüssel verschlüsselt. Wer nur KV lesen kann, bekommt
 * Chiffretext.
 */
import {
  randomToken,
  sha256hex,
  sealJSON,
  openJSON,
  timingSafeEqual,
  verifyPkceS256,
} from "../shared/crypto";
import type { Env } from "../env";
import type { Nutzer } from "./sitzung";

const CODE_TTL = 600; // 10 min
const ACCESS_TTL = 60 * 60; // 1 h
const REFRESH_TTL = 60 * 60 * 24 * 30; // 30 Tage

export const SCOPES = "wartung:lesen wartung:schreiben";

export interface ClientRecord {
  client_id: string;
  client_secret_hash?: string;
  client_name: string;
  client_uri?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  created: number;
}

interface GrantRecord {
  clientId: string;
  clientName: string;
  benutzer: string;
  name: string;
  created: number;
  revoked?: boolean;
}

/** Was hinter einem gültigen Bearer-Token steht. */
export interface Sitzung {
  nutzer: Nutzer;
  grantId: string;
  clientId: string;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...headers,
    },
  });

const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status);

/* ── Metadaten ─────────────────────────────────────────────────────────────── */

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    revocation_endpoint: `${origin}/revoke`,
    scopes_supported: SCOPES.split(" "),
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${origin}/`,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: SCOPES.split(" "),
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/`,
  };
}

/** 401 nach RFC 9728 — der Client erfährt daraus, wo er sich anmelden kann. */
export function unauthorized(origin: string, beschreibung: string): Response {
  return json({ error: "invalid_token", error_description: beschreibung }, 401, {
    "www-authenticate":
      `Bearer realm="tuerwartung", ` +
      `resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  });
}

/* ── Dynamic Client Registration ───────────────────────────────────────────── */

export async function handleRegister(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "Body ist kein JSON.");
  }

  const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length) {
    return oauthError("invalid_redirect_uri", "redirect_uris fehlt oder ist leer.");
  }
  for (const uri of redirectUris) {
    let u: URL;
    try {
      u = new URL(uri);
    } catch {
      return oauthError("invalid_redirect_uri", `'${uri}' ist keine gültige URL.`);
    }
    // Nur https, localhost oder eine eigene App-Scheme — kein http auf fremde Hosts.
    const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !isLocal && !u.protocol.includes(".")) {
      return oauthError(
        "invalid_redirect_uri",
        `'${uri}' muss https, localhost oder ein App-Scheme sein.`,
      );
    }
  }

  const method = body.token_endpoint_auth_method ?? "client_secret_post";
  const clientId = randomToken("tw_c_");
  const record: ClientRecord = {
    client_id: clientId,
    client_name: String(body.client_name ?? "Unbenannter MCP-Client").slice(0, 120),
    client_uri: body.client_uri ? String(body.client_uri).slice(0, 300) : undefined,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: method,
    created: Date.now(),
  };

  let secret: string | undefined;
  if (method !== "none") {
    secret = randomToken("tw_cs_");
    record.client_secret_hash = await sha256hex(secret);
  }
  await env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify(record));

  return json(
    {
      client_id: clientId,
      ...(secret ? { client_secret: secret } : {}),
      client_id_issued_at: Math.floor(record.created / 1000),
      ...(secret ? { client_secret_expires_at: 0 } : {}),
      client_name: record.client_name,
      redirect_uris: record.redirect_uris,
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

/* ── /authorize ────────────────────────────────────────────────────────────── */

export interface AuthParams {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  scope: string;
}

export function leseAuthParams(
  src: URLSearchParams | FormData,
): AuthParams | { error: string } {
  const get = (k: string) => String(src.get(k) ?? "");
  const client_id = get("client_id");
  const redirect_uri = get("redirect_uri");
  const response_type = get("response_type");
  const code_challenge = get("code_challenge");
  const method = get("code_challenge_method");

  if (!client_id) return { error: "client_id fehlt." };
  if (!redirect_uri) return { error: "redirect_uri fehlt." };
  if (response_type !== "code") return { error: "Nur response_type=code wird unterstützt." };
  if (!code_challenge) return { error: "PKCE ist Pflicht: code_challenge fehlt." };
  if (method !== "S256") return { error: "Nur code_challenge_method=S256 wird unterstützt." };

  return {
    client_id,
    redirect_uri,
    state: get("state"),
    code_challenge,
    scope: get("scope") || SCOPES,
  };
}

export async function ladeClient(env: Env, clientId: string): Promise<ClientRecord | null> {
  return env.OAUTH_KV.get<ClientRecord>(`client:${clientId}`, "json");
}

/**
 * Freigabe festschreiben und den Auth-Code ausstellen. Wird gerufen, wenn der Nutzer
 * angemeldet ist und auf der Freigabeseite bestätigt hat.
 */
export async function codeAusstellen(
  env: Env,
  client: ClientRecord,
  params: AuthParams,
  nutzer: Nutzer,
): Promise<string> {
  const grantId = randomToken("tw_g_");
  const grant: GrantRecord = {
    clientId: client.client_id,
    clientName: client.client_name,
    benutzer: nutzer.benutzer,
    name: nutzer.name,
    created: Date.now(),
  };
  await env.OAUTH_KV.put(`grant:${grantId}`, JSON.stringify(grant), {
    expirationTtl: REFRESH_TTL,
  });

  const code = randomToken("tw_ac_");
  await env.OAUTH_KV.put(
    `ac:${await sha256hex(code)}`,
    JSON.stringify({
      clientId: client.client_id,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      grantId,
      scope: params.scope,
      sealed: await sealJSON(code, { nutzer }),
    }),
    { expirationTtl: CODE_TTL },
  );
  return code;
}

/* ── /token ────────────────────────────────────────────────────────────────── */

async function clientPruefen(
  req: Request,
  form: FormData,
  env: Env,
): Promise<ClientRecord | Response> {
  let clientId = String(form.get("client_id") ?? "");
  let clientSecret = String(form.get("client_secret") ?? "");

  const basic = req.headers.get("authorization");
  if (basic?.toLowerCase().startsWith("basic ")) {
    try {
      const [id, secret] = atob(basic.slice(6)).split(":");
      clientId = clientId || decodeURIComponent(id ?? "");
      clientSecret = clientSecret || decodeURIComponent(secret ?? "");
    } catch {
      return oauthError("invalid_client", "Basic-Auth-Header ist unlesbar.", 401);
    }
  }
  if (!clientId) return oauthError("invalid_client", "client_id fehlt.", 401);

  const client = await ladeClient(env, clientId);
  if (!client) return oauthError("invalid_client", "Unbekannte client_id.", 401);

  if (client.client_secret_hash) {
    if (!clientSecret) return oauthError("invalid_client", "client_secret fehlt.", 401);
    const given = await sha256hex(clientSecret);
    if (!timingSafeEqual(given, client.client_secret_hash)) {
      return oauthError("invalid_client", "client_secret stimmt nicht.", 401);
    }
  }
  return client;
}

/** Access- und Refresh-Token frisch ausstellen; die Identität wird pro Token neu versiegelt. */
async function tokenAusstellen(
  env: Env,
  grantId: string,
  clientId: string,
  nutzer: Nutzer,
  scope: string,
) {
  const accessToken = randomToken("tw_at_");
  const refreshToken = randomToken("tw_rt_");
  await Promise.all([
    env.OAUTH_KV.put(
      `at:${await sha256hex(accessToken)}`,
      JSON.stringify({ grantId, clientId, sealed: await sealJSON(accessToken, { nutzer }) }),
      { expirationTtl: ACCESS_TTL },
    ),
    env.OAUTH_KV.put(
      `rt:${await sha256hex(refreshToken)}`,
      JSON.stringify({ grantId, clientId, sealed: await sealJSON(refreshToken, { nutzer }) }),
      { expirationTtl: REFRESH_TTL },
    ),
  ]);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: refreshToken,
    scope,
  };
}

export async function handleToken(req: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return oauthError("invalid_request", "Body muss application/x-www-form-urlencoded sein.");
  }

  const client = await clientPruefen(req, form, env);
  if (client instanceof Response) return client;

  const grantType = String(form.get("grant_type") ?? "");

  if (grantType === "authorization_code") {
    const code = String(form.get("code") ?? "");
    const verifier = String(form.get("code_verifier") ?? "");
    const redirectUri = String(form.get("redirect_uri") ?? "");
    if (!code) return oauthError("invalid_request", "code fehlt.");
    if (!verifier) return oauthError("invalid_request", "code_verifier fehlt (PKCE ist Pflicht).");

    const kvKey = `ac:${await sha256hex(code)}`;
    const rec = await env.OAUTH_KV.get<any>(kvKey, "json");
    if (!rec) return oauthError("invalid_grant", "Code unbekannt, abgelaufen oder schon benutzt.");
    // Einmalgebrauch: sofort löschen, egal wie es weitergeht.
    await env.OAUTH_KV.delete(kvKey);

    if (rec.clientId !== client.client_id) {
      return oauthError("invalid_grant", "Der Code gehört zu einem anderen Client.");
    }
    if (redirectUri && redirectUri !== rec.redirectUri) {
      return oauthError("invalid_grant", "redirect_uri stimmt nicht mit der Autorisierung überein.");
    }
    if (!(await verifyPkceS256(verifier, rec.codeChallenge))) {
      return oauthError("invalid_grant", "code_verifier passt nicht zur code_challenge.");
    }

    const { nutzer } = await openJSON<{ nutzer: Nutzer }>(code, rec.sealed);
    return json(
      await tokenAusstellen(env, rec.grantId, client.client_id, nutzer, rec.scope ?? SCOPES),
    );
  }

  if (grantType === "refresh_token") {
    const token = String(form.get("refresh_token") ?? "");
    if (!token) return oauthError("invalid_request", "refresh_token fehlt.");

    const kvKey = `rt:${await sha256hex(token)}`;
    const rec = await env.OAUTH_KV.get<any>(kvKey, "json");
    if (!rec) return oauthError("invalid_grant", "refresh_token unbekannt oder abgelaufen.");
    if (rec.clientId !== client.client_id) {
      return oauthError("invalid_grant", "Das Token gehört zu einem anderen Client.");
    }
    const grant = await env.OAUTH_KV.get<GrantRecord>(`grant:${rec.grantId}`, "json");
    if (!grant || grant.revoked) {
      return oauthError("invalid_grant", "Die Freigabe wurde widerrufen.");
    }
    // Rotation: das alte Refresh-Token gilt ab jetzt nicht mehr.
    await env.OAUTH_KV.delete(kvKey);
    const { nutzer } = await openJSON<{ nutzer: Nutzer }>(token, rec.sealed);
    return json(await tokenAusstellen(env, rec.grantId, client.client_id, nutzer, SCOPES));
  }

  return oauthError("unsupported_grant_type", `grant_type '${grantType}' wird nicht unterstützt.`);
}

/* ── /revoke ───────────────────────────────────────────────────────────────── */

export async function handleRevoke(req: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return oauthError("invalid_request", "Body muss application/x-www-form-urlencoded sein.");
  }
  const token = String(form.get("token") ?? "");
  if (token) {
    const hash = await sha256hex(token);
    const rec =
      (await env.OAUTH_KV.get<any>(`at:${hash}`, "json")) ??
      (await env.OAUTH_KV.get<any>(`rt:${hash}`, "json"));
    await Promise.all([env.OAUTH_KV.delete(`at:${hash}`), env.OAUTH_KV.delete(`rt:${hash}`)]);
    if (rec?.grantId) {
      const grant = await env.OAUTH_KV.get<GrantRecord>(`grant:${rec.grantId}`, "json");
      if (grant) {
        await env.OAUTH_KV.put(`grant:${rec.grantId}`, JSON.stringify({ ...grant, revoked: true }), {
          expirationTtl: REFRESH_TTL,
        });
      }
    }
  }
  // RFC 7009: auch bei unbekanntem Token 200.
  return json({});
}

/* ── Bearer-Token prüfen ───────────────────────────────────────────────────── */

export async function bearerPruefen(req: Request, env: Env): Promise<Sitzung | null> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const rec = await env.OAUTH_KV.get<any>(`at:${await sha256hex(token)}`, "json");
  if (!rec) return null;

  const grant = await env.OAUTH_KV.get<GrantRecord>(`grant:${rec.grantId}`, "json");
  if (!grant || grant.revoked) return null;

  try {
    const { nutzer } = await openJSON<{ nutzer: Nutzer }>(token, rec.sealed);
    return { nutzer, grantId: rec.grantId, clientId: rec.clientId };
  } catch {
    return null; // Chiffretext passt nicht zum Token — behandeln wie ungültig.
  }
}
