import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

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
  /** The resource's `ui.csp`; `null` omits it. */
  csp?: McpUiResourceCsp | null;
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
  };
}

export interface Fixture {
  url: string;
  close: () => Promise<void>;
}

const UI_URI = "ui://fixture/view";
const PRM_PATH = "/.well-known/oauth-protected-resource/mcp";
const AS_PATH = "/.well-known/oauth-authorization-server";

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
          authorization_servers: [auth.advertisedIssuer ? auth.advertisedIssuer(origin) : origin],
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
    const ui: Record<string, unknown> = {};
    if (toolResourceUri !== null) ui.resourceUri = toolResourceUri;
    if (options.visibility !== undefined) ui.visibility = options.visibility;
    const toolMeta: Record<string, unknown> = { ui };
    if (auth?.securitySchemes !== false && auth) {
      toolMeta.securitySchemes = [{ type: "oauth2", scopes: [] }];
    }
    server.registerTool("show", { description: "Show the view", _meta: toolMeta }, async () => ({
      content: [{ type: "text", text: "shown" }],
    }));
    const resourceMeta = csp === null ? {} : { ui: { csp } };
    server.registerResource(
      "view",
      resourceUri,
      { mimeType: mime, _meta: resourceMeta },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: mime, text: html, _meta: resourceMeta }],
      }),
    );

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
