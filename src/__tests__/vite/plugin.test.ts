import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the Vite plugin's pure logic.
 *
 * We can't easily test the full Vite dev server integration, but we CAN test:
 * 1. Preview HTML generation (ID preservation, handshake, theme)
 * 2. Manifest reading and server command derivation
 *
 * We import the plugin and call its hooks with mocked Vite objects.
 */

// We need to test the previewHostHtml output and the configureServer middleware.
// Since previewHostHtml is not exported, we test it indirectly through the plugin.

import { synapseVite } from "../../vite/plugin";

describe("synapseVite plugin", () => {
  it("returns a plugin with name 'synapse'", () => {
    const plugin = synapseVite({ appName: "test-app" });
    expect(plugin.name).toBe("synapse");
  });

  it("config() sets HMR to ws/localhost for iframe compat", () => {
    const plugin = synapseVite({ appName: "test-app" });
    const config = (plugin.config as Function)({}, { command: "serve" });
    expect(config.server.hmr.protocol).toBe("ws");
    expect(config.server.hmr.host).toBe("localhost");
  });

  it("config() defines SYNAPSE_APP_NAME", () => {
    const plugin = synapseVite({ appName: "my-app" });
    const config = (plugin.config as Function)({}, { command: "serve" });
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
        use: (handler: Function) => {
          // Simulate a request to /__preview
          const req = { url: "/__preview", method: "GET" } as any;
          const res = {
            setHeader: vi.fn(),
            writeHead: vi.fn(),
            end: (html: string) => { capturedHtml = html; },
          } as any;
          const next = vi.fn();
          handler(req, res, next);
        },
      },
    };

    (plugin.configureServer as Function)(mockServer);
    return capturedHtml;
  }

  it("includes the app name in the title", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain("<title>hello — Synapse Preview</title>");
  });

  it("uses relative iframe src (no hardcoded port)", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain('src="/"');
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

  it("includes theme toggle", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain("Toggle Theme");
    expect(html).toContain("ui/themeChanged");
  });

  it("includes NB theme tokens", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain("--nb-primary");
    expect(html).toContain("--nb-background");
    expect(html).toContain("--nb-foreground");
  });

  it("handles ui/stateChanged with acknowledgement", () => {
    const html = getPreviewHtml("hello");
    expect(html).toContain("ui/stateChanged");
    expect(html).toContain("ui/stateAcknowledged");
  });
});

describe("manifest reading", () => {
  it("reads appName from manifest when not specified", () => {
    // We test this indirectly: create plugin without appName,
    // call configResolved with a mock that has a manifest nearby.
    // Since we can't easily create temp files in vitest, we test
    // that the default appName is "app" when no manifest exists.
    const plugin = synapseVite();
    const configResolved = plugin.configResolved as Function;
    configResolved({ root: "/nonexistent/path" });
    // appName stays "app" since no manifest found
    const config = (plugin.config as Function)({}, { command: "serve" });
    expect(config.define["import.meta.env.SYNAPSE_APP_NAME"]).toBe('"app"');
  });

  it("uses explicit appName over manifest", () => {
    const plugin = synapseVite({ appName: "override" });
    const configResolved = plugin.configResolved as Function;
    configResolved({ root: "/nonexistent/path" });
    const config = (plugin.config as Function)({}, { command: "serve" });
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
        use: (handler: Function) => {
          const req = {
            url: "/__mcp",
            method: "POST",
            on: (event: string, cb: Function) => {
              if (event === "data") cb(Buffer.from('{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"test","arguments":{}}}'));
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

    (plugin.configureServer as Function)(mockServer);
    expect(mcpHandled).toBe(true);
  });

  it("passes through non-preview/mcp requests", () => {
    const plugin = synapseVite({ appName: "test" });
    let nextCalled = false;

    const mockServer = {
      config: { root: "/tmp/test", server: { port: 5173 } },
      middlewares: {
        use: (handler: Function) => {
          const req = { url: "/some-other-path", method: "GET" } as any;
          const res = { setHeader: vi.fn() } as any;
          const next = () => { nextCalled = true; };
          handler(req, res, next);
        },
      },
    };

    (plugin.configureServer as Function)(mockServer);
    expect(nextCalled).toBe(true);
  });
});
