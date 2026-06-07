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
 * A multi-level "panel stack" (push/pop) is an app concern built on top of this.
 */

import {
  type DialogHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
} from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

type Side = "left" | "right";

const STYLE_ID = "nb-synapse-drawer";
const RULES = `
.nb-drawer {
  margin: 0; padding: 0; border: none; max-width: 92%;
  height: 100%; max-height: 100%; display: flex; flex-direction: column;
}
.nb-drawer--right { margin-left: auto; }
.nb-drawer--left { margin-right: auto; }
.nb-drawer--right[open] { animation: nb-drawer-in-right 240ms cubic-bezier(0.2, 0, 0, 1); }
.nb-drawer--left[open] { animation: nb-drawer-in-left 240ms cubic-bezier(0.2, 0, 0, 1); }
.nb-drawer::backdrop { background: rgba(0, 0, 0, 0.32); }
.nb-drawer[open]::backdrop { animation: nb-drawer-fade 200ms ease; }
@keyframes nb-drawer-in-right { from { transform: translateX(100%); } }
@keyframes nb-drawer-in-left { from { transform: translateX(-100%); } }
@keyframes nb-drawer-fade { from { opacity: 0; } }
`;

interface DrawerProps
  extends Omit<DialogHTMLAttributes<HTMLDialogElement>, "title" | "onCancel" | "onClick"> {
  open: boolean;
  /** Called by the backdrop and the Header close button. */
  onClose: () => void;
  /** Called on Escape. Defaults to `onClose` — override to do something else
   * (e.g. pop one level of a panel stack before closing). */
  onEscape?: () => void;
  side?: Side;
  /** Panel width. Default 480. */
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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof dialog.showModal !== "function") return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const panelStyle: StyleWithVars = {
    width,
    background: tokens.bg,
    color: tokens.fg,
    boxShadow: tokens.shadowLg,
    ...(side === "right"
      ? { borderLeft: `${tokens.borderWidth} solid ${tokens.border}` }
      : { borderRight: `${tokens.borderWidth} solid ${tokens.border}` }),
    ...style,
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse convenience; the dialog's Escape (onCancel) is the keyboard dismissal path.
    <dialog
      ref={dialogRef}
      className={`nb-drawer nb-drawer--${side}`}
      style={panelStyle}
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
  );
}

interface HeaderProps extends HTMLAttributes<HTMLElement> {
  /** Show a close button that calls this. */
  onClose?: () => void;
  children?: ReactNode;
}

function Header({ onClose, style, children, ...rest }: HeaderProps) {
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
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {onClose ? <CloseButton onClose={onClose} /> : null}
    </header>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        border: "none",
        background: "transparent",
        color: tokens.fgMuted,
        cursor: "pointer",
        borderRadius: tokens.radiusSm,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
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
