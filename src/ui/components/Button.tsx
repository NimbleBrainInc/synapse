/**
 * Button and TextLink. Pseudo-states (`:hover`/`:active`/`:disabled`) live in a
 * once-injected stylesheet that reads token-driven CSS custom properties set
 * inline — so the base values stay token-driven while hover still works.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

const STYLE_ID = "nb-synapse-button";
const RULES = `
.nb-btn {
  --nb-btn-bg: transparent;
  --nb-btn-bg-hover: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: var(--nb-btn-border, none);
  border-radius: var(--nb-btn-radius);
  background: var(--nb-btn-bg);
  color: var(--nb-btn-fg);
  font-family: var(--nb-btn-font);
  font-weight: var(--nb-btn-weight);
  cursor: pointer;
  transition: background 130ms ease, color 130ms ease, opacity 130ms ease;
  white-space: nowrap;
}
.nb-btn:hover { background: var(--nb-btn-bg-hover); }
.nb-btn:active { transform: translateY(0.5px); }
.nb-btn:disabled { opacity: 0.5; cursor: default; }
.nb-btn:disabled:hover { background: var(--nb-btn-bg); }
.nb-textlink {
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--nb-tl-font);
  color: var(--nb-tl-fg);
  transition: color 130ms ease, opacity 130ms ease;
}
.nb-textlink:hover { color: var(--nb-tl-fg-hover); }
.nb-textlink:disabled { opacity: 0.45; cursor: default; }
`;

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

const SIZE_PAD: Record<Size, string> = {
  sm: "0.3rem 0.6rem",
  md: "0.45rem 0.85rem",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  style,
  className,
  children,
  ...rest
}: ButtonProps) {
  ensureStyle(STYLE_ID, RULES);
  const vars: Record<`--${string}`, string> = {
    "--nb-btn-radius": tokens.radiusSm,
    "--nb-btn-font": tokens.fontSans,
    "--nb-btn-weight": tokens.weightMedium,
  };
  if (variant === "primary") {
    vars["--nb-btn-bg"] = tokens.accent;
    vars["--nb-btn-bg-hover"] = `color-mix(in oklab, ${tokens.accent} 88%, black)`;
    vars["--nb-btn-fg"] = tokens.accentFg;
  } else if (variant === "secondary") {
    vars["--nb-btn-bg"] = tokens.bgSubtle;
    vars["--nb-btn-bg-hover"] = tokens.bgRaised;
    vars["--nb-btn-fg"] = tokens.fg;
    vars["--nb-btn-border"] = `${tokens.borderWidth} solid ${tokens.border}`;
  } else {
    vars["--nb-btn-bg"] = "transparent";
    vars["--nb-btn-bg-hover"] = tokens.bgSubtle;
    vars["--nb-btn-fg"] = tokens.fg;
  }
  const btnStyle: StyleWithVars = {
    ...vars,
    padding: SIZE_PAD[size],
    fontSize: size === "sm" ? tokens.textSmSize : tokens.textBaseSize,
    lineHeight: size === "sm" ? tokens.textSmLine : tokens.textBaseLine,
    ...style,
  };
  return (
    <button type="button" className={`nb-btn ${className ?? ""}`.trim()} style={btnStyle} {...rest}>
      {children}
    </button>
  );
}

interface TextLinkProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Resting tone. Hover always moves toward `accent` (or `danger`). */
  tone?: "muted" | "default" | "danger";
  children?: ReactNode;
}

/** A chrome-less text button — for back / delete / retry affordances. */
export function TextLink({ tone = "muted", style, className, children, ...rest }: TextLinkProps) {
  ensureStyle(STYLE_ID, RULES);
  const resting =
    tone === "danger" ? tokens.danger : tone === "default" ? tokens.fg : tokens.fgMuted;
  const hover = tone === "danger" ? tokens.danger : tokens.accent;
  const linkStyle: StyleWithVars = {
    "--nb-tl-font": tokens.fontSans,
    "--nb-tl-fg": resting,
    "--nb-tl-fg-hover": hover,
    fontSize: tokens.textXsSize,
    lineHeight: tokens.textXsLine,
    letterSpacing: "0.02em",
    ...style,
  };
  return (
    <button
      type="button"
      className={`nb-textlink ${className ?? ""}`.trim()}
      style={linkStyle}
      {...rest}
    >
      {children}
    </button>
  );
}
