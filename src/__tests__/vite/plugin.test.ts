import { describe, expect, it, vi } from "vitest";

/** Generic callable — used to cast Vite plugin hooks in tests. */
type AnyFn = (...args: never[]) => unknown;

/**
 * Tests for the Vite plugin's pure logic.
 *
 * We can't easily test the full Vite dev server integration, but we CAN test:
 * 1. Preview HTML generation (ID preservation, handshake, theme)
 * 2. Manifest reading and server command derivation
 *
 * We import the plugin and call its hooks with mocked Vite objects.
 */

// The page builder is exported as `vitePreviewHostHtml` for the conformance
// suite, but these rows drive it the way the dev server does — through
// `configureServer`, so the middleware's routing is under test as well.

import { synapseVite } from "../../vite/plugin";

describe("synapseVite plugin", () => {
  it("returns a plugin with name 'synapse'", () => {
    const plugin = synapseVite({ appName: "test-app" });
    expect(plugin.name).toBe("synapse");
  });

  it("config() sets HMR to ws/localhost for iframe compat", () => {
    const plugin = synapseVite({ appName: "test-app" });
    const config = (plugin.config as AnyFn)({}, { command: "serve" });
    expect(config.server.hmr.protocol).toBe("ws");
    expect(config.server.hmr.host).toBe("localhost");
  });

  it("config() defines SYNAPSE_APP_NAME", () => {
    const plugin = synapseVite({ appName: "my-app" });
    const config = (plugin.config as AnyFn)({}, { command: "serve" });
    expect(config.define["import.meta.env.SYNAPSE_APP_NAME"]).toBe('"my-app"');
  });
});

describe("preview host HTML", () => {
  // Extract the HTML from the middleware by calling configureServer with a mock

  function getPreviewHtml(appName: string): string {
    const plugin = synapseVite({ appName, preview: true });
    let capturedHtml = "";

    // Mock ViteDevServer
    const mockServer = {
      config: { root: "/tmp/test", server: { port: 5173 } },
      middlewares: {
        use: (handler: AnyFn) => {
          // Simulate a request to /__preview
          const req = { url: "/__preview", method: "GET" } as any;
          const res = {
            setHeader: vi.fn(),
            writeHead: vi.fn(),
            end: (html: string) => {
              capturedHtml = html;
            },
          } as any;
          const next = vi.fn();
          handler(req, res, next);
        },
      },
    };

    (plugin.configureServer as AnyFn)(mockServer);
    return capturedHtml;
  }

  it("includes the app name in the title", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain("<title>hello — Synapse Preview</title>");
  });

  it("sets iframe src after message listener to avoid race", () => {
    const html = getPreviewHtml("hello");
    // The iframe element must NOT have an inline src
    expect(html).toContain('<iframe id="app"></iframe>');
    // src is set at the end of the script block, after addEventListener
    const listenerIdx = html.indexOf("addEventListener");
    const srcIdx = html.indexOf('iframe.src = "/"');
    expect(listenerIdx).toBeGreaterThan(-1);
    expect(srcIdx).toBeGreaterThan(listenerIdx);
    // No hardcoded ports
    expect(html).not.toContain("localhost:5173");
    expect(html).not.toContain("localhost:5174");
  });

  it("identifies as nimblebrain in the handshake", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain('name:"nimblebrain"');
  });

  it("preserves original request ID in tool call proxy", () => {
    const html = getPreviewHtml("hello");
    // The critical fix: originalId is captured before fetch, then set on response
    expect(html).toContain("var originalId = msg.id");
    expect(html).toContain("response.id = originalId");
  });

  it("uses relative /__mcp URL for tool call proxy", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain('fetch("/__mcp"');
  });

  it("proxies every method the handshake announces, not just tools/call", () => {
    const html = getPreviewHtml("hello");
    // The page's allowlist is the dev server's, serialized, so the two cannot
    // drift apart. The dev server's own rows cannot see this half: `/__mcp` can
    // forward a method correctly while the page never sends it there, leaving a
    // capability the handshake announces with nothing behind it.
    expect(html).toContain('var PROXIED = ["tools/call","resources/read","resources/list"]');
    expect(html).toContain("PROXIED.indexOf(msg.method) !== -1");
  });

  it("includes theme toggle that emits spec-compliant host-context-changed", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain("Toggle Theme");
    // Per ext-apps spec (and hard rule #5 in CLAUDE.md): theme changes are
    // broadcast via ui/notifications/host-context-changed, tokens under
    // styles.variables — NOT the legacy synapse/theme-changed with params.tokens.
    expect(html).toContain("ui/notifications/host-context-changed");
    expect(html).not.toContain("synapse/theme-changed");
  });

  it("answers the handshake in the spec's field names, and treats id 0 as an id", () => {
    // The conformance suite drives this host with the spec's own client, which
    // is the stronger check — but it is a separate CI job and not part of
    // `npm run ci`, so the fast suite holds the same two invariants.
    const html = getPreviewHtml("hello");
    expect(html).toContain("hostInfo:");
    expect(html).toContain("hostCapabilities:");
    expect(html).not.toContain("serverInfo:");
    // `msg.id` is falsy at 0, and the MCP SDK numbers requests from zero — so
    // a truthiness gate drops every spec client's `ui/initialize`.
    expect(html).not.toContain('=== "ui/initialize" && msg.id');
    expect(html).toContain("function isRequest(msg)");
  });

  it("declares the capabilities it answers, since every call is gated on them", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain("updateModelContext:");
    expect(html).toContain('"ai.nimblebrain/action"');
    expect(html).toContain('"ai.nimblebrain/keydown"');
  });

  it("publishes only style variables the spec's enum names", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain("--color-background-primary");
    expect(html).toContain("--color-text-primary");
    // Tokens must be nested under styles.variables in hostContext, not at
    // hostContext.tokens (spec requirement; SDK reads from styles.variables).
    expect(html).toContain("styles:{variables:getTokens");

    // `styles.variables` is a **strict record** over a fixed enum of names, so
    // one key outside it makes a spec client reject the entire `ui/initialize`
    // result rather than ignore the key — the host then renders nothing at all.
    // These three are the kit's own tokens, which the enum does not name; the
    // kit's neutral defaults supply them, so nothing is lost by leaving them
    // off the wire.
    for (const nonSpec of [
      "--color-text-accent",
      "--nb-color-accent-foreground",
      "--nb-color-danger",
    ]) {
      expect(html).not.toContain(nonSpec);
    }
  });

  it("handles ui/update-model-context per ext-apps spec", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain("ui/update-model-context");
  });

  it("spells no data-change method of its own", () => {
    // A change is the server's to announce, and the page forwards it under the
    // method the server sent. One the page spelled itself would be the page
    // deciding data changed — and fired on the app's own tool call it loops:
    // the call fires it, useDataSync re-fetches, the re-fetch fires it again.
    const html = getPreviewHtml("hello");
    expect(html).toContain('fetch("/__mcp"');
    expect(html).not.toContain("synapse/data-changed");
    expect(html).not.toContain("resources/list_changed");
  });

  it("posts the server's notifications from /__events into the app", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain('new EventSource("/__events")');
    // The capability that says a host forwards a server's notifications to its
    // views. The page does forward, so the handshake has to say so.
    expect(html).toContain("serverResources:{listChanged:true}");
    // Forwarded under the method the server sent, not one the page spells.
    expect(html).toContain("method:n.method,params:n.params");
  });
});

