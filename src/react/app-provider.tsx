import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { connect } from "../connect.js";
import type { App, ConnectOptions } from "../types.js";

const AppContext = createContext<App | null>(null);

export interface AppProviderProps extends ConnectOptions {
  children: ReactNode;
}

export function AppProvider({ children, name, version, autoResize }: AppProviderProps) {
  const [app, setApp] = useState<App | null>(null);
  const connectingRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connect once on mount
  useEffect(() => {
    if (connectingRef.current) return;
    connectingRef.current = true;

    connect({ name, version, autoResize }).then((a) => {
      setApp(a);
    });
  }, []);

  if (!app) return null; // Don't render children until connected

  return <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}

export function useAppContext(): App {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error(
      "useApp must be used within an <AppProvider>. Wrap your component tree with <AppProvider>.",
    );
  }
  return ctx;
}
