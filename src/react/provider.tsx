import {
  createContext,
  useContext,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { createSynapse } from "../core.js";
import type { Synapse, SynapseOptions } from "../types.js";

const SynapseContext = createContext<Synapse | null>(null);

export interface SynapseProviderProps extends SynapseOptions {
  children: ReactNode;
}

export function SynapseProvider({ children, ...options }: SynapseProviderProps) {
  const ref = useRef<Synapse | null>(null);

  if (ref.current === null) {
    ref.current = createSynapse(options);
  }

  useEffect(() => {
    // StrictMode: on double-mount, the ref may already have an instance.
    // The ref was created synchronously above, so it's always valid here.
    return () => {
      ref.current?.destroy();
      ref.current = null;
    };
  }, []);

  return (
    <SynapseContext.Provider value={ref.current}>
      {children}
    </SynapseContext.Provider>
  );
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
