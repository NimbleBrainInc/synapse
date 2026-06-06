import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The gallery dogfoods the BUILT library (the real published artifact). Run
// `npm run build` at the repo root first so `dist/ui/*` exists. `base: "./"`
// keeps asset paths relative for GitHub Pages.
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@nimblebrain/synapse/ui/fonts": resolve(__dirname, "../dist/ui/fonts.js"),
      "@nimblebrain/synapse/ui": resolve(__dirname, "../dist/ui/index.js"),
    },
  },
});
