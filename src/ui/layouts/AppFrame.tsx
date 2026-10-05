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
 *
 * **There is deliberately no chrome slot here.** A Synapse app does not own its
 * window: the host spends the left edge on a rail and the right on chat, so an
 * app-level bar is a third chrome layer whose rule lands a few pixels off the
 * chat panel's — two near-parallel lines that read as a mistake and that no
 * amount of styling reconciles. Top-level destinations go in a tab bar under
 * the page header instead; see `PageLayout`.
 */

import {
  type CSSProperties,
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
} from "react";
import { injectBaseReset } from "../internal/base-reset.js";
import { ensureStyle } from "../internal/inject-style.js";
import { tokens } from "../tokens.js";

type ContentWidth = "reading" | "full";

// The gutter follows the FRAME's width, not the device's: the host decides how wide the pane
// is (full screen, beside chat, a phone). A container query keeps it in CSS, so it needs no
// measurement and no re-render. The rule sets the gutter on the frame's children because a
// container query styles a container's descendants, never the container itself.
const GUTTER_STYLE_ID = "nb-synapse-appframe";
const NARROW = 640;
const GUTTER_RULES = `
.nb-appframe { container-type: inline-size; }
@container (max-width: ${NARROW}px) { .nb-appframe > * { --nb-gutter-auto: 1rem; } }
`;
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
  ensureStyle(GUTTER_STYLE_ID, GUTTER_RULES);
  return (
    <ContentWidthCtx.Provider value={contentWidth}>
      <div
        className="nb-appframe"
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
    <header
      style={{ flexShrink: 0, padding: `1.25rem ${tokens.gutter} 0.75rem`, ...style }}
      {...rest}
    >
      <div style={columnStyle(width)}>{children}</div>
    </header>
  );
}

interface BodyProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Host a full-bleed body layout (SidebarLayout, ListDetailLayout) edge-to-edge: no padding, no reading column, and
   * the body itself doesn't scroll — the layout's panes manage their own scroll
   * and inset their own content by the gutter. Leave off for plain content
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
      <div style={{ ...columnStyle(width), padding: `0.75rem ${tokens.gutter} 1.5rem` }}>
        {children}
      </div>
    </div>
  );
}

function Footer({ style, children, ...rest }: HTMLAttributes<HTMLElement>) {
  const width = useContext(ContentWidthCtx);
  return (
    <footer
      style={{
        flexShrink: 0,
        padding: `0.75rem ${tokens.gutter}`,
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
