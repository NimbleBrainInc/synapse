/**
 * Drawer — an off-canvas overlay panel that slides in from an edge, over a
 * scrim. The general overlay the apps need (e.g. CRM's detail panel).
 *
 * Built on the native `<dialog>` element: `showModal()` gives the focus trap,
 * Escape handling, top-layer stacking, inert background, and scroll behavior
 * for free — no hand-rolled focus management. Controlled via `open`/`onClose`.
 * Escape routes through `onEscape` (defaults to `onClose`); clicking the
 * backdrop calls `onClose`. The slide-in is a CSS keyframe on `[open]`.
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
  type DialogHTMLAttributes,
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
.nb-drawer {
  margin: 0; padding: 0; border: none; max-width: 92%;
  height: 100%; max-height: 100%; display: flex; flex-direction: column;
}
.nb-drawer--right { margin-left: auto; }
.nb-drawer--left { margin-right: auto; }
.nb-drawer--bottom {
  margin-top: auto; width: 100%; max-width: 100%;
  height: auto; max-height: 92%;
}
.nb-drawer--right[open] { animation: nb-drawer-in-right 240ms cubic-bezier(0.2, 0, 0, 1); }
.nb-drawer--left[open] { animation: nb-drawer-in-left 240ms cubic-bezier(0.2, 0, 0, 1); }
.nb-drawer--bottom[open] { animation: nb-drawer-in-bottom 240ms cubic-bezier(0.2, 0, 0, 1); }
.nb-drawer::backdrop { background: rgba(0, 0, 0, 0.32); }
.nb-drawer[open]::backdrop { animation: nb-drawer-fade 200ms ease; }
@keyframes nb-drawer-in-right { from { transform: translateX(100%); } }
@keyframes nb-drawer-in-left { from { transform: translateX(-100%); } }
@keyframes nb-drawer-in-bottom { from { transform: translateY(100%); } }
@keyframes nb-drawer-fade { from { opacity: 0; } }
.nb-drawer-iconbtn { width: 28px; height: 28px; }
@media (pointer: coarse) {
  .nb-drawer-iconbtn { min-width: 44px; min-height: 44px; }
}
`;

interface DrawerContextValue {
  labelId: string;
  setHasTitle: (has: boolean) => void;
}

const DrawerContext = createContext<DrawerContextValue | null>(null);

interface DrawerProps
  extends Omit<DialogHTMLAttributes<HTMLDialogElement>, "title" | "onCancel" | "onClick"> {
  open: boolean;
  /** Called by the backdrop and the Header close button. */
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const labelId = useId();
  // A `Header` with a `title` registers itself here so the dialog can name
  // itself via `aria-labelledby` (preferred over a consumer-passed aria-label).
  const [hasTitle, setHasTitle] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof dialog.showModal !== "function") return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const isBottom = side === "bottom";
  const panelStyle: StyleWithVars = {
    ...(isBottom ? { width: "100%", maxWidth: "100%" } : { width }),
    background: tokens.bg,
    color: tokens.fg,
    boxShadow: tokens.shadowLg,
    ...(side === "right"
      ? { borderLeft: `${tokens.borderWidth} solid ${tokens.border}` }
      : side === "left"
        ? { borderRight: `${tokens.borderWidth} solid ${tokens.border}` }
        : { borderTop: `${tokens.borderWidth} solid ${tokens.border}` }),
    ...style,
  };

  const ctxValue = useMemo<DrawerContextValue>(() => ({ labelId, setHasTitle }), [labelId]);

  return (
    <DrawerContext.Provider value={ctxValue}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse convenience; the dialog's Escape (onCancel) is the keyboard dismissal path. */}
      <dialog
        ref={dialogRef}
        className={`nb-drawer nb-drawer--${side}`}
        style={panelStyle}
        aria-labelledby={hasTitle ? labelId : undefined}
        onCancel={(e) => {
          e.preventDefault(); // we own dismissal so onEscape can pop a stack
          (onEscape ?? onClose)();
        }}
        onClick={(e) => {
          // A click whose target is the dialog itself is a backdrop click.
          if (e.target === dialogRef.current) onClose();
        }}
        {...rest}
      >
        {children}
      </dialog>
    </DrawerContext.Provider>
  );
}

interface HeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Heading text — rendered as an `<h2>` and wired as the drawer's accessible name. */
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
        gap: "0.5rem",
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
