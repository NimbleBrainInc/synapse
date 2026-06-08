/**
 * StatusDot — a small colored dot for run/task status. The `working` state
 * gets a living ripple-pulse (ported from the Research app), gated on
 * `prefers-reduced-motion`. Same component in list rows and detail headers so
 * status reads identically everywhere.
 */

import type { HTMLAttributes } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

export type Status = "working" | "completed" | "failed" | "idle";

const COLOR: Record<Status, string> = {
  working: tokens.accent,
  completed: tokens.success,
  failed: tokens.danger,
  idle: tokens.fgFaint,
};

const STYLE_ID = "nb-synapse-statusdot";
const KEYFRAMES = `
@keyframes nb-statusdot-pulse {
  0%   { box-shadow: 0 0 0 0 var(--nb-statusdot-ring); transform: scale(1); }
  70%  { box-shadow: 0 0 0 7px transparent; transform: scale(1.15); }
  100% { box-shadow: 0 0 0 0 transparent; transform: scale(1); }
}
.nb-statusdot--working {
  animation: nb-statusdot-pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
@media (prefers-reduced-motion: reduce) {
  .nb-statusdot--working { animation: none; box-shadow: 0 0 0 2px var(--nb-statusdot-ring); }
}
`;

interface StatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, "color"> {
  status?: Status;
  /** Override the dot color (any CSS color / token). */
  color?: string;
  /** Diameter in px. Default 8. */
  size?: number;
}

export function StatusDot({
  status = "idle",
  color,
  size = 8,
  style,
  className,
  ...rest
}: StatusDotProps) {
  ensureStyle(STYLE_ID, KEYFRAMES);
  const dotColor = color ?? COLOR[status];
  const working = status === "working";
  const dotStyle: StyleWithVars = {
    display: "inline-block",
    flexShrink: 0,
    width: size,
    height: size,
    borderRadius: "50%",
    background: dotColor,
    // Ring color for the pulse keyframe — a faded copy of the dot color.
    "--nb-statusdot-ring": `color-mix(in oklab, ${dotColor} 45%, transparent)`,
    ...style,
  };
  return (
    <span
      className={working ? `nb-statusdot--working ${className ?? ""}`.trim() : className}
      style={dotStyle}
      {...rest}
    />
  );
}