describe("manifest reading", () => {
  it("reads appName from manifest when not specified", () => {
    // We test this indirectly: create plugin without appName,
    // call configResolved with a mock that has a manifest nearby.
    // Since we can't easily create temp files in vitest, we test
    // that the default appName is "app" when no manifest exists.
    const plugin = synapseVite();
    const configResolved = plugin.configResolved as AnyFn;
    configResolved({ root: "/nonexistent/path" });
    // appName stays "app" since no manifest found
    const config = (plugin.config as AnyFn)({}, { command: "serve" });
    expect(config.define["import.meta.env.SYNAPSE_APP_NAME"]).toBe('"app"');
  });

  it("uses explicit appName over manifest", () => {
    const plugin = synapseVite({ appName: "override" });
    const configResolved = plugin.configResolved as AnyFn;
    configResolved({ root: "/nonexistent/path" });
    const config = (plugin.config as AnyFn)({}, { command: "serve" });
    expect(config.define["import.meta.env.SYNAPSE_APP_NAME"]).toBe('"override"');
  });
});

describe("__mcp middleware", () => {
  it("responds to POST /__mcp", () => {
    const plugin = synapseVite({ appName: "test", preview: true });
    let mcpHandled = false;

    const mockServer = {
      config: { root: "/tmp/test", server: { port: 5173 } },
      middlewares: {
        use: (handler: AnyFn) => {
          const req = {
            url: "/__mcp",
            method: "POST",
            on: (event: string, cb: AnyFn) => {
              if (event === "data")
                cb(
                  Buffer.from(
                    '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"test","arguments":{}}}',
                  ),
                );
              if (event === "end") {
                mcpHandled = true;
                cb();
              }
            },
          } as any;
          const res = {
            setHeader: vi.fn(),
            writeHead: vi.fn(),
            end: vi.fn(),
          } as any;
          const next = vi.fn();
          handler(req, res, next);
        },
      },
    };

    (plugin.configureServer as AnyFn)(mockServer);
    expect(mcpHandled).toBe(true);
  });

  it("passes through non-preview/mcp requests", () => {
    const plugin = synapseVite({ appName: "test" });
    let nextCalled = false;

    const mockServer = {
      config: { root: "/tmp/test", server: { port: 5173 } },
      middlewares: {
        use: (handler: AnyFn) => {
          const req = { url: "/some-other-path", method: "GET" } as any;
          const res = { setHeader: vi.fn() } as any;
          const next = () => {
            nextCalled = true;
          };
          handler(req, res, next);
        },
      },
    };

    (plugin.configureServer as AnyFn)(mockServer);
    expect(nextCalled).toBe(true);
  });
});
