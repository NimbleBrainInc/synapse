import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

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

  const stdout = (fakeServer.current as { stdout: EventEmitter }).stdout;
  const serverSays = (msg: unknown) => stdout.emit("data", Buffer.from(`${JSON.stringify(msg)}\n`));
  const frames = () =>
    res.write.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => s.startsWith("data: "))
      .map((s) => JSON.parse(s.slice("data: ".length)));

  return { req, res, serverSays, frames };
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
