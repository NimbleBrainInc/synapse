/**
 * `synapse check` — verify, from outside, what a host sees of a running MCP
 * server: the UI resources and their metadata, the MCP Apps extension
 * declaration, and the OAuth discovery surface a host signs in through.
 *
 * Every check runs once against the server; each target's profile then decides
 * which results count and how hard (see `./profiles.ts`).
 */

import type {
  McpUiClientCapabilities,
  McpUiResourceMeta,
  McpUiToolMeta,
} from "@modelcontextprotocol/ext-apps";
import {
  EXTENSION_ID,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "@modelcontextprotocol/ext-apps/server";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  ReadResourceResult,
  Resource,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ListToolsResultSchema, ResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { type CheckId, PROFILES, type Severity, type TargetName } from "./profiles.js";

export { type CheckId, isTargetName, PROFILES, type Profile, type TargetName } from "./profiles.js";

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  detail: string;
}

export interface TargetReport {
  target: TargetName;
  results: Array<CheckResult & { severity: Severity; why: string }>;
  /** True when any `error`-severity check failed. */
  failed: boolean;
}

export interface CheckOptions {
  /** Bearer token for a server that requires auth. Without one, checks that need a session are skipped. */
  token?: string;
}

const UI_SCHEME = "ui://";
const VISIBILITY = new Set(["model", "app"]);

type ResourceContents = ReadResourceResult["contents"][number];

interface Session {
  capabilities: ServerCapabilities | undefined;
  tools: Tool[];
  resources: Resource[];
  reads: Map<string, ResourceContents[] | Error>;
}

/** Run every check against `url` once. */
export async function runChecks(url: string, options: CheckOptions = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const add = (id: CheckId, status: CheckStatus, detail: string) =>
    results.push({ id, status, detail });

  // Connect without credentials first: the response to that is what a host
  // sees before sign-in, and it decides whether the server requires auth.
  let challenge: Response | undefined;
  let session: Session | undefined;
  let connectError: unknown;
  try {
    session = await openSession(url, undefined, (res) => {
      if (res.status === 401) challenge ??= res;
    });
  } catch (err) {
    connectError = err;
  }

  const authRequired = challenge !== undefined;
  if (authRequired && options.token) {
    try {
      session = await openSession(url, options.token);
      connectError = undefined;
    } catch (err) {
      connectError = err;
    }
  }

  // A server that cannot be reached is not a server that passes.
  if (!session && (!authRequired || options.token)) {
    throw new Error(
      `could not connect to ${url}${authRequired ? " with the given token" : ""}: ${message(connectError)}`,
    );
  }

  await checkAuth(url, challenge, add);

  if (!session) {
    for (const id of SESSION_CHECKS) {
      add(id, "skip", "the server requires auth; pass --token to run it");
    }
    return results;
  }

  checkSession(session, authRequired, add);
  return results;
}

/** Apply each target's profile to one set of results. */
export function applyProfiles(results: CheckResult[], targets: TargetName[]): TargetReport[] {
  return targets.map((target) => {
    const rules = PROFILES[target].rules;
    const scored = results.flatMap((r) => {
      const rule = rules[r.id];
      return rule ? [{ ...r, severity: rule.severity, why: rule.why }] : [];
    });
    return {
      target,
      results: scored,
      failed: scored.some((r) => r.status === "fail" && r.severity === "error"),
    };
  });
}

