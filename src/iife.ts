/**
 * IIFE entry point — exposes Synapse on window.NbSynapse for iframe injection.
 *
 * Built separately as synapse-runtime.iife.js via tsup.
 * Injected into iframe srcdoc alongside the ext-apps bridge runtime.
 */

import { createSynapse } from "./core.js";
import { createStore } from "./store.js";

// Expose on the global window object
(window as any).NbSynapse = {
  createSynapse,
  createStore,
};
