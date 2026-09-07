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
 * uses the whole pane (CRM, dashboards). Nav/header/body/footer share the same
 * column so the composition reads as one page.
 *
 * `Nav` is app chrome and `Header` is page content; an app with more than one
 * top-level destination wants both, in that order. See `Nav` for why the two are
 * not one slot with a border prop.
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

interface NavProps extends HTMLAttributes<HTMLElement> {
  /** The app's own identity — its name, a mark. Sits at the start of the bar. */
  brand?: ReactNode;
}

/**
 * Nav — the app's CHROME bar: who this app is, and its top-level destinations.
 *
 * Distinct from `Header`, and the distinction is the point. `Header` is page content that
 * happens to be at the top; `Nav` is the frame around the page, and it is the only element
 * here entitled to a rule that runs edge to edge.
 *
 * That entitlement is the whole reason this exists as its own slot. An app that puts its
 * nav in `Header` and reaches for a `borderBottom` gets a full-bleed hairline underneath
 * inset content, with inset content below it — a line that separates two things which are
 * both the page, so it reads as a seam rather than as structure. Giving the bar a surface
 * of its own makes the same line describe a real boundary: chrome above, page below.
 *
 * `brand` sits at the start and `children` at the end, because an app's identity is a
 * constant and its destinations are the part a reader is aiming at — and a reader aims at
 * the end of a bar they have already learned the start of.
 */
function Nav({ brand, style, children, ...rest }: NavProps) {
  const width = useContext(ContentWidthCtx);
  return (
    <nav
      style={{
        flexShrink: 0,
        background: tokens.bgRaised,
        borderBottom: `${tokens.borderWidth} solid ${tokens.border}`,
        padding: "0.6rem 1.5rem",
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          ...columnStyle(width),
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          minWidth: 0,
        }}
      >
        {brand ? <div style={{ minWidth: 0 }}>{brand}</div> : <span />}
        {children ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            {children}
          </div>
        ) : null}
      </div>
    </nav>
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

/** `AppFrame` with `.Nav`, `.Header`, `.Body`, `.Footer` slots. */
export const AppFrame = Object.assign(AppFrameRoot, { Nav, Header, Body, Footer });
