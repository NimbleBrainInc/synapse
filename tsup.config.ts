import { defineConfig } from "tsup";

export default defineConfig([
  // Main library builds (ESM + CJS)
  {
    entry: {
      index: "src/index.ts",
      "host/index": "src/host/index.ts",
      "react/index": "src/react/index.ts",
      "ui/index": "src/ui/index.ts",
      "ui/fonts": "src/ui/fonts.ts",
      "ui/base": "src/ui/base.ts",
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
    entry: {
      "connect.iife": "src/iife.ts",
      "synapse-runtime.iife": "src/iife.ts",
    },
    format: ["iife"],
    globalName: "Synapse",
    sourcemap: false,
    dts: false,
    clean: false,
    noExternal: [/.*/],
    treeshake: true,
    minify: true,
  },
  // Lean cross-host UI client IIFE — exposes `window.SynapseUI`. No ext-apps/Zod
  // in its dependency graph, so this is a fraction of the runtime bundle; it's
  // what self-contained `ui://` components (e.g. Bassethound) inline.
  {
    entry: {
      "synapse-ui.iife": "src/host/iife.ts",
    },
    format: ["iife"],
    sourcemap: false,
    dts: false,
    clean: false,
    noExternal: [/.*/],
    treeshake: true,
    minify: true,
  },
]);
