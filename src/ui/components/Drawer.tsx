/**
 * Drawer — an off-canvas overlay panel that slides in from an edge, over a
 * scrim. The general overlay the apps need (e.g. CRM's detail panel). Controlled
 * via `open` / `onClose`. Slides in on open and out on close; closes on scrim
 * click and Escape; traps focus and locks body scroll while open; respects
 * `prefers-reduced-motion`.
 *
 * Compose with the `Header` / `Body` / `Footer` slots, or pass plain children.
 * A multi-level "panel stack" (push/pop) is an app concern built on top of this.
 */

import { type HTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

type Side = "left" | "right";

/** Slide/fade duration (ms). The unmount-after-close timer matches this. */
const TRANSITION_MS = 240;

const STYLE_ID = "nb-synapse-drawer";
const RULES = `
.nb-drawerlay { position: fixed; inset: 0; z-index: 1000; }
.nb-drawerlay__scrim {
  position: absolute; inset: 0; border: none; padding: 0; cursor: pointer;
  background: rgba(0,0,0,0.32); transition: opacity ${TRANSITION_MS}ms ease;
}
.nb-drawerlay__panel {
  position: absolute; top: 0; bottom: 0; display: flex; flex-direction: column;
  max-width: 92%; transition: transform ${TRANSITION_MS}ms cubic-bezier(0.2, 0, 0, 1);
}
.nb-drawerlay__panel--right { right: 0; }
.nb-drawerlay__panel--left { left: 0; }
@media (prefers-reduced-motion: reduce) {
  .nb-drawerlay__scrim, .nb-drawerlay__panel { transition: none; }
}
`;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

interface DrawerProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  open: boolean;
  /** Called by the scrim and the Header close button. */
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
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  // `mounted` keeps the panel in the DOM through the exit transition;
  // `shown` drives the slide (off-canvas → in, and back out on close).
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  // Enter/exit: on open, mount then flip `shown` next frame (slide in); on
  // close, clear `shown` (slide out) then unmount after the transition.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Modal behavior while mounted: focus trap, focus move-in/restore, scroll-lock, Esc.
  useEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    restoreFocusRef.current = document.activeElement;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        (onEscape ?? onClose)();
        return;
      }
      if (e.key === "Tab" && panel) {
        const focusable = getFocusable(panel);
        if (focusable.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstFocusable = panel ? getFocusable(panel)[0] : undefined;
    (firstFocusable ?? panel)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (restoreFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, [mounted, onClose, onEscape]);

  if (!mounted) return null;

  const offscreen = side === "right" ? "translateX(100%)" : "translateX(-100%)";
  const panelStyle: StyleWithVars = {
    width,
    transform: shown ? "translateX(0)" : offscreen,
    background: tokens.bg,
    boxShadow: tokens.shadowLg,
    ...(side === "right"
      ? { borderLeft: `${tokens.borderWidth} solid ${tokens.border}` }
      : { borderRight: `${tokens.borderWidth} solid ${tokens.border}` }),
    ...style,
  };

  return (
    <div className="nb-drawerlay">
      <button
        type="button"
        aria-label="Close"
        className="nb-drawerlay__scrim"
        style={{ opacity: shown ? 1 : 0 }}
        onClick={onClose}
      />
      {/* biome-ignore lint/a11y/useSemanticElements: a dialog role on a div is the standard pattern; <dialog> would impose top-layer/backdrop behavior this controlled overlay manages itself. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`nb-drawerlay__panel nb-drawerlay__panel--${side}`}
        style={panelStyle}
        {...rest}
      >
        {children}
      </div>
    </div>
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
