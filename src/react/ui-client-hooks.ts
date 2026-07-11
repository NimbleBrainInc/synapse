import { useEffect, useState } from "react";
import type { SynapseUIClient, SynapseUITheme } from "../host/types.js";

/**
 * React hooks over the cross-host UI client (`connectUI`).
 *
 * The client is created once (outside React, since it must exist before first
 * paint to read baked-in data) and passed in. These hooks are the push-first
 * React surface: `useData` re-renders on every push; `useUITheme` on theme
 * changes. A provider/context wrapper is deferred to P2 (React parity); passing
 * the client explicitly keeps P1 additive and dependency-free.
 */

/**
 * Subscribe to the client's pushed data. Returns the current value (synchronous
 * baked-in data on first render) and re-renders on every subsequent push.
 */
export function useData<T = unknown>(client: SynapseUIClient): T | null {
  const [data, setData] = useState<T | null>(() => client.data<T>());

  useEffect(() => {
    // Reconcile any push that landed between render and effect.
    setData(client.data<T>());
    return client.onData<T>((next) => setData(next));
  }, [client]);

  return data;
}

/**
 * Subscribe to the client's resolved theme. The client already applies the theme
 * to the DOM; this is for components that also need the mode/tokens in JS.
 */
export function useUITheme(client: SynapseUIClient): SynapseUITheme {
  const [theme, setTheme] = useState<SynapseUITheme>(() => client.theme());

  useEffect(() => {
    setTheme(client.theme());
    return client.onTheme(setTheme);
  }, [client]);

  return theme;
}
