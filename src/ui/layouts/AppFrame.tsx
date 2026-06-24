/**
 * AppFrame — the universal app chrome: a fixed header, a scrollable body, and
 * an optional fixed footer, filling the iframe pane. Every Synapse app uses it;
 * a body layout (SidebarLayout, ListView, …) goes inside `AppFrame.Body`.
 *
 * The shell fills the pane with `height: 100%`, which needs a definite-height
 * ancestor chain (`#root` → `body` → `html`) — something a bare app document
 * does not supply on its own. So AppFrame establishes that chain itself on
 * render via `injectBaseReset()`; without it the shell would collapse to
 * content height. Apps wanting the chain before first paint can also
 * `import "@nimblebrain/synapse/ui/base"` in their entry.
 *
 * The `contentWidth` knob is a personality lever: `reading` centers header,
 * body, and footer in a ~760px column (Conversations, Research), while `full`
 * uses the whole pane (CRM, dashboards). Header/body/footer share the same
 * column so the composition reads as one page.
 */

import {
  type CSSProperties,
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
} from "react";
import { injectBaseReset } from "../internal/base-reset.js";
import { tokens } from "../tokens.js";

type ContentWidth = "reading" | "full";
const READING_MAX = 760;
const ContentWidthCtx = createContext<ContentWidth>("full");

function columnStyle(width: ContentWidth): CSSProperties {
  return width === "reading" ? { maxWidth: READING_MAX, marginInline: "auto", width: "100%" } : {};
}

interface AppFrameProps extends HTMLAttributes<HTMLDivElement> {
  contentWidth?: ContentWidth;
  children?: ReactNode;
}

function AppFrameRoot({ contentWidth = "full", style, children, ...rest }: AppFrameProps) {
  // The shell's `height: 100%` only resolves against a definite-height ancestor
  // chain; supply it (same render-time pattern as the components' `ensureStyle`).
  injectBaseReset();
  return (
    <ContentWidthCtx.Provider value={contentWidth}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          background: tokens.bg,
          color: tokens.fg,
          fontFamily: tokens.fontSans,
          ...style,
        }}
        {...rest}
      >
        {children}
      </div>
    </ContentWidthCtx.Provider>
  );
}

function Header({ style, children, ...rest }: HTMLAttributes<HTMLElement>) {
  const width = useContext(ContentWidthCtx);
  return (
    <header style={{ flexShrink: 0, padding: "1.25rem 1.5rem 0.75rem", ...style }} {...rest}>
      <div style={columnStyle(width)}>{children}</div>
    </header>
  );
}

interface BodyProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Host a full-bleed body layout (SidebarLayout, BoardLayout) edge-to-edge:
   * no padding, no reading column, and the body itself doesn't scroll — the
   * layout's panes manage their own scroll. Leave off for plain content
   * (lists, forms), which get the padded reading/full column.
   */
  bleed?: boolean;
}

function Body({ bleed = false, style, children, ...rest }: BodyProps) {
  const width = useContext(ContentWidthCtx);
  if (bleed) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          ...style,
        }}
        {...rest}
      >
        {children}
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", ...style }} {...rest}>
      <div style={{ ...columnStyle(width), padding: "0.75rem 1.5rem 1.5rem" }}>{children}</div>
    </div>
  );
}

function Footer({ style, children, ...rest }: HTMLAttributes<HTMLElement>) {
  const width = useContext(ContentWidthCtx);
  return (
    <footer
      style={{
        flexShrink: 0,
        padding: "0.75rem 1.5rem",
        borderTop: `${tokens.borderWidth} solid ${tokens.border}`,
        ...style,
      }}
      {...rest}
    >
      <div style={columnStyle(width)}>{children}</div>
    </footer>
  );
}

/** `AppFrame` with `.Header`, `.Body`, `.Footer` slots. */
export const AppFrame = Object.assign(AppFrameRoot, { Header, Body, Footer });
