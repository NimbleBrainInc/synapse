// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import remarkGfm from "remark-gfm";

// https://astro.build/config
export default defineConfig({
  site: "https://synapse.nimblebrain.ai",
  output: "static",
  // GFM (tables, strikethrough, task lists) for the .mdx docs.
  markdown: { remarkPlugins: [remarkGfm] },
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
          items: [
            { slug: "docs/components" },
            { slug: "docs/components/tokens" },
            { slug: "docs/components/fonts" },
            {
              label: "Layout primitives",
              items: [
                { slug: "docs/components/stack" },
                { slug: "docs/components/inline" },
                { slug: "docs/components/spacer" },
                { slug: "docs/components/divider" },
              ],
            },
            {
              label: "Layout scaffolds",
              items: [
                { slug: "docs/components/appframe" },
                { slug: "docs/components/sidebarlayout" },
                { slug: "docs/components/listdetaillayout" },
              ],
            },
            {
              label: "Typography",
              items: [
                { slug: "docs/components/heading" },
                { slug: "docs/components/text" },
                { slug: "docs/components/prose" },
              ],
            },
            {
              label: "Data display",
              items: [
                { slug: "docs/components/card" },
                { slug: "docs/components/listrow" },
                { slug: "docs/components/table" },
                { slug: "docs/components/avatar" },
                { slug: "docs/components/badge" },
                { slug: "docs/components/statusdot" },
                { slug: "docs/components/pagination" },
              ],
            },
            {
              label: "Interactive",
              items: [
                { slug: "docs/components/button" },
                { slug: "docs/components/textlink" },
                { slug: "docs/components/searchfield" },
                { slug: "docs/components/segmentedcontrol" },
                { slug: "docs/components/drawer" },
              ],
            },
            {
              label: "Feedback",
              items: [
                { slug: "docs/components/spinner" },
                { slug: "docs/components/emptystate" },
              ],
            },
          ],
        },
      ],
    }),
    react(),
    sitemap(),
  ],
});
