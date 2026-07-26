import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { createSynapse } from "../core.js";
import { applyTheme } from "../theme-defaults.js";
import type { Synapse, SynapseOptions, SynapseTheme } from "../types.js";

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

  return (
    <SynapseContext.Provider value={ref.current}>
      <ThemeInjector synapse={ref.current} />
      {children}
    </SynapseContext.Provider>
  );
}

/** Injects theme CSS variables onto document.documentElement whenever the theme changes. */
function ThemeInjector({ synapse }: { synapse: Synapse }) {
  const [theme, setTheme] = useState<SynapseTheme>(() => synapse.getTheme());

  useEffect(() => {
    setTheme(synapse.getTheme());
    return synapse.onThemeChanged(setTheme);
  }, [synapse]);

  useEffect(() => {
    // Neutral defaults for the mode back any var the host omits, then host
    // values win — the same single path used by the handshake in core.ts.
    applyTheme(theme.mode, theme.tokens, theme.fontFaces);
  }, [theme]);

  return null;
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
