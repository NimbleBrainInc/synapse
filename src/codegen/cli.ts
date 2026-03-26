#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolDefinition } from "../types.js";
import { readFromManifest, readFromSchemaDir, readFromServer } from "./schema-reader.js";
import { generateTypes } from "./type-generator.js";
import { writeOutput } from "./writer.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Strip "codegen" subcommand if present
  if (args[0] === "codegen") args.shift();

  const flags = parseFlags(args);

  if (!flags.fromManifest && !flags.fromServer && !flags.fromSchema) {
    console.error("Error: Specify a source with --from-manifest, --from-server, or --from-schema");
    console.error("");
    console.error("Usage:");
    console.error(
      "  synapse codegen --from-manifest ./manifest.json [--out ./types.ts] [--app my-app]",
    );
    console.error(
      "  synapse codegen --from-server http://localhost:3000/mcp [--out ./types.ts] [--app my-app]",
    );
    console.error("  synapse codegen --from-schema ./schemas/ [--out ./types.ts] [--app my-app]");
    process.exit(1);
  }

  try {
    let tools: ToolDefinition[];
    let appName = flags.app;

    if (flags.fromManifest) {
      const manifestPath = resolve(flags.fromManifest);
      tools = readFromManifest(manifestPath);
      if (!appName) {
        const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
        appName = raw.name ?? "app";
      }
    } else if (flags.fromServer) {
      tools = await readFromServer(flags.fromServer);
      appName = appName ?? "app";
    } else {
      tools = readFromSchemaDir(resolve(flags.fromSchema as string));
      appName = appName ?? "app";
    }

    if (tools.length === 0) {
      console.error("Warning: No tools found in source");
    }

    const output = generateTypes(tools, appName ?? "app");
    const outPath = resolve(flags.out ?? "src/generated/types.ts");
    writeOutput(output, outPath);

    console.log(`Generated ${tools.length} tool types -> ${outPath}`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

interface Flags {
  fromManifest?: string;
  fromServer?: string;
  fromSchema?: string;
  out?: string;
  app?: string;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--from-manifest":
        flags.fromManifest = args[++i];
        break;
      case "--from-server":
        flags.fromServer = args[++i];
        break;
      case "--from-schema":
        flags.fromSchema = args[++i];
        break;
      case "--out":
        flags.out = args[++i];
        break;
      case "--app":
        flags.app = args[++i];
        break;
    }
  }
  return flags;
}

main();