/** One line per check, grouped by target. */
export function formatReport(url: string, reports: TargetReport[]): string {
  const width = Math.max(...reports.flatMap((r) => r.results.map((c) => c.id.length)), 0);
  const lines = [`synapse check ${url}`];
  for (const report of reports) {
    lines.push("", `${report.target}: ${report.failed ? "FAIL" : "ok"}`);
    for (const r of report.results) {
      const label =
        r.status === "fail" ? (r.severity === "error" ? "FAIL" : "WARN") : r.status.toUpperCase();
      lines.push(`  ${label.padEnd(4)}  ${r.id.padEnd(width)}  ${r.detail}`);
      if (r.status === "fail") lines.push(`        ${"".padEnd(width)}  ${r.why}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------

const SESSION_CHECKS: CheckId[] = [
  "extension-declared",
  "ui-resource-mime",
  "tool-resource-uri",
  "tool-ui-meta",
  "resource-csp",
  "resource-openai-csp",
  "resource-data-fonts",
  "resource-openai-data-fonts",
  "tool-security-schemes",
];

async function openSession(
  url: string,
  token: string | undefined,
  onResponse?: (res: Response) => void,
): Promise<Session> {
  // Declare MCP Apps support, so a server that gates its UI on the client's
  // capability shows the UI a host would see.
  const ui: McpUiClientCapabilities = { mimeTypes: [RESOURCE_MIME_TYPE] };
  const client = new Client(
    { name: "synapse-check", version: "1" },
    { capabilities: { extensions: { [EXTENSION_ID]: ui } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    fetch: async (input, init) => {
      const res = await fetch(input, init);
      onResponse?.(res);
      return res;
    },
  });
  await client.connect(transport);
  try {
    const capabilities = client.getServerCapabilities();
    const tools: Tool[] = [];
    const resources: Resource[] = [];
    let cursor: string | undefined;
    if (capabilities?.tools) {
      do {
        // Requested raw rather than through `listTools()`: the SDK's tool schema
        // strips fields it does not model, and ChatGPT documents `securitySchemes`
        // at the tool's top level as well as in `_meta`. The one field is copied
        // back onto each parsed tool so `hasSecuritySchemes` can see either place.
        const raw = await client.request(
          { method: "tools/list", params: cursor ? { cursor } : {} },
          ResultSchema,
        );
        const page = ListToolsResultSchema.parse(raw);
        const rawTools = (raw as { tools?: Array<Record<string, unknown>> }).tools ?? [];
        page.tools.forEach((tool, i) => {
          const schemes = rawTools[i]?.securitySchemes;
          if (schemes !== undefined) (tool as Record<string, unknown>).securitySchemes = schemes;
        });
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
    }
    if (capabilities?.resources) {
      do {
        const page = await client.listResources({ cursor });
        resources.push(...page.resources);
        cursor = page.nextCursor;
      } while (cursor);
    }

    const uris = new Set(resources.map((r) => r.uri).filter((u) => u.startsWith(UI_SCHEME)));
    for (const tool of tools) {
      const uri = toolUi(tool)?.resourceUri;
      if (typeof uri === "string") uris.add(uri);
    }
    const reads = new Map<string, ResourceContents[] | Error>();
    for (const uri of uris) {
      try {
        reads.set(uri, (await client.readResource({ uri })).contents);
      } catch (err) {
        reads.set(uri, err instanceof Error ? err : new Error(String(err)));
      }
    }
    return { capabilities, tools, resources, reads };
  } finally {
    await client.close();
  }
}

function checkSession(
  s: Session,
  authRequired: boolean,
  add: (id: CheckId, status: CheckStatus, detail: string) => void,
): void {
  const boundTools = s.tools.filter((t) => toolUi(t)?.resourceUri !== undefined);
  const uiResources = s.resources.filter((r) => r.uri.startsWith(UI_SCHEME));
  const hasUi = boundTools.length > 0 || uiResources.length > 0 || s.tools.some(legacyBinding);

  if (!hasUi) {
    for (const id of SESSION_CHECKS) {
      if (id !== "tool-security-schemes") add(id, "skip", "the server exposes no UI");
    }
  } else {
    // extension-declared
    const declared = s.capabilities?.extensions?.[EXTENSION_ID] !== undefined;
    add(
      "extension-declared",
      declared ? "pass" : "fail",
      declared
        ? `${EXTENSION_ID} is declared`
        : `the server does not declare ${EXTENSION_ID} in capabilities.extensions`,
    );

    // ui-resource-mime: every ui:// resource, as listed and as read.
    const wrongMime: string[] = [];
    for (const r of uiResources) {
      if (r.mimeType !== undefined && r.mimeType !== RESOURCE_MIME_TYPE) {
        wrongMime.push(`${r.uri} is listed as ${r.mimeType}`);
      }
    }
    for (const [uri, contents] of s.reads) {
      if (contents instanceof Error) continue;
      for (const c of contents) {
        if (c.mimeType !== RESOURCE_MIME_TYPE) {
          wrongMime.push(`${uri} is served as ${c.mimeType ?? "no MIME type"}`);
        }
      }
    }
    add(
      "ui-resource-mime",
      wrongMime.length ? "fail" : "pass",
      wrongMime.length
        ? `${wrongMime.join("; ")}; expected ${RESOURCE_MIME_TYPE}`
        : `every ui:// resource is ${RESOURCE_MIME_TYPE}`,
    );

    // tool-resource-uri
    const unresolved: string[] = [];
    for (const tool of s.tools) {
      const uri = toolUi(tool)?.resourceUri;
      if (uri === undefined) {
        if (legacyBinding(tool)) {
          unresolved.push(`${tool.name} binds its UI only through the deprecated flat key`);
        }
        continue;
      }
      if (typeof uri !== "string" || !uri.startsWith(UI_SCHEME)) {
        unresolved.push(`${tool.name}: ui.resourceUri ${JSON.stringify(uri)} is not a ui:// URI`);
        continue;
      }
      const read = s.reads.get(uri);
      if (read instanceof Error || !read?.length) {
        unresolved.push(
          `${tool.name}: ${uri} cannot be read${read instanceof Error ? ` (${read.message})` : ""}`,
        );
      }
    }
    if (boundTools.length === 0 && unresolved.length === 0) {
      unresolved.push("no tool binds a UI through ui.resourceUri");
    }
    add(
      "tool-resource-uri",
      unresolved.length ? "fail" : "pass",
      unresolved.length
        ? unresolved.join("; ")
        : `${boundTools.length} tool(s) bind a UI that resolves`,
    );

    // tool-ui-meta
    const badMeta: string[] = [];
    for (const tool of s.tools) {
      const ui = toolUi(tool);
      if (!ui) continue;
      const vis = ui.visibility as unknown;
      if (
        vis !== undefined &&
        (!Array.isArray(vis) || vis.length === 0 || !vis.every((v) => VISIBILITY.has(v)))
      ) {
        badMeta.push(`${tool.name}: ui.visibility ${JSON.stringify(vis)}`);
      }
      for (const key of ["csp", "permissions"] as const) {
        if ((ui as Record<string, unknown>)[key] !== undefined) {
          badMeta.push(`${tool.name}: ui.${key} is on the tool, where hosts ignore it`);
        }
      }
    }
    add(
      "tool-ui-meta",
      badMeta.length ? "fail" : "pass",
      badMeta.length ? badMeta.join("; ") : "tool ui metadata is well-formed",
    );

    // The frame's security policy, in each dialect a host reads, per UI resource.
    const noCsp: string[] = [];
    const noOpenAiCsp: string[] = [];
    const dataFonts: string[] = [];
    const openAiDataFonts: string[] = [];
    for (const [uri, contents] of s.reads) {
      if (contents instanceof Error) continue;
      for (const c of contents) {
        const listed = s.resources.find((r) => r.uri === uri);
        // Hosts read the content item's metadata, and fall back to the list entry.
        const ui = (resourceUi(c) ?? resourceUi(listed)) as McpUiResourceMeta | undefined;
        const csp = ui?.csp as unknown;
        if (csp === undefined) {
          noCsp.push(`${uri} declares no ui.csp`);
        } else if (!isOriginLists(csp)) {
          noCsp.push(`${uri}: ui.csp is not a map of origin lists`);
        }
        const openAi = openAiCsp(c) ?? openAiCsp(listed);
        if (openAi === undefined) {
          noOpenAiCsp.push(`${uri} declares no ${OPENAI_CSP_KEY}`);
        } else if (!isOriginLists(openAi)) {
          noOpenAiCsp.push(`${uri}: ${OPENAI_CSP_KEY} is not a map of origin lists`);
        } else {
          const camel = SPEC_CSP_KEYS.filter((k) => k in openAi);
          if (camel.length) {
            noOpenAiCsp.push(
              `${uri}: ${OPENAI_CSP_KEY} names ${camel.join(", ")}, which OpenAI does not document for it`,
            );
          }
        }
        const html = "text" in c ? c.text : Buffer.from(c.blob, "base64").toString("utf-8");
        if (hasDataFont(html)) {
          if (!declaresData(csp, "resourceDomains")) {
            dataFonts.push(`${uri} loads a data: font, and ui.csp.resourceDomains omits data:`);
          }
          if (!declaresData(openAi, "resource_domains")) {
            openAiDataFonts.push(
              `${uri} loads a data: font, and ${OPENAI_CSP_KEY}.resource_domains omits data:`,
            );
          }
        }
      }
    }
    add(
      "resource-csp",
      noCsp.length ? "fail" : "pass",
      noCsp.length ? noCsp.join("; ") : "every UI resource declares ui.csp",
    );
    add(
      "resource-openai-csp",
      noOpenAiCsp.length ? "fail" : "pass",
      noOpenAiCsp.length ? noOpenAiCsp.join("; ") : `every UI resource declares ${OPENAI_CSP_KEY}`,
    );
    add(
      "resource-data-fonts",
      dataFonts.length ? "fail" : "pass",
      dataFonts.length ? dataFonts.join("; ") : "no data: font ui.csp omits",
    );
    add(
      "resource-openai-data-fonts",
      openAiDataFonts.length ? "fail" : "pass",
      openAiDataFonts.length ? openAiDataFonts.join("; ") : `no data: font ${OPENAI_CSP_KEY} omits`,
    );
  }

  // tool-security-schemes: a question about auth, not about UI.
  if (!authRequired) {
    add("tool-security-schemes", "skip", "the server does not require auth");
  } else {
    const missing = s.tools.filter((t) => !hasSecuritySchemes(t)).map((t) => t.name);
    add(
      "tool-security-schemes",
      missing.length ? "fail" : "pass",
      missing.length
        ? `no securitySchemes on: ${missing.join(", ")}`
        : "every tool declares securitySchemes",
    );
  }
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

async function checkAuth(
  url: string,
  challenge: Response | undefined,
  add: (id: CheckId, status: CheckStatus, detail: string) => void,
): Promise<void> {
  if (!challenge) {
    const reason = "the server answered without a 401 challenge";
    add("auth-challenge", "skip", reason);
    add("auth-resource-metadata", "skip", reason);
    add("auth-issuer", "skip", reason);
    return;
  }

  const { resourceMetadataUrl } = extractWWWAuthenticateParams(challenge);
  add(
    "auth-challenge",
    resourceMetadataUrl ? "pass" : "fail",
    resourceMetadataUrl
      ? `401 names resource_metadata ${resourceMetadataUrl.href}`
      : `401 WWW-Authenticate carries no resource_metadata (${JSON.stringify(challenge.headers.get("www-authenticate"))})`,
  );

  let prm: Awaited<ReturnType<typeof discoverOAuthProtectedResourceMetadata>>;
  try {
    // Without resource_metadata, a client falls back to the well-known path,
    // so the rest of the surface is still worth reporting.
    prm = await discoverOAuthProtectedResourceMetadata(url, { resourceMetadataUrl });
  } catch (err) {
    add(
      "auth-resource-metadata",
      "fail",
      `protected-resource metadata unreadable: ${message(err)}`,
    );
    add("auth-issuer", "skip", "no protected-resource metadata");
    return;
  }
  add(
    "auth-resource-metadata",
    prm.resource === url ? "pass" : "fail",
    prm.resource === url
      ? `resource equals ${url}`
      : `resource is ${JSON.stringify(prm.resource)}, not ${JSON.stringify(url)}`,
  );

  const advertised = prm.authorization_servers?.[0];
  if (!advertised) {
    add("auth-issuer", "fail", "protected-resource metadata lists no authorization_servers");
    return;
  }
  try {
    const metadata = await discoverAuthorizationServerMetadata(advertised);
    if (!metadata) {
      add("auth-issuer", "fail", `no authorization server metadata found for ${advertised}`);
    } else if (metadata.issuer !== advertised) {
      add(
        "auth-issuer",
        "fail",
        `issuer is ${JSON.stringify(metadata.issuer)}, advertised as ${JSON.stringify(advertised)}`,
      );
    } else {
      add("auth-issuer", "pass", `issuer equals ${advertised}`);
    }
  } catch (err) {
    add("auth-issuer", "fail", `authorization server metadata unreadable: ${message(err)}`);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toolUi(tool: Tool): McpUiToolMeta | undefined {
  const ui = tool._meta?.ui;
  return ui && typeof ui === "object" ? (ui as McpUiToolMeta) : undefined;
}

function legacyBinding(tool: Tool): boolean {
  return (
    tool._meta?.[RESOURCE_URI_META_KEY] !== undefined && toolUi(tool)?.resourceUri === undefined
  );
}

function resourceUi(item: { _meta?: Record<string, unknown> } | undefined): unknown {
  const ui = item?._meta?.ui;
  return ui && typeof ui === "object" ? ui : undefined;
}

/**
 * ChatGPT's dialect of the frame's security policy. It is a sibling of `ui`
 * in the resource's `_meta`, not a key inside it, and its origin lists are
 * spelled `connect_domains`/`resource_domains`. OpenAI documents it as a legacy
 * compatibility key and `ui.csp` as generally preferred for new UI. The two are
 * checked separately, and a target's profile sets each one's severity for its host.
 */
const OPENAI_CSP_KEY = "openai/widgetCSP";

/** The spec's spellings, which under `openai/widgetCSP` name origins nothing reads. */
const SPEC_CSP_KEYS = ["connectDomains", "resourceDomains"];

function openAiCsp(item: { _meta?: Record<string, unknown> } | undefined): unknown {
  return item?._meta?.[OPENAI_CSP_KEY];
}

/** The `{ name: [origin, ...] }` shape both CSP dialects have. */
function isOriginLists(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => Array.isArray(v) && v.every((o) => typeof o === "string"))
  );
}

/** Whether `csp` allows `data:` under the key naming static assets in its dialect. */
function declaresData(csp: unknown, key: "resourceDomains" | "resource_domains"): boolean {
  return isOriginLists(csp) && (csp[key] ?? []).includes("data:");
}

function hasSecuritySchemes(tool: Tool): boolean {
  const schemes = tool._meta?.securitySchemes ?? (tool as Record<string, unknown>).securitySchemes;
  return Array.isArray(schemes) && schemes.length > 0;
}

const DATA_FONT_MIME = /data:(?:font\/|application\/(?:x-)?font|application\/vnd\.ms-fontobject)/i;
const FONT_FACE_DATA_URL = /@font-face\s*{[^}]*url\(\s*["']?data:/i;

function hasDataFont(html: string): boolean {
  return DATA_FONT_MIME.test(html) || FONT_FACE_DATA_URL.test(html);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
