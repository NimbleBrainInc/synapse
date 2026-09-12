import { describe, expect, it } from "vitest";

import { previewHostHtml } from "../../preview/server";

/**
 * The bridge host page `synapse preview` serves.
 *
 * The conformance suite drives this page with the spec's own `App`, which is
 * the stronger check — it validates the whole `ui/initialize` result rather
 * than grepping for a field name. But it is a separate CI job and not part of
 * `npm run ci`, so the fast suite holds the invariants a revert would break.
 *
 * This package ships two hand-written hosts and they answer the same
 * handshake, so these mirror the rows in `../vite/plugin.test.ts`. One host
 * guarded and the other not is how the two drifted apart in the first place.
 */
describe("preview host HTML", () => {
  const html = previewHostHtml(5173, 8001);

  it("answers the handshake in the spec's field names", () => {
    expect(html).toContain("hostInfo:");
    expect(html).toContain("hostCapabilities:");
    // A spec client validates the result and refuses a reply that is merely
    // close, so the pre-standard spelling locks an `App`-based app out.
    expect(html).not.toContain("serverInfo:");
  });

  it("treats a request id of 0 as an id", () => {
    // `msg.id` is falsy at 0, and the MCP SDK numbers requests from zero — so
    // a truthiness gate drops every spec client's `ui/initialize`.
    expect(html).toContain("function isRequest(msg)");
    expect(html).not.toContain('=== "ui/initialize" && msg.id');
    expect(html).not.toContain('=== "tools/call" && msg.id');
  });

  it("publishes only style variables the spec's enum names", () => {
    expect(html).toContain("--color-background-primary");
    expect(html).toContain("--color-text-primary");
    expect(html).toContain("styles: { variables: tokens }");

    // `styles.variables` is a strict record over a fixed enum of names, so one
    // key outside it makes a spec client reject the entire result rather than
    // ignore the key — the host then renders nothing at all. These three are
    // the kit's own tokens, which the enum does not name; the kit's neutral
    // defaults supply them, so nothing is lost by leaving them off the wire.
    for (const nonSpec of [
      "--color-text-accent",
      "--nb-color-accent-foreground",
      "--nb-color-danger",
    ]) {
      expect(html).not.toContain(nonSpec);
    }
  });

  it("frames the UI port it is given and proxies tool calls to the server port", () => {
    expect(html).toContain('src="http://localhost:5173"');
    expect(html).toContain('fetch("http://localhost:8001/mcp"');
  });
});
