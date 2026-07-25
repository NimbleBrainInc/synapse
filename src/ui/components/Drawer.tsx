/**
 * Drawer — an off-canvas overlay panel that slides in from an edge, over a
 * scrim. The general overlay the apps need (e.g. CRM's detail panel).
 *
 * A plain positioned `<div>` overlay — **not** a native `<dialog>`. The platform
 * mounts every app in a sandboxed iframe that withholds `allow-modals`, so
 * `HTMLDialogElement.showModal()` throws there and white-screens the app; a
 * `<dialog>` is unusable in the one environment these apps run in. So the panel
 * hand-rolls what `showModal()` gave for free: a scrim, a Tab/Shift+Tab focus
 * trap (while focus is inside the panel — not the full native `inert`; see the
 * scope note on the open effect and #43), focus-into-panel on open with focus
 * restored on close, background scroll lock, and Escape. Controlled via
 * `open`/`onClose` (renders nothing when closed). Escape routes through `onEscape`
 * (defaults to `onClose`); clicking the scrim calls `onClose`. The slide-in is a
 * CSS keyframe on the panel.
 *
 * Compose with the `Header` / `Body` / `Footer` slots, or pass plain children.
 * `Header` owns the standard affordances — `title` (a real heading, wired as
 * the dialog's accessible name), an optional `onBack` button, an `actions`
 * slot, and the close button — so consumers don't re-roll them. The icon
 * buttons grow to a 44px hit target under `@media (pointer: coarse)`, keyed to
 * input modality rather than viewport width.
 *
 * `side` is `right` (default), `left`, or `bottom` (a bottom sheet — full width,
 * content height capped at 92%). A multi-level "panel stack" (push/pop) is an
 * app concern built on top of this.
 */

import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

type Side = "left" | "right" | "bottom";

const STYLE_ID = "nb-synapse-drawer";
const RULES = `
.nb-drawer-scrim {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; background: rgba(0, 0, 0, 0.32);
  animation: nb-drawer-fade 200ms ease;
}
.nb-drawer-scrim--right { justify-content: flex-end; }
.nb-drawer-scrim--left { justify-content: flex-start; }
.nb-drawer-scrim--bottom { align-items: flex-end; }
.nb-drawer {
  margin: 0; padding: 0; border: none; max-width: 92%;
  height: 100%; max-height: 100%; display: flex; flex-direction: column;
  outline: none;
}
.nb-drawer--bottom { width: 100%; max-width: 100%; height: auto; max-height: 92%; }
.nb-drawer--right { animation: nb-drawer-in-right 240ms cubic-bezier(0.2, 0, 0, 1); }
.nb-drawer--left { animation: nb-drawer-in-left 240ms cubic-bezier(0.2, 0, 0, 1); }
.nb-drawer--bottom { animation: nb-drawer-in-bottom 240ms cubic-bezier(0.2, 0, 0, 1); }
@keyframes nb-drawer-in-right { from { transform: translateX(100%); } }
@keyframes nb-drawer-in-left { from { transform: translateX(-100%); } }
@keyframes nb-drawer-in-bottom { from { transform: translateY(100%); } }
@keyframes nb-drawer-fade { from { opacity: 0; } }
.nb-drawer-iconbtn { width: 28px; height: 28px; }
@media (pointer: coarse) {
  .nb-drawer-iconbtn { min-width: 44px; min-height: 44px; }
}
`;

// Tabbable elements inside the panel, in DOM order — the focus-trap boundary.
// A denylist over the candidate focusables: excludes the not-actually-tabbable
// cases a selector catches without layout — `[hidden]`, `input[type="hidden"]`,
// `[disabled]`, and negative `tabindex`. CSS-hidden focusables (`display:none` /
// `visibility:hidden`) need layout to detect, so they're NOT filtered (worst
// case: one Tab exits). This per-clause enumeration has leaked a rule at a time;
// a positive isTabbable() predicate would centralize it — see #44.
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]):not([hidden]), button:not([disabled]):not([tabindex="-1"]):not([hidden]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]):not([hidden]), select:not([disabled]):not([tabindex="-1"]):not([hidden]), textarea:not([disabled]):not([tabindex="-1"]):not([hidden]), [tabindex]:not([tabindex="-1"]):not([disabled]):not([hidden])';

interface DrawerContextValue {
  labelId: string;
  setHasTitle: (has: boolean) => void;
}

const DrawerContext = createContext<DrawerContextValue | null>(null);

interface DrawerProps extends Omit<HTMLAttributes<HTMLDivElement>, "onClick"> {
  open: boolean;
  /** Called by the scrim and the Header close button. */
  onClose: () => void;
  /** Called on Escape. Defaults to `onClose` — override to do something else
   * (e.g. pop one level of a panel stack before closing). */
  onEscape?: () => void;
  side?: Side;
  /** Panel width (ignored for `side="bottom"`, which is full width). Default 480. */
  width?: number | string;
  children?: ReactNode;
}

