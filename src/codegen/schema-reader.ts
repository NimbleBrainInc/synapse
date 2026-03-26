import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { ToolDefinition } from "../types.js";

/**
 * Read tool definitions from a manifest.json file.
 * Extracts tools from the MCP standard `tools` array.
 */
export function readFromManifest(manifestPath: string): ToolDefinition[] {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const tools = raw.tools ?? [];

  if (!Array.isArray(tools)) {
    return [];
  }

  return tools.map((t: any) => ({
    name: t.name as string,
    description: t.description as string | undefined,
    inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    outputSchema: t.outputSchema as Record<string, unknown> | undefined,
  }));
}

/**
 * Read tool definitions from a running MCP server via tools/list.
 * Connects to the server's HTTP endpoint and calls the JSON-RPC method.
 */
export async function readFromServer(url: string): Promise<ToolDefinition[]> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/list",
      id: "codegen-1",
      params: {},
    }),
  });

  if (!response.ok) {
    throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(`Server error: ${result.error.message}`);
  }

  const tools = result.result?.tools ?? [];
  return tools.map((t: any) => ({
    name: t.name as string,
    description: t.description as string | undefined,
    inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    outputSchema: t.outputSchema as Record<string, unknown> | undefined,
  }));
}

/**
 * Read entity schemas from a directory and generate CRUD tool definitions.
 * Each .schema.json file becomes create/read/update/delete/list tools.
 */
export function readFromSchemaDir(dirPath: string): ToolDefinition[] {
  if (!existsSync(dirPath)) {
    throw new Error(`Schema directory not found: ${dirPath}`);
  }

  const files = readdirSync(dirPath).filter((f: string) => f.endsWith(".schema.json"));
  const tools: ToolDefinition[] = [];

  for (const file of files) {
    const schema = JSON.parse(readFileSync(join(dirPath, file), "utf-8"));
    const entityName = basename(file, ".schema.json");

    tools.push(
      {
        name: `create_${entityName}`,
        description: `Create a new ${entityName}`,
        inputSchema: schema,
        outputSchema: schema,
      },
      {
        name: `read_${entityName}`,
        description: `Read a ${entityName} by ID`,
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        outputSchema: schema,
      },
      {
        name: `update_${entityName}`,
        description: `Update an existing ${entityName}`,
        inputSchema: schema,
        outputSchema: schema,
      },
      {
        name: `delete_${entityName}`,
        description: `Delete a ${entityName} by ID`,
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      {
        name: `list_${entityName}s`,
        description: `List all ${entityName}s`,
        inputSchema: {
          type: "object",
          properties: {
            filter: { type: "string" },
            limit: { type: "number" },
          },
        },
        outputSchema: {
          type: "object",
          properties: {
            items: { type: "array", items: schema },
            total: { type: "number" },
          },
          required: ["items", "total"],
        },
      },
    );
  }

  return tools;
}
