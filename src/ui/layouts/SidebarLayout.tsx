/**
 * SidebarLayout — the responsive two-column layout for inside an app pane: a
 * nav/list rail plus main content. It reacts to the layout's OWN width (not the
 * device), and below `breakpoint` collapses one of two ways:
 *
 *  - `reflow` (default) — the rail moves to a horizontal strip on top and the
 *    content goes full-width. Best for short navs (a settings page's sections).
 *  - `drawer` — the rail becomes an off-canvas overlay opened by a `Trigger`.
 *    Best for long lists (a document browser) where reflowing would be absurd.
 *
 * Place nav items as flat children of `Sidebar`; it controls direction
 * (column when expanded, row when reflowed). For `drawer`, drop a
 * `<SidebarLayout.Trigger />` anywhere in the app (typically `AppFrame.Header`),
 * or read state via `useSidebar()`.
 */

import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";
import { useBreakpoint } from "./use-container-width.js";

type CollapseMode = "reflow" | "drawer";
type Side = "left" | "right";

interface SidebarState {
  collapsed: boolean;
  mode: CollapseMode;
  side: Side;
  width: number | string;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SidebarCtx = createContext<SidebarState | null>(null);

/** Read the sidebar's responsive state — for custom triggers or nav re-orientation. */
export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarCtx);
  if (!ctx) throw new Error("useSidebar must be used within <SidebarLayout>");
  return ctx;
}

const STYLE_ID = "nb-synapse-sidebarlayout";
const RULES = `
.nb-drawer { transition: transform 220ms cubic-bezier(0.2, 0, 0, 1); }
.nb-drawer-scrim { animation: nb-drawer-fade 180ms ease; }
@keyframes nb-drawer-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .nb-drawer { transition: none; }
  .nb-drawer-scrim { animation: none; }
}
`;

interface SidebarLayoutProps extends HTMLAttributes<HTMLDivElement> {
  side?: Side;
  /** Expanded rail / drawer width. Default 240. */
  width?: number | string;
  /** Collapse below this pane width (px). Default 640. */
  breakpoint?: number;
  collapseMode?: CollapseMode;
  children?: ReactNode;
}

function SidebarLayoutRoot({
  side = "left",
  width = 240,
  breakpoint = 640,
  collapseMode = "reflow",
  style,
  children,
  ...rest
}: SidebarLayoutProps) {
  const { ref, isNarrow } = useBreakpoint<HTMLDivElement>(breakpoint);
  const [open, setOpen] = useState(false);

  // Close the drawer on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Collapsing back to expanded should drop any open drawer state.
  useEffect(() => {
    if (!isNarrow && open) setOpen(false);
  }, [isNarrow, open]);

  const reflowed = isNarrow && collapseMode === "reflow";
  const rootStyle: CSSProperties = {
    position: "relative",
    display: "flex",
    flexDirection: reflowed ? "column" : side === "right" ? "row-reverse" : "row",
    height: "100%",
    minHeight: 0,
    ...style,
  };

  return (
    <SidebarCtx.Provider
      value={{ collapsed: isNarrow, mode: collapseMode, side, width, open, setOpen }}
    >
      <div ref={ref} style={rootStyle} {...rest}>
        {children}
      </div>
    </SidebarCtx.Provider>
  );
}

function Sidebar({ style, children, ...rest }: HTMLAttributes<HTMLElement>) {
  const { collapsed, mode, side, width, open, setOpen } = useSidebar();
  ensureStyle(STYLE_ID, RULES);

  // Expanded: a fixed-width rail beside the content.
  if (!collapsed) {
    const border = `${tokens.borderWidth} solid ${tokens.border}`;
    return (
      <aside
        style={{
          width,
          flexShrink: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
          padding: "0.5rem 0.5rem",
          ...(side === "right" ? { borderLeft: border } : { borderRight: border }),
          ...style,
        }}
        {...rest}
      >
        {children}
      </aside>
    );
  }

  // Reflowed: a horizontal strip on top, content below.
  if (mode === "reflow") {
    return (
      <aside
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "0.25rem",
          width: "100%",
          overflowX: "auto",
          padding: "0.5rem 0.75rem",
          borderBottom: `${tokens.borderWidth} solid ${tokens.border}`,
          ...style,
        }}
        {...rest}
      >
        {children}
      </aside>
    );
  }

  // Drawer: off-canvas overlay + scrim.
  const closed = side === "right" ? "translateX(100%)" : "translateX(-100%)";
  const drawerStyle: StyleWithVars = {
    position: "absolute",
    top: 0,
    bottom: 0,
    [side]: 0,
    width,
    maxWidth: "85%",
    overflowY: "auto",
    background: tokens.bgRaised,
    boxShadow: tokens.shadowLg,
    transform: open ? "translateX(0)" : closed,
    zIndex: 11,
    ...(side === "right"
      ? { borderLeft: `${tokens.borderWidth} solid ${tokens.border}` }
      : { borderRight: `${tokens.borderWidth} solid ${tokens.border}` }),
    ...style,
  };
  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close sidebar"
          className="nb-drawer-scrim"
          onClick={() => setOpen(false)}
          style={{
            position: "absolute",
            inset: 0,
            border: "none",
            padding: 0,
            cursor: "pointer",
            background: "rgba(0,0,0,0.32)",
            zIndex: 10,
          }}
        />
      ) : null}
      <aside className="nb-drawer" aria-hidden={!open} style={drawerStyle} {...rest}>
        {children}
      </aside>
    </>
  );
}

function Main({ style, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", ...style }} {...rest}>
      {children}
    </div>
  );
}

interface TriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Override the default hamburger glyph. */
  children?: ReactNode;
}

/**
 * Hamburger that opens the drawer. Renders only when collapsed in `drawer`
 * mode, and only when it can see a `SidebarLayout` context — so it's safe to
 * place anywhere inside the layout subtree (it no-ops elsewhere). Note: in v1
 * the context lives on `SidebarLayout` itself, so the trigger must sit inside
 * it (e.g. a toolbar in `Main`), not in a sibling `AppFrame.Header`.
 */
function Trigger({ children, style, onClick, ...rest }: TriggerProps) {
  const ctx = useContext(SidebarCtx);
  if (!ctx || !ctx.collapsed || ctx.mode !== "drawer") return null;
  const { open, setOpen } = ctx;
  return (
    <button
      type="button"
      aria-label="Toggle sidebar"
      aria-expanded={open}
      onClick={(e) => {
        setOpen(!open);
        onClick?.(e);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        border: "none",
        background: "transparent",
        color: tokens.fg,
        cursor: "pointer",
        borderRadius: tokens.radiusSm,
        ...style,
      }}
      {...rest}
    >
      {children ?? (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M2 4.5h14M2 9h14M2 13.5h14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

/** `SidebarLayout` with `.Sidebar`, `.Main`, and `.Trigger` slots. */
export const SidebarLayout = Object.assign(SidebarLayoutRoot, { Sidebar, Main, Trigger });
