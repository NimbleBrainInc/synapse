/**
 * IIFE entry point — exposes Synapse on window.Synapse for script tag usage.
 *
 * Usage: Synapse.connect({ name: "widget", version: "1.0.0" }).then(app => { ... })
 *
 * Also exposes createSynapse and createStore for backwards compatibility.
 */

import { connect } from "./connect.js";
import { createSynapse } from "./core.js";
import { createStore } from "./store.js";

// Expose on the global window object
(window as any).Synapse = {
  connect,
  createSynapse,
  createStore,
};
