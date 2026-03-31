import { useCallback, useEffect, useState } from "react";
import type { App, Theme, ToolResultData } from "../types.js";
import { AppProvider, useAppContext } from "./app-provider.js";

export { AppProvider };

export function useApp(): App {
  return useAppContext();
}

export function useToolResult(): ToolResultData | null {
  const app = useAppContext();
  const [data, setData] = useState<ToolResultData | null>(null);

  useEffect(() => {
    return app.on("tool-result", (result: ToolResultData) => {
      setData(result);
    });
  }, [app]);

  return data;
}

export function useToolInput(): Record<string, unknown> | null {
  const app = useAppContext();
  const [input, setInput] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    return app.on("tool-input", (args: Record<string, unknown>) => {
      setInput(args);
    });
  }, [app]);

  return input;
}

export function useConnectTheme(): Theme {
  const app = useAppContext();
  const [theme, setTheme] = useState<Theme>(() => app.theme);

  useEffect(() => {
    setTheme(app.theme); // Sync in case it changed between render and effect
    return app.on("theme-changed", (t: Theme) => {
      setTheme(t);
    });
  }, [app]);

  return theme;
}

export function useResize(): (width?: number, height?: number) => void {
  const app = useAppContext();
  return useCallback((width?: number, height?: number) => app.resize(width, height), [app]);
}
