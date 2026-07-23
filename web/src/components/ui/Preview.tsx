import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { TOKENS, type Mode } from "./tokens";

function currentMode(): Mode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * A themed surface that renders real `@nimblebrain/synapse/ui` components live.
 * Injects a Synapse token map onto its own container (scoped, not `:root`) and
 * follows Starlight's light/dark toggle, so a preview always matches the page.
 */
export function Preview({
  children,
  padding = 24,
  center = false,
}: {
  children: ReactNode;
  padding?: number;
  center?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("dark");

  useEffect(() => {
    setMode(currentMode());
    const observer = new MutationObserver(() => setMode(currentMode()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const style: CSSProperties = {
    ...(TOKENS[mode] as CSSProperties),
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)",
    fontFamily: "var(--font-sans)",
    border: "1px solid var(--color-border-primary)",
    borderRadius: 12,
    padding,
    marginBlock: "1.25rem",
    display: center ? "flex" : undefined,
    justifyContent: center ? "center" : undefined,
    overflowX: "auto",
  };

  return <div style={style}>{children}</div>;
}
