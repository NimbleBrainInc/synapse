// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";

// https://astro.build/config
export default defineConfig({
  site: "https://synapse.nimblebrain.ai",
  output: "static",
  integrations: [
    // The bespoke landing lives at src/pages/index.astro (/). Starlight owns
    // the docs, nested under src/content/docs/docs/ so every doc route is
    // /docs/* and never collides with the landing.
    starlight({
      title: "Synapse",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/docs.css"],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/NimbleBrainInc/synapse" },
        { icon: "discord", label: "Discord", href: "https://discord.gg/9MyfR7PKUw" },
      ],
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false })],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "What is Synapse?", slug: "docs" },
            { label: "Quickstart: React app", slug: "docs/quickstart-react" },
          ],
        },
        {
          label: "Components",
          items: [{ label: "Button", slug: "docs/components/button" }],
        },
      ],
    }),
    react(),
    sitemap(),
  ],
});
