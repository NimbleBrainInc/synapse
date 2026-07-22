// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import starlightSidebarTopics from "starlight-sidebar-topics";
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
      plugins: [
        starlightLinksValidator({ errorOnLocalLinks: false }),
        starlightSidebarTopics([
          {
            label: "Start here",
            link: "/docs/",
            icon: "rocket",
            items: [
              { label: "What is Synapse?", slug: "docs" },
              { label: "Quickstart: React app", slug: "docs/quickstart-react" },
              { label: "Quickstart: Python server", slug: "docs/quickstart-python" },
            ],
          },
          {
            label: "Guides",
            link: "/docs/guides/call-tools/",
            icon: "open-book",
            items: [
              { slug: "docs/guides/call-tools" },
              { slug: "docs/guides/keep-ui-in-sync" },
              { slug: "docs/guides/agent-context" },
              { slug: "docs/guides/theming" },
              { slug: "docs/guides/state-store" },
              { slug: "docs/guides/long-running-tools" },
              { slug: "docs/guides/local-dev" },
              { slug: "docs/guides/codegen" },
              { slug: "docs/guides/cross-host" },
              { slug: "docs/guides/script-tag" },
            ],
          },
          {
            label: "Components",
            link: "/docs/components/",
            icon: "puzzle",
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
          {
            label: "API reference",
            link: "/docs/api/connect/",
            icon: "seti:json",
            items: [
              { slug: "docs/api/connect" },
              { slug: "docs/api/createsynapse" },
              { slug: "docs/api/store" },
              { slug: "docs/api/hooks" },
              { slug: "docs/api/events" },
              { slug: "docs/api/cross-host-client" },
              { slug: "docs/api/cli" },
              { slug: "docs/api/exports" },
            ],
          },
          {
            label: "Concepts",
            link: "/docs/concepts/why/",
            icon: "information",
            items: [
              { slug: "docs/concepts/why" },
              { slug: "docs/concepts/ext-apps" },
              { slug: "docs/concepts/cross-host" },
              { slug: "docs/concepts/theming" },
              { slug: "docs/concepts/when-not-to-use" },
              { slug: "docs/concepts/degradation" },
            ],
          },
        ]),
      ],
    }),
    react(),
    sitemap(),
  ],
});
