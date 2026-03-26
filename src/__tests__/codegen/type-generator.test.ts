import { describe, it, expect } from "vitest";
import { generateTypes } from "../../codegen/type-generator.js";
import type { ToolDefinition } from "../../types.js";

describe("generateTypes", () => {
  it("generates interface for simple object schema", () => {
    const tools: ToolDefinition[] = [
      {
        name: "get_user",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "User ID" },
            verbose: { type: "boolean" },
          },
          required: ["id"],
        },
        outputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name", "age"],
        },
      },
    ];

    const result = generateTypes(tools, "my-app");

    // Input interface
    expect(result).toContain("export interface GetUserInput {");
    expect(result).toContain("/** User ID */");
    expect(result).toContain("  id: string;");
    expect(result).toContain("  verbose?: boolean;");

    // Output interface
    expect(result).toContain("export interface GetUserOutput {");
    expect(result).toContain("  name: string;");
    expect(result).toContain("  age: number;");
  });

  it("generates union type for string enum", () => {
    const tools: ToolDefinition[] = [
      {
        name: "set_status",
        inputSchema: {
          type: "object",
          properties: {
            status: { enum: ["active", "inactive", "pending"] },
          },
          required: ["status"],
        },
      },
    ];

    const result = generateTypes(tools, "app");

    expect(result).toContain('"active" | "inactive" | "pending"');
  });

  it("uses unknown output when outputSchema is missing", () => {
    const tools: ToolDefinition[] = [
      {
        name: "fire_event",
        inputSchema: {
          type: "object",
          properties: {
            event: { type: "string" },
          },
        },
      },
    ];

    const result = generateTypes(tools, "app");

    // Should not generate an output interface
    expect(result).not.toContain("FireEventOutput");

    // ToolMap should use `unknown` for output
    expect(result).toContain("output: unknown");
  });

  it("converts snake_case tool name to PascalCase", () => {
    const tools: ToolDefinition[] = [
      {
        name: "create_task",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
        },
      },
    ];

    const result = generateTypes(tools, "app");

    expect(result).toContain("export interface CreateTaskInput {");
  });

  it("generates ToolMap with all tools", () => {
    const tools: ToolDefinition[] = [
      {
        name: "list_items",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer" },
          },
        },
        outputSchema: {
          type: "object",
          properties: {
            items: { type: "array", items: { type: "string" } },
          },
        },
      },
      {
        name: "delete_item",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    ];

    const result = generateTypes(tools, "task-manager");

    // Map name is PascalCase(appName) + ToolMap
    expect(result).toContain("export interface TaskManagerToolMap {");

    // Entries reference correct input/output types
    expect(result).toContain("list_items: { input: ListItemsInput; output: ListItemsOutput };");
    expect(result).toContain("delete_item: { input: DeleteItemInput; output: unknown };");
  });

  it("includes header comment with app name", () => {
    const result = generateTypes([], "demo-app");

    expect(result).toContain("Source: demo-app");
    expect(result).toContain("DO NOT EDIT");
  });

  it("handles integer type as number", () => {
    const tools: ToolDefinition[] = [
      {
        name: "paginate",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "integer" },
            size: { type: "number" },
          },
        },
      },
    ];

    const result = generateTypes(tools, "app");

    expect(result).toContain("  page?: number;");
    expect(result).toContain("  size?: number;");
  });

  it("handles array type with items", () => {
    const tools: ToolDefinition[] = [
      {
        name: "batch",
        inputSchema: {
          type: "object",
          properties: {
            ids: { type: "array", items: { type: "string" } },
          },
          required: ["ids"],
        },
      },
    ];

    const result = generateTypes(tools, "app");

    expect(result).toContain("  ids: string[];");
  });
});
