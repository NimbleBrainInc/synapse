import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://synapse.nimblebrain.ai",
  output: "static",
  integrations: [sitemap()],
});
