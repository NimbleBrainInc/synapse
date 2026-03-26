import { describe, it, expect } from "vitest";
import { readFromManifest } from "../../codegen/schema-reader";
import { resolve } from "node:path";

const fixtureDir = resolve(__dirname, "fixtures");

describe("readFromManifest", () => {
  it("reads tools from a valid manifest", () => {
    const tools = readFromManifest(resolve(fixtureDir, "manifest.json"));
    expect(tools).toHaveLength(3);
    expect(tools[0].name).toBe("create_task");
    expect(tools[1].name).toBe("read_task");
    expect(tools[2].name).toBe("list_tasks");
  });

  it("extracts inputSchema and outputSchema", () => {
    const tools = readFromManifest(resolve(fixtureDir, "manifest.json"));
    const createTask = tools[0];

    expect(createTask.inputSchema).toBeDefined();
    expect((createTask.inputSchema as any).properties.title).toBeDefined();
    expect(createTask.outputSchema).toBeDefined();
    expect((createTask.outputSchema as any).properties.id).toBeDefined();
  });

  it("handles missing outputSchema", () => {
    const tools = readFromManifest(resolve(fixtureDir, "manifest.json"));
    const listTasks = tools[2];

    expect(listTasks.outputSchema).toBeUndefined();
  });

  it("throws for missing file", () => {
    expect(() =>
      readFromManifest("/nonexistent/manifest.json"),
    ).toThrow("Manifest not found");
  });
});
