/**
 * IIFE entry for the cross-host UI client — exposes `window.SynapseUI`.
 *
 * A self-contained component (served as a `ui://` resource, no bundler, no CDN)
 * inlines this build and connects with:
 *
 * ```html
 * <script>/* …this bundle… *\/</script>
 * <script>
 *   var synapse = window.SynapseUI.connect({ name: "widget", version: "1.0.0" });
 *   synapse.onData(render);
 *   render(synapse.data());
 * </script>
 * ```
 *
 * Kept dependency-free (no ext-apps/Zod) so the inlined bundle stays small.
 */
import { connectUI } from "./connect.js";

(globalThis as unknown as { SynapseUI: unknown }).SynapseUI = {
  connect: connectUI,
};
