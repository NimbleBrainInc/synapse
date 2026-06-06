/**
 * Spinner — a minimal rotating indicator for inline/button loading states.
 */

import type { HTMLAttributes } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

const STYLE_ID = "nb-synapse-spinner";
const RULES = `
@keyframes nb-spin { to { transform: rotate(360deg); } }
.nb-spinner { animation: nb-spin 0.7s linear infinite; }
@media (prefers-reduced-motion: reduce) { .nb-spinner { animation-duration: 1.6s; } }
`;

interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Diameter in px. Default 16. */
  size?: number;
  /** Arc color. Defaults to the accent token. */
  color?: string;
}

export function Spinner({ size = 16, color, style, className, ...rest }: SpinnerProps) {
  ensureStyle(STYLE_ID, RULES);
  const spinnerStyle: StyleWithVars = {
    display: "inline-block",
    flexShrink: 0,
    width: size,
    height: size,
    borderRadius: "50%",
    border: `2px solid ${tokens.border}`,
    borderTopColor: color ?? tokens.accent,
    boxSizing: "border-box",
    ...style,
  };
  return (
    <span
      className={`nb-spinner ${className ?? ""}`.trim()}
      role="status"
      aria-label="Loading"
      style={spinnerStyle}
      {...rest}
    />
  );
}
