// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import {
  applyProfiles,
  type CheckId,
  type CheckResult,
  formatReport,
  runChecks,
} from "../../check/index";
import { type Fixture, type FixtureOptions, startFixture } from "./fixture-server";

/**
 * `synapse check` against in-process servers. Each fixture is correct except
 * for the one property its test is about, so a failure names that property.
 */

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

async function check(options: FixtureOptions, token?: string): Promise<CheckResult[]> {
  fixture = await startFixture(options);
  return runChecks(fixture.url, { token });
}

function status(results: CheckResult[], id: CheckId): string {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`no result for ${id}`);
  return r.status;
}

function detail(results: CheckResult[], id: CheckId): string {
  return results.find((x) => x.id === id)?.detail ?? "";
}

function failures(results: CheckResult[]): CheckId[] {
  return results.filter((r) => r.status === "fail").map((r) => r.id);
}

const AUTH = { token: "secret" };

describe("synapse check", () => {
  it("passes a correct server with no auth, for every target", async () => {
    const results = await check({});
    expect(failures(results)).toEqual([]);
    expect(status(results, "auth-challenge")).toBe("skip");
    expect(status(results, "tool-security-schemes")).toBe("skip");
    const reports = applyProfiles(results, ["nimblebrain", "claude", "chatgpt"]);
    expect(reports.map((r) => r.failed)).toEqual([false, false, false]);
  });

  it("passes a correct server with auth, given a token", async () => {
    const results = await check({ auth: AUTH }, AUTH.token);
    expect(failures(results)).toEqual([]);
    expect(status(results, "auth-issuer")).toBe("pass");
    expect(status(results, "tool-security-schemes")).toBe("pass");
  });

  it("skips session checks when auth is required and no token is given", async () => {
    const results = await check({ auth: AUTH });
    expect(status(results, "auth-challenge")).toBe("pass");
    expect(status(results, "ui-resource-mime")).toBe("skip");
    expect(failures(results)).toEqual([]);
  });

  it("refuses to report on a server it cannot reach", async () => {
    await expect(runChecks("http://127.0.0.1:9/mcp")).rejects.toThrow(/could not connect/);
  });

  it("refuses to report when the given token is rejected", async () => {
    fixture = await startFixture({ auth: AUTH });
    await expect(runChecks(fixture.url, { token: "wrong" })).rejects.toThrow(
      /with the given token/,
    );
  });

  it("fails a UI resource served under another MIME type", async () => {
    const results = await check({ mime: "text/html+skybridge" });
    expect(failures(results)).toEqual(["ui-resource-mime"]);
  });

  it("fails a server that does not declare the MCP Apps extension", async () => {
    const results = await check({ declareExtension: false });
    expect(failures(results)).toEqual(["extension-declared"]);
    // A risk for the NimbleBrain host, a break for the public stores.
    const [nimblebrain, claude] = applyProfiles(results, ["nimblebrain", "claude"]);
    expect(nimblebrain.failed).toBe(false);
    expect(claude.failed).toBe(true);
  });

  it("fails when no tool binds the UI through ui.resourceUri", async () => {
    const results = await check({ toolResourceUri: null });
    expect(failures(results)).toEqual(["tool-resource-uri"]);
  });

  it("fails a ui.resourceUri that names a resource the server does not serve", async () => {
    const results = await check({ toolResourceUri: "ui://fixture/missing" });
    expect(failures(results)).toContain("tool-resource-uri");
    expect(detail(results, "tool-resource-uri")).toMatch(/ui:\/\/fixture\/missing cannot be read/);
  });

  it("fails a malformed ui.visibility", async () => {
    const results = await check({ visibility: ["everyone"] });
    expect(failures(results)).toEqual(["tool-ui-meta"]);
  });

  it("fails a UI resource with no ui.csp", async () => {
    const results = await check({ csp: null });
    expect(failures(results)).toEqual(["resource-csp"]);
    const [claude, chatgpt] = applyProfiles(results, ["claude", "chatgpt"]);
    expect(claude.failed).toBe(false);
    expect(chatgpt.failed).toBe(true);
  });

  it("fails a data: font the security policy does not declare", async () => {
    const html =
      "<style>@font-face{font-family:F;src:url(data:font/woff2;base64,AAAA)}</style><p>x</p>";
    const results = await check({ html });
    expect(failures(results)).toEqual(["resource-data-fonts"]);
    expect(applyProfiles(results, ["claude"])[0].failed).toBe(true);
  });

  it("passes a data: font the security policy declares", async () => {
    const html = "<style>@font-face{font-family:F;src:url(data:font/woff2;base64,AAAA)}</style>";
    const results = await check({ html, csp: { resourceDomains: ["data:"] } });
    expect(failures(results)).toEqual([]);
  });

  it("fails a 401 whose challenge carries no resource_metadata", async () => {
    const results = await check({ auth: { ...AUTH, resourceMetadata: false } });
    expect(failures(results)).toEqual(["auth-challenge"]);
  });

  it("fails protected-resource metadata whose resource is not the server URL", async () => {
    const results = await check({ auth: { ...AUTH, resource: (url) => `${url}/` } });
    expect(failures(results)).toEqual(["auth-resource-metadata"]);
    expect(detail(results, "auth-resource-metadata")).toMatch(/^resource is /);
  });

  it("fails an advertised authorization server that differs from its issuer by a trailing slash", async () => {
    const results = await check({
      auth: { ...AUTH, advertisedIssuer: (origin) => `${origin}/` },
    });
    expect(failures(results)).toEqual(["auth-issuer"]);
    expect(detail(results, "auth-issuer")).toMatch(
      /^issuer is "http:\/\/127\.0\.0\.1:\d+", advertised as/,
    );
    // Claude has been seen to accept this; ChatGPT is held to the RFC.
    const [claude, chatgpt] = applyProfiles(results, ["claude", "chatgpt"]);
    expect(claude.failed).toBe(false);
    expect(chatgpt.failed).toBe(true);
  });

  it("fails tools without securitySchemes on a server that requires auth", async () => {
    const results = await check({ auth: { ...AUTH, securitySchemes: false } }, AUTH.token);
    expect(failures(results)).toEqual(["tool-security-schemes"]);
  });

  it("passes securitySchemes declared at the tool's top level", async () => {
    const results = await check({ auth: { ...AUTH, securitySchemesAt: "tool" } }, AUTH.token);
    expect(status(results, "tool-security-schemes")).toBe("pass");
  });

  it("fails a tool bound only through the deprecated flat key", async () => {
    const results = await check({ legacyBinding: true });
    expect(status(results, "tool-resource-uri")).toBe("fail");
    expect(detail(results, "tool-resource-uri")).toMatch(/deprecated flat key/);
  });

  it("skips the UI checks on a server that exposes no UI", async () => {
    const results = await check({ noUi: true });
    expect(failures(results)).toEqual([]);
    expect(status(results, "ui-resource-mime")).toBe("skip");
    expect(detail(results, "ui-resource-mime")).toMatch(/exposes no UI/);
  });

  it.each(["csp", "permissions"])("fails ui.%s set on a tool", async (key) => {
    const results = await check({ toolUi: { [key]: {} } });
    expect(status(results, "tool-ui-meta")).toBe("fail");
    expect(detail(results, "tool-ui-meta")).toMatch(new RegExp(`ui\\.${key} is on the tool`));
  });

  it("fails protected-resource metadata that lists no authorization server", async () => {
    const results = await check({ auth: { ...AUTH, authorizationServers: false } });
    expect(status(results, "auth-issuer")).toBe("fail");
    expect(detail(results, "auth-issuer")).toMatch(/no authorization_servers/);
  });

  it("reports one line per check for each target, with the reason under a failure", async () => {
    const results = await check({ mime: "text/html" });
    const text = formatReport(fixture?.url ?? "", applyProfiles(results, ["claude"]));
    expect(text).toMatch(/claude: FAIL/);
    expect(text).toMatch(/FAIL\s+ui-resource-mime\s+ui:\/\/fixture\/view/);
    expect(text).toMatch(/SKIP\s+auth-challenge/);
  });
});
