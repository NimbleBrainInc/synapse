import { createContext, type ReactNode, useContext, useRef } from "react";
import { createSynapse } from "../core.js";
import type { Synapse, SynapseOptions } from "../types.js";

const SynapseContext = createContext<Synapse | null>(null);

export interface SynapseProviderProps extends SynapseOptions {
  children: ReactNode;
}

export function SynapseProvider({ children, ...options }: SynapseProviderProps) {
  // Use a ref so the same Synapse instance survives StrictMode's
  // unmount/remount cycle. We intentionally do NOT destroy on unmount
  // because StrictMode re-mounts immediately and the transport must
  // stay alive. The instance is GC'd when the provider is truly removed.
  const ref = useRef<Synapse | null>(null);

  if (ref.current === null || ref.current.destroyed) {
    ref.current = createSynapse(options);
  }

  return <SynapseContext.Provider value={ref.current}>{children}</SynapseContext.Provider>;
}

export function useSynapseContext(): Synapse {
  const ctx = useContext(SynapseContext);
  if (!ctx) {
    throw new Error(
      "useSynapse must be used within a <SynapseProvider>. " +
        "Wrap your app component tree with <SynapseProvider>.",
    );
  }
  return ctx;
}
