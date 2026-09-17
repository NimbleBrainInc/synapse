import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * A small MCP server over Streamable HTTP whose every host-visible property
 * defaults to correct, so a test changes exactly the one it is about.
 */
export interface FixtureOptions {
  declareExtension?: boolean;
  /** MIME the UI resource is listed and served under. */
  mime?: string;
  /** The tool's `ui.resourceUri`; `null` omits it. */
  toolResourceUri?: string | null;
  /** The URI the UI resource is registered at. */
  resourceUri?: string;
  visibility?: unknown;
  /** Extra keys merged into the tool's `_meta.ui`. */
  toolUi?: Record<string, unknown>;
  /** Bind the tool only through the deprecated flat `ui/resourceUri` key. */
  legacyBinding?: boolean;
  /** Serve no UI at all: no resource, and no binding on the tool. */
  noUi?: boolean;
  /** The resource's `ui.csp`; `null` omits it. */
  csp?: McpUiResourceCsp | null;
  /**
   * The resource's `openai/widgetCSP`; `null` omits it. Defaults to `csp` in
   * ChatGPT's dialect, which is what an emitter deriving one from the other
   * produces.
   */
  openaiCsp?: Record<string, string[]> | null;
  html?: string;
  auth?: {
    token: string;
    /** The challenge names `resource_metadata`. Default true. */
    resourceMetadata?: boolean;
    /** The protected-resource metadata's `resource`, given the server's MCP URL. */
    resource?: (mcpUrl: string) => string;
    /** The advertised authorization server, given the fixture's origin. */
    advertisedIssuer?: (origin: string) => string;
    /** The `issuer` the authorization server metadata reports. */
    issuer?: (origin: string) => string;
    securitySchemes?: boolean;
    /** Where `securitySchemes` is declared on the tool. Default `"meta"`. */
    securitySchemesAt?: "meta" | "tool";
    /** The metadata lists an authorization server. Default true. */
    authorizationServers?: boolean;
  };
}

export interface Fixture {
  url: string;
  close: () => Promise<void>;
}

const UI_URI = "ui://fixture/view";
const PRM_PATH = "/.well-known/oauth-protected-resource/mcp";
const AS_PATH = "/.well-known/oauth-authorization-server";

/** The same origins in ChatGPT's dialect: a sibling of `ui`, snake_case keys. */
function toOpenAiCsp(csp: McpUiResourceCsp | null): Record<string, string[]> | null {
  return csp === null
    ? null
    : { connect_domains: csp.connectDomains ?? [], resource_domains: csp.resourceDomains ?? [] };
}

export async function startFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const {
    declareExtension = true,
    mime = RESOURCE_MIME_TYPE,
    resourceUri = UI_URI,
    csp = { connectDomains: [], resourceDomains: ["https://cdn.example.com"] },
    html = "<!doctype html><html><body>fixture</body></html>",
    auth,
  } = options;
  const toolResourceUri = options.toolResourceUri === undefined ? UI_URI : options.toolResourceUri;

  let origin = "";
  const http: Server = createServer(async (req, res) => {
    const mcpUrl = `${origin}/mcp`;
    const path = new URL(req.url ?? "/", origin).pathname;

    if (auth && path === PRM_PATH) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          resource: auth.resource ? auth.resource(mcpUrl) : mcpUrl,
          ...(auth.authorizationServers !== false && {
            authorization_servers: [auth.advertisedIssuer ? auth.advertisedIssuer(origin) : origin],
          }),
        }),
      );
      return;
    }
    if (auth && path === AS_PATH) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          issuer: auth.issuer ? auth.issuer(origin) : origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          response_types_supported: ["code"],
        }),
      );
      return;
    }
    if (path !== "/mcp") {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (auth && req.headers.authorization !== `Bearer ${auth.token}`) {
      res.statusCode = 401;
      res.setHeader(
        "WWW-Authenticate",
        auth.resourceMetadata === false
          ? 'Bearer error="invalid_token"'
          : `Bearer resource_metadata="${origin}${PRM_PATH}"`,
      );
      res.end();
      return;
    }

    const server = new McpServer(
      { name: "fixture", version: "1.0.0" },
      { capabilities: declareExtension ? { extensions: { [EXTENSION_ID]: {} } } : {} },
    );
    const ui: Record<string, unknown> = { ...options.toolUi };
    if (toolResourceUri !== null && !options.legacyBinding && !options.noUi) {
      ui.resourceUri = toolResourceUri;
    }
    if (options.visibility !== undefined) ui.visibility = options.visibility;
    const toolMeta: Record<string, unknown> = { ui };
    if (options.legacyBinding) toolMeta["ui/resourceUri"] = UI_URI;
    const schemes = [{ type: "oauth2", scopes: [] }];
    const schemesAt = auth?.securitySchemesAt ?? "meta";
    if (auth && auth.securitySchemes !== false && schemesAt === "meta") {
      toolMeta.securitySchemes = schemes;
    }
    server.registerTool("show", { description: "Show the view", _meta: toolMeta }, async () => ({
      content: [{ type: "text", text: "shown" }],
    }));
    if (auth && auth.securitySchemes !== false && schemesAt === "tool") {
      // `McpServer` builds the descriptor from fixed fields, so a top-level
      // `securitySchemes` has to come from a raw handler.
      server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "show",
            description: "Show the view",
            inputSchema: { type: "object" as const },
            _meta: toolMeta,
            securitySchemes: schemes,
          },
        ],
      }));
    }
    if (!options.noUi) {
      const resourceMeta: Record<string, unknown> = {};
      if (csp !== null) resourceMeta.ui = { csp };
      const openaiCsp = options.openaiCsp === undefined ? toOpenAiCsp(csp) : options.openaiCsp;
      if (openaiCsp !== null) resourceMeta["openai/widgetCSP"] = openaiCsp;
      server.registerResource(
        "view",
        resourceUri,
        { mimeType: mime, _meta: resourceMeta },
        async (uri) => ({
          contents: [{ uri: uri.href, mimeType: mime, text: html, _meta: resourceMeta }],
        }),
      );
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return {
    url: `${origin}/mcp`,
    close: () =>
      new Promise((resolve, reject) => {
        http.closeAllConnections();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
