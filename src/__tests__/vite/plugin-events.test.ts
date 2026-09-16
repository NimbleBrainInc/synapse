import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type Mock, vi } from "vitest";

/**
 * The dev server's half of forwarding a server notification: a line the MCP
 * server writes to stdout reaches every preview page holding GET /__events
 * open. The spawned server is faked, so the test drives its stdout directly.
 */

type AnyFn = (...args: never[]) => unknown;

const fakeServer = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock("node:child_process", async (importOriginal) => {
  const { EventEmitter: Emitter } = await import("node:events");
  const actual = await importOriginal<typeof import("node:child_process")>();
  const spawn = () => {
    const proc = Object.assign(new Emitter(), {
      stdout: new Emitter(),
      stderr: new Emitter(),
      stdin: { writable: true, write: vi.fn() },
      kill: vi.fn(),
    });
    fakeServer.current = proc;
    return proc;
  };
  return { ...actual, default: { ...actual, spawn }, spawn };
});

import { synapseVite } from "../../vite/plugin";

function startPreview() {
  const dir = mkdtempSync(join(tmpdir(), "synapse-vite-"));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({ name: "demo", server: { mcp_config: { command: "node", args: ["s.js"] } } }),
  );

  const plugin = synapseVite({ manifest: manifestPath });
  (plugin.configResolved as AnyFn)({ root: dir } as never);

  let handler: AnyFn = () => undefined;
  (plugin.configureServer as AnyFn)({
    config: { root: dir, server: { port: 5173 } },
    middlewares: {
      use: (h: AnyFn) => {
        handler = h;
      },
    },
  } as never);

  const req = Object.assign(new EventEmitter(), { url: "/__events", method: "GET" });
  const res = { setHeader: vi.fn(), writeHead: vi.fn(), write: vi.fn() };
  (handler as (...a: unknown[]) => void)(req, res, vi.fn());

  const proc = fakeServer.current as { stdout: EventEmitter; stdin: { write: Mock } };
  const stdout = proc.stdout;
  const serverSays = (msg: unknown) => stdout.emit("data", Buffer.from(`${JSON.stringify(msg)}\n`));
  const frames = () =>
    res.write.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => s.startsWith("data: "))
      .map((s) => JSON.parse(s.slice("data: ".length)));

  /**
   * Drive `POST /__mcp` the way the preview page does: fire the request, let
   * the dev server write to the MCP server's stdin, then answer as the server
   * would so the proxy's pending promise resolves. Returns what the dev server
   * forwarded and what it handed back to the page.
   */
  async function postToMcp(body: unknown) {
    let payload: unknown;
    const mcpReq = {
      url: "/__mcp",
      method: "POST",
      on: (event: string, cb: (chunk?: Buffer) => void) => {
        if (event === "data") cb(Buffer.from(JSON.stringify(body)));
        if (event === "end") cb();
      },
    };
    const mcpRes = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      end: (p?: string) => {
        payload = p ? JSON.parse(p) : undefined;
      },
    };
    (handler as (...a: unknown[]) => void)(mcpReq, mcpRes, vi.fn());
    await Promise.resolve();

    const forwarded = proc.stdin.write.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .filter((m) => m.method !== "initialize");

    // Answer as the server, so the proxy resolves rather than timing out.
    for (const sent of forwarded) serverSays({ jsonrpc: "2.0", id: sent.id, result: { ok: true } });
    await Promise.resolve();

    return { forwarded, sent: forwarded[0], payload };
  }

  return { req, res, serverSays, frames, postToMcp, proc };
}

describe("GET /__events", () => {
  it("opens an event stream", () => {
    const { res } = startPreview();
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" }),
    );
  });

  it("forwards the server's resources/list_changed to the preview page", () => {
    const { serverSays, frames } = startPreview();
    serverSays({ jsonrpc: "2.0", method: "notifications/resources/list_changed" });
    expect(frames()).toEqual([{ method: "notifications/resources/list_changed", params: {} }]);
  });

  it("passes on nothing a host would not forward to a view", () => {
    const { serverSays, frames } = startPreview();
    serverSays({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } });
    serverSays({ jsonrpc: "2.0", id: "init-1", result: {} });
    expect(frames()).toEqual([]);
  });

  it("stops writing to a page that closed its stream", () => {
    const { req, res, serverSays } = startPreview();
    req.emit("close");
    res.write.mockClear();
    serverSays({ jsonrpc: "2.0", method: "notifications/resources/list_changed" });
    expect(res.write).not.toHaveBeenCalled();
  });
});

describe("POST /__mcp", () => {
  /**
   * The handshake announces `serverResources`, whose spec meaning is that the
   * host proxies resource reads. These are the answer behind that claim — a
   * host that announces a capability and then never replies leaves the app
   * waiting on its own request until the timeout.
   */
  it.each(["resources/read", "resources/list"])("proxies %s to the server", async (method) => {
    const { postToMcp } = startPreview();
    const { sent } = await postToMcp({ jsonrpc: "2.0", id: "1", method, params: { uri: "x://y" } });
    expect(sent).toMatchObject({ method, params: { uri: "x://y" } });
  });

  it("proxies tools/call with the call's own params", async () => {
    const { postToMcp } = startPreview();
    const { sent } = await postToMcp({
      jsonrpc: "2.0",
      id: "1",
      method: "tools/call",
      params: { name: "save", arguments: { a: 1 } },
    });
    expect(sent).toMatchObject({
      method: "tools/call",
      params: { name: "save", arguments: { a: 1 } },
    });
  });

  it("forwards nothing the handshake does not announce", async () => {
    const { postToMcp } = startPreview();
    const { forwarded, payload } = await postToMcp({
      jsonrpc: "2.0",
      id: "1",
      method: "resources/subscribe",
      params: {},
    });
    expect(forwarded).toEqual([]);
    expect(payload).toMatchObject({ error: { code: -32000 } });
  });
});
