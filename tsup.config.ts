import { defineConfig } from "tsup";

export default defineConfig([
  // Main library builds (ESM + CJS)
  {
    entry: {
      index: "src/index.ts",
      "react/index": "src/react/index.ts",
      "vite/index": "src/vite/index.ts",
      "codegen/index": "src/codegen/index.ts",
      "codegen/cli": "src/codegen/cli.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "@modelcontextprotocol/ext-apps", "vite"],
    splitting: true,
    treeshake: true,
  },
  // IIFE build for iframe injection (no external deps — fully self-contained)
  {
    entry: { "synapse-runtime.iife": "src/iife.ts" },
    format: ["iife"],
    globalName: "NbSynapse",
    sourcemap: false,
    dts: false,
    clean: false,
    noExternal: [/.*/],
    treeshake: true,
    minify: true,
  },
]);