function DrawerRoot({
  open,
  onClose,
  onEscape,
  side = "right",
  width = 480,
  style,
  children,
  ...rest
}: DrawerProps) {
  ensureStyle(STYLE_ID, RULES);
  const panelRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  // A `Header` with a `title` registers itself here so the panel can name
  // itself via `aria-labelledby` (preferred over a consumer-passed aria-label).
  const [hasTitle, setHasTitle] = useState(false);

  // Escape → onEscape (defaults to onClose). A window keydown listener replaces
  // the native <dialog> `onCancel`, which required showModal() — blocked in the
  // app iframe sandbox (no `allow-modals`).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        (onEscape ?? onClose)();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onEscape, onClose]);

  // On open: focus into the panel, lock background scroll, and trap Tab/Shift+Tab
  // within it (the focus-into + Tab containment showModal()'s top-layer gave).
  // Restore focus + scroll on close.
  //
  // Scope: this contains Tab while focus is *inside* the panel — the modal case.
  // It is NOT the full native `inert`: it doesn't recover focus that drops to
  // <body> when a focused child unmounts (that fires focusout, not focusin), nor
  // fence off portal'd overlays a consumer opens outside the panel. A
  // document-scoped focus backstop would do neither reliably and would yank focus
  // out of legitimate nested overlays — so full containment is a FocusScope-style
  // owner stack, deferred to #43.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panel?.focus();
    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) {
        // Nothing tabbable inside — preventDefault keeps focus on the panel it's
        // already on (the open effect focused it), so Tab can't leave.
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel?.addEventListener("keydown", onKeyDown);

    return () => {
      panel?.removeEventListener("keydown", onKeyDown);
      body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const ctxValue = useMemo<DrawerContextValue>(() => ({ labelId, setHasTitle }), [labelId]);

  if (!open) return null;

  const isBottom = side === "bottom";
  const panelStyle: StyleWithVars = {
    ...(isBottom ? { width: "100%", maxWidth: "100%" } : { width }),
    background: tokens.bg,
    color: tokens.fg,
    boxShadow: tokens.shadowLg,
    outline: "none",
    ...(side === "right"
      ? { borderLeft: `${tokens.borderWidth} solid ${tokens.border}` }
      : side === "left"
        ? { borderRight: `${tokens.borderWidth} solid ${tokens.border}` }
        : { borderTop: `${tokens.borderWidth} solid ${tokens.border}` }),
    ...style,
  };

  return (
    <DrawerContext.Provider value={ctxValue}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: scrim click is a bonus mouse affordance; Escape (the window keydown above) and the Header close button are the keyboard dismissal paths. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a decorative dismissal backdrop; the panel below owns the dialog role/semantics. */}
      <div
        className={`nb-drawer-scrim nb-drawer-scrim--${side}`}
        onClick={(e) => {
          // A click whose target is the scrim itself (not the panel) dismisses.
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={hasTitle ? labelId : undefined}
          tabIndex={-1}
          className={`nb-drawer nb-drawer--${side}`}
          style={panelStyle}
          {...rest}
        >
          {children}
        </div>
      </div>
    </DrawerContext.Provider>
  );
}

interface HeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /**
   * Heading text — rendered as an `<h2>` and wired as the drawer's accessible
   * name. Renders **instead of** `children` (pass one or the other, not both).
   */
  title?: ReactNode;
  /** Show a leading back button (e.g. pop one level of a panel stack). */
  onBack?: () => void;
  /** Trailing controls placed before the close button. */
  actions?: ReactNode;
  /** Show a close button that calls this. */
  onClose?: () => void;
  children?: ReactNode;
}

function Header({ title, onBack, actions, onClose, style, children, ...rest }: HeaderProps) {
  const ctx = useContext(DrawerContext);
  const hasTitle = title != null;

  // Register the title's presence so the dialog can name itself via this h2.
  useEffect(() => {
    if (!ctx || !hasTitle) return;
    ctx.setHasTitle(true);
    return () => ctx.setHasTitle(false);
  }, [ctx, hasTitle]);

  return (
    <header
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.875rem 1rem",
        borderBottom: `${tokens.borderWidth} solid ${tokens.border}`,
        fontFamily: tokens.fontSans,
        fontWeight: tokens.weightSemibold,
        color: tokens.fg,
        ...style,
      }}
      {...rest}
    >
      {onBack ? (
        <IconButton label="Back" onClick={onBack}>
          <path
            d="M10 3L5 8l5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </IconButton>
      ) : null}
      {hasTitle ? (
        <h2
          id={ctx?.labelId}
          style={{
            flex: 1,
            minWidth: 0,
            margin: 0,
            fontFamily: tokens.fontSans,
            fontSize: tokens.textBaseSize,
            lineHeight: tokens.textBaseLine,
            fontWeight: tokens.weightSemibold,
            color: tokens.fg,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </h2>
      ) : (
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      )}
      {actions ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
          {actions}
        </div>
      ) : null}
      {onClose ? (
        <IconButton label="Close" onClick={onClose}>
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </IconButton>
      ) : null}
    </header>
  );
}

/** Shared 28px (→44px on coarse pointers) icon button for the header affordances. */
function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="nb-drawer-iconbtn"
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        color: tokens.fgMuted,
        cursor: "pointer",
        borderRadius: tokens.radiusSm,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function Body({ style, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "1rem", ...style }} {...rest}>
      {children}
    </div>
  );
}

function Footer({ style, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <footer
      style={{
        flexShrink: 0,
        padding: "0.75rem 1rem",
        borderTop: `${tokens.borderWidth} solid ${tokens.border}`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </footer>
  );
}

/** `Drawer` with `.Header`, `.Body`, `.Footer` slots. */
export const Drawer = Object.assign(DrawerRoot, { Header, Body, Footer });
