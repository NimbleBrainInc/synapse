import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { connect } from "../connect.js";
import type { App, ConnectOptions } from "../types.js";

const AppContext = createContext<App | null>(null);

export interface AppProviderProps extends ConnectOptions {
  children: ReactNode;
}

/**
 * Connect on mount and provide the {@link App} to everything below.
 *
 * Renders nothing until the handshake completes, so no hook below can observe
 * a half-connected app and no tool call can be fired into a host that has not
 * answered `ui/initialize` yet.
 */
export function AppProvider({ children, ...options }: AppProviderProps) {
  const [app, setApp] = useState<App | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const connectingRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connect once on mount
  useEffect(() => {
    // A ref, not cleanup-on-unmount: StrictMode unmounts and immediately
    // remounts, and the transport must survive that. The app is GC'd when the
    // provider is truly gone.
    if (connectingRef.current) return;
    connectingRef.current = true;

    connect(options).then(setApp, (err: unknown) => {
      setError(err instanceof Error ? err : new Error(String(err)));
    });
  }, []);

  // A host that answers `ui/initialize` with an error is a failure the app
  // cannot proceed through, and rendering nothing forever is the worst way to
  // report it: a blank pane and an unhandled rejection in a console nobody has
  // open. Re-throwing during render makes it an ordinary React error, so it
  // reaches the nearest error boundary and is loud in development.
  if (error) throw error;

  // Still connecting. Nothing below can observe a half-connected app, and no
  // hook can fire a call into a host that has not answered yet.
  if (!app) return null;

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
