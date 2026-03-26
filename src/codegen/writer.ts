import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write generated TypeScript to a file, creating parent directories as needed.
 */
export function writeOutput(content: string, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf-8");
}
