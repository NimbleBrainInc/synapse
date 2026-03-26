import type { Plugin, ViteDevServer } from "vite";

export interface SynapseVitePluginOptions {
  /** App name (must match manifest) */
  appName: string;
  /** Platform API URL (default: http://localhost:4321) */
  platformUrl?: string;
  /** Auto-inject bridge runtime into HTML entry (default: true) */
  injectBridge?: boolean;
}

/**
 * Vite plugin for Synapse app development.
 *
 * - Configures CORS for cross-origin iframe communication
 * - Injects ext-apps bridge runtime if `injectBridge` is true
 * - Sets up HMR WebSocket to work inside iframe sandbox
 * - Exposes platform URL as `import.meta.env.SYNAPSE_PLATFORM_URL`
 */
export function synapseVite(options: SynapseVitePluginOptions): Plugin {
  const { appName, platformUrl = "http://localhost:4321", injectBridge = true } = options;

  return {
    name: "synapse",

    config() {
      return {
        define: {
          "import.meta.env.SYNAPSE_PLATFORM_URL": JSON.stringify(platformUrl),
          "import.meta.env.SYNAPSE_APP_NAME": JSON.stringify(appName),
        },
        server: {
          hmr: {
            // Required for HMR inside sandboxed iframe
            protocol: "ws",
            host: "localhost",
          },
        },
      };
    },

    configureServer(server: ViteDevServer) {
      // Add CORS headers for cross-origin iframe communication
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        next();
      });
    },

    transformIndexHtml(html: string) {
      if (!injectBridge) return html;

      const bridgeScript = `
<script type="module">
  import { createSynapse } from "@nimblebrain/synapse";
  window.__synapse = createSynapse({
    name: ${JSON.stringify(appName)},
    version: "0.0.0-dev",
  });
</script>`;

      // Inject before closing </head> tag
      return html.replace("</head>", `${bridgeScript}\n</head>`);
    },
  };
}
