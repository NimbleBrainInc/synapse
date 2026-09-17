#!/usr/bin/env node
/**
 * Bundle-size budget. Fails when any of the three shapes an app actually ships
 * grows past its limit. Run after `npm run build`; it reads `dist/`.
 *
 * Sizes are gzip level 9 bytes, the number a host downloads. Each limit sits a
 * few percent above the measured size, so an ordinary change passes and a new
 * dependency pulled into a bundle does not. Raising a limit is allowed, and the
 * commit that raises it says what the bytes bought.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

const BUDGETS = [
  {
    // What a React app bundles from this package: `connect`, `AppProvider` and
    // every hook, with ext-apps, the MCP SDK and zod resolved into the app
    // (they are peers, so the app's bundler pulls them in) and React left out,
    // since the app ships React whether or not it uses Synapse. Everything is
    // re-exported, so this is the ceiling for any app, not a typical one.
    // Measured 115.5 KB.
    name: "React path (connect + AppProvider + hooks, React external)",
    limit: 120_000,
    measure: () =>
      bundle(
        'export * from "./dist/react/index.js"; export { connect } from "./dist/index.js";',
      ),
  },
  {
    // `dist/connect.iife.global.js`, the `window.Synapse` script tag. It bundles
    // ext-apps' `App` and its schemas by design. Measured 116.6 KB.
    name: "connect IIFE (dist/connect.iife.global.js)",
    limit: 121_000,
    measure: () => readFileSync(resolve(root, "dist/connect.iife.global.js")),
  },
  {
    // The cross-host `window.SynapseUI` client that a self-contained `ui://`
    // resource inlines, and that the Python package vendors. Its size is the
    // reason it is hand-written rather than built on `App`, so it has the
    // tightest limit. Measured 3.8 KB.
    name: "cross-host IIFE (python/nimblebrain_synapse/_assets/synapse-ui.iife.js)",
    limit: 4_100,
    measure: () =>
      readFileSync(resolve(root, "python/nimblebrain_synapse/_assets/synapse-ui.iife.js")),
  },
];

async function bundle(contents) {
  const result = await build({
    stdin: { contents, resolveDir: root, loader: "js" },
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    external: ["react", "react/jsx-runtime", "react-dom"],
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].contents;
}

let failed = false;
for (const { name, limit, measure } of BUDGETS) {
  const size = gzipSync(await measure(), { level: 9 }).length;
  const ok = size <= limit;
  if (!ok) failed = true;
  const pct = ((size / limit) * 100).toFixed(1);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${size} / ${limit} bytes gzipped (${pct}%)`);
}

if (failed) {
  console.error(
    "\nA bundle is over budget. Find what grew (esbuild --analyze, or diff the build) " +
      "before raising a limit in scripts/size-budget.mjs.",
  );
  process.exit(1);
}
