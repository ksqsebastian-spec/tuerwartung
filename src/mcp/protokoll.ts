/**
 * MCP über Streamable HTTP, zustandslos — übernommen aus mcpees/shared/src/mcp.ts.
 *
 * Zustandslos heißt: keine Session-IDs, keine Durable Objects, kein Server-State zwischen
 * Requests. Jeder POST /mcp trägt sein Bearer-Token, daraus fällt die Identität — mehr Kontext
 * braucht der Server nicht.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";

export const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Alles, was ein Tool-Handler braucht. */
export interface Kontext {
  env: Env;
  nutzer: Nutzer;
  origin: string;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
  handler: (args: Record<string, any>, ctx: Kontext) => Promise<unknown>;
}

/**
 * Ein Prompt ist ein fertiger Gesprächsanfang, den der Client als Befehl anbietet — in Claude
 * taucht er als Schrägstrich-Befehl auf. Er nimmt dem Menschen das Formulieren ab: statt „nimm
 * eine Wartung auf, das Objekt ist …" reicht ein Klick und ein Objektname.
 */
export interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
  /** Baut die Nachrichten, mit denen das Gespräch beginnt. */
  bauen: (args: Record<string, string>, ctx: Kontext) => Promise<string> | string;
}

/**
 * Eine Ressource ist Wissen zum Nachschlagen, das der Client von sich aus anhängen kann —
 * ohne dass ein Tool-Aufruf im Gespräch auftaucht. Hier: die Prüfpunkte der Vorlagen, die
 * Anleitung für den Bauplan-Import und das aktuelle Lagebild.
 */
export interface RessourceDef {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  lesen: (ctx: Kontext) => Promise<string> | string;
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

const result = (id: any, res: unknown) => ({ jsonrpc: "2.0" as const, id, result: res });
const rpcError = (id: any, code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message },
});

export function toolKatalog(tools: ToolDef[]) {
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  }));
}

export interface ServerInfo {
  name: string;
  title: string;
  version: string;
  websiteUrl: string;
}

export async function handleRpc(
  body: unknown,
  ctx: Kontext,
  tools: ToolDef[],
  serverInfo: ServerInfo,
  instructions: string,
  prompts: PromptDef[] = [],
  ressourcen: RessourceDef[] = [],
): Promise<unknown | null> {
  if (Array.isArray(body)) {
    return rpcError(null, -32600, "JSON-RPC-Batches werden von MCP nicht mehr unterstützt.");
  }
  const req = body as RpcRequest;
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return rpcError((req as any)?.id, -32600, "Kein gültiger JSON-RPC-2.0-Request.");
  }
  const isNotification = req.id === undefined || req.id === null;

  switch (req.method) {
    case "initialize": {
      const wanted = req.params?.protocolVersion;
      return result(req.id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(wanted) ? wanted : PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          ...serverInfo,
          icons: [
            { src: `${ctx.origin}/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] },
          ],
        },
        instructions,
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/progress":
      return null;

    case "ping":
      return result(req.id, {});

    case "tools/list":
      return result(req.id, { tools: toolKatalog(tools) });

    case "resources/list":
      return result(req.id, {
        resources: ressourcen.map((r) => ({
          uri: r.uri,
          name: r.name,
          title: r.title,
          description: r.description,
          mimeType: r.mimeType,
        })),
      });

    case "resources/templates/list":
      return result(req.id, { resourceTemplates: [] });

    case "resources/read": {
      const uri = String(req.params?.uri ?? "");
      const r = ressourcen.find((x) => x.uri === uri);
      if (!r) return rpcError(req.id, -32602, `Unbekannte Ressource '${uri}'.`);
      try {
        return result(req.id, {
          contents: [{ uri: r.uri, mimeType: r.mimeType, text: await r.lesen(ctx) }],
        });
      } catch (e) {
        return rpcError(req.id, -32603, (e as Error).message);
      }
    }

    case "prompts/list":
      return result(req.id, {
        prompts: prompts.map((p) => ({
          name: p.name,
          title: p.title,
          description: p.description,
          arguments: p.arguments ?? [],
        })),
      });

    case "prompts/get": {
      const name = String(req.params?.name ?? "");
      const prompt = prompts.find((p) => p.name === name);
      if (!prompt) return rpcError(req.id, -32602, `Unbekannter Prompt '${name}'.`);
      const fehlend = (prompt.arguments ?? [])
        .filter((a) => a.required && !String(req.params?.arguments?.[a.name] ?? "").trim())
        .map((a) => a.name);
      if (fehlend.length) {
        return rpcError(req.id, -32602, `Pflichtargument fehlt: ${fehlend.join(", ")}.`);
      }
      try {
        const text = await prompt.bauen(req.params?.arguments ?? {}, ctx);
        return result(req.id, {
          description: prompt.description,
          messages: [{ role: "user", content: { type: "text", text } }],
        });
      } catch (e) {
        return rpcError(req.id, -32603, (e as Error).message);
      }
    }

    case "tools/call": {
      const name = req.params?.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return rpcError(req.id, -32602, `Unbekanntes Tool '${name}'.`);
      try {
        const daten = await tool.handler(req.params?.arguments ?? {}, ctx);
        return result(req.id, {
          content: [{ type: "text", text: JSON.stringify(daten, null, 2) }],
          isError: false,
        });
      } catch (e) {
        // Fachliche Fehler gehören als isError-Ergebnis ins Gespräch, nicht als Protokollfehler —
        // das Modell soll sie lesen und korrigieren können.
        const err = e as Error;
        return result(req.id, {
          content: [{ type: "text", text: `Fehler in ${name}: ${err.message}` }],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return null;
      return rpcError(req.id, -32601, `Methode '${req.method}' wird nicht unterstützt.`);
  }
}
