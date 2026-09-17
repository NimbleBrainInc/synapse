#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolDefinition } from "../types.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "codegen") {
  runCodegen(args.slice(1));
} else if (command === "preview") {
  runPreview(args.slice(1));
} else if (command === "check") {
  runCheck(args.slice(1));
} else {
  console.log("Usage:");
  console.log("  synapse codegen   Generate TypeScript types from tool schemas");
  console.log("  synapse preview   Run a standalone preview of an MCP app with UI");
  console.log("  synapse check     Check a running server against host store requirements");
  process.exit(command === "--help" || command === "-h" ? 0 : 1);
}

// ---------------------------------------------------------------------------
// codegen
// ---------------------------------------------------------------------------

async function runCodegen(args: string[]): Promise<void> {
  const { readFromManifest, readFromSchemaDir, readFromServer } = await import(
    "./schema-reader.js"
  );
  const { generateTypes } = await import("./type-generator.js");
  const { writeOutput } = await import("./writer.js");

  const flags = parseFlags(args, ["from-manifest", "from-server", "from-schema", "out", "app"]);

  if (!flags["from-manifest"] && !flags["from-server"] && !flags["from-schema"]) {
    console.error("Usage:");
    console.error(
      "  synapse codegen --from-manifest ./manifest.json [--out ./types.ts] [--app name]",
    );
    console.error("  synapse codegen --from-server http://localhost:3000/mcp [--out ./types.ts]");
    console.error("  synapse codegen --from-schema ./schemas/ [--out ./types.ts]");
    process.exit(1);
  }

  try {
    let tools: ToolDefinition[];
    let appName = flags.app;

    if (flags["from-manifest"]) {
      const manifestPath = resolve(flags["from-manifest"]);
      tools = readFromManifest(manifestPath);
      if (!appName) {
        const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
        appName = raw.name ?? "app";
      }
    } else if (flags["from-server"]) {
      tools = await readFromServer(flags["from-server"]);
      appName = appName ?? "app";
    } else {
      tools = readFromSchemaDir(resolve(flags["from-schema"] as string));
      appName = appName ?? "app";
    }

    if (tools.length === 0) console.error("Warning: No tools found");

    const output = generateTypes(tools, appName ?? "app");
    const outPath = resolve(flags.out ?? "src/generated/types.ts");
    writeOutput(output, outPath);
    console.log(`Generated ${tools.length} tool types -> ${outPath}`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

async function runPreview(args: string[]): Promise<void> {
  const { startPreview } = await import("../preview/server.js");

  const flags = parseFlags(args, ["server", "ui", "server-port", "ui-port", "port"]);

  if (!flags.server || !flags.ui) {
    console.error("Usage:");
    console.error(
      '  synapse preview --server "uv run uvicorn mcp_hello.server:app --port 8001" --ui ./ui',
    );
    console.error("");
    console.error("Options:");
    console.error("  --server <cmd>        Shell command to start the MCP server (HTTP mode)");
    console.error("  --ui <path>           Path to UI directory (must have package.json)");
    console.error("  --server-port <port>  MCP server port (default: 8001)");
    console.error("  --ui-port <port>      Vite dev server port (default: 5173)");
    console.error("  --port <port>         Preview harness port (default: 5180)");
    process.exit(1);
  }

  await startPreview({
    serverCmd: flags.server,
    uiDir: flags.ui,
    serverPort: Number(flags["server-port"] ?? 8001),
    uiPort: Number(flags["ui-port"] ?? 5173),
    previewPort: Number(flags.port ?? 5180),
  });
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

async function runCheck(args: string[]): Promise<void> {
  const { applyProfiles, formatReport, isTargetName, PROFILES, runChecks } = await import(
    "../check/index.js"
  );

  const flags = parseFlags(args, ["target", "token"]);
  const json = args.includes("--json");
  const positional = args.filter(
    (arg, i) => !arg.startsWith("--") && !["--target", "--token"].includes(args[i - 1]),
  );
  const url = positional[0];
  const targets = (flags.target ?? "").split(",").filter(Boolean);
  const unknown = targets.filter((t) => !isTargetName(t));

  if (!url || targets.length === 0 || unknown.length > 0) {
    if (unknown.length > 0) console.error(`Unknown target: ${unknown.join(", ")}`);
    console.error("Usage:");
    console.error("  synapse check --target claude,chatgpt https://example.com/mcp");
    console.error("");
    console.error("Options:");
    console.error(`  --target <list>  Comma-separated: ${Object.keys(PROFILES).join(", ")}`);
    console.error("  --token <token>  Bearer token for a server that requires auth");
    console.error("                   (default: $SYNAPSE_CHECK_TOKEN)");
    console.error("  --json           Print the report as JSON");
    process.exit(1);
  }

  try {
    const results = await runChecks(url, {
      token: flags.token ?? process.env.SYNAPSE_CHECK_TOKEN,
    });
    const reports = applyProfiles(results, targets.filter(isTargetName));
    console.log(json ? JSON.stringify({ url, reports }, null, 2) : formatReport(url, reports));
    process.exit(reports.some((r) => r.failed) ? 1 : 0);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseFlags(args: string[], known: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (known.includes(key) && i + 1 < args.length) {
      flags[key] = args[++i];
    }
  }
  return flags;
}
