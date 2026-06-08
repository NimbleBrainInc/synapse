/**
 * Card — a raised surface with a hairline border. The default container for
 * grouped content (deal cards, task cards, panels). `interactive` adds a hover
 * lift via a once-injected stylesheet (no per-card handlers).
 */

import type { HTMLAttributes, ReactNode } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

const STYLE_ID = "nb-synapse-card";
const RULES = `
.nb-card--interactive {
  cursor: pointer;
  transition: box-shadow 140ms ease, border-color 140ms ease;
}
.nb-card--interactive:hover {
  box-shadow: var(--nb-card-shadow-hover);
  border-color: var(--nb-card-border-hover);
}
`;

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Inner padding (CSS length or px number). Default `0.875rem`. */
  padding?: number | string;
  /** Lift on hover — for clickable cards. */
  interactive?: boolean;
  children?: ReactNode;
}

export function Card({
  padding = "0.875rem",
  interactive = false,
  style,
  className,
  children,
  ...rest
}: CardProps) {
  if (interactive) ensureStyle(STYLE_ID, RULES);
  const cardStyle: StyleWithVars = {
    background: tokens.bgRaised,
    border: `${tokens.borderWidth} solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    padding,
    boxShadow: tokens.shadowSm,
    "--nb-card-shadow-hover": tokens.shadowMd,
    "--nb-card-border-hover": tokens.borderStrong,
    ...style,
  };
  return (
    <div
      className={interactive ? `nb-card--interactive ${className ?? ""}`.trim() : className}
      style={cardStyle}
      {...rest}
    >
      {children}
    </div>
  );
}
