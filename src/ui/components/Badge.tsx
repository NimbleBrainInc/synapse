/**
 * Badge — a small pill for status and priority labels (e.g. MEDIUM/HIGH,
 * open/resolved). Soft tinted background with a same-hue label.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { tokens } from "../tokens.js";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "processing"
  | "warm";

/** `[background, foreground]` per tone. Soft backgrounds, readable labels. */
const TONE: Record<BadgeTone, [bg: string, fg: string]> = {
  neutral: [tokens.bgSubtle, tokens.fgMuted],
  accent: [tokens.infoLight, tokens.accent],
  success: ["color-mix(in oklab, currentColor 0%, transparent)", tokens.success],
  warning: ["color-mix(in oklab, currentColor 0%, transparent)", tokens.warning],
  danger: ["color-mix(in oklab, currentColor 0%, transparent)", tokens.danger],
  processing: [tokens.processingLight, tokens.processing],
  warm: [tokens.warmLight, tokens.warm],
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children?: ReactNode;
}

export function Badge({ tone = "neutral", style, children, ...rest }: BadgeProps) {
  const [bg, fg] = TONE[tone];
  // success/warning/danger have no soft-background token; tint from the fg.
  const background =
    tone === "success" || tone === "warning" || tone === "danger"
      ? `color-mix(in oklab, ${fg} 14%, transparent)`
      : bg;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.1rem 0.45rem",
        borderRadius: tokens.radiusXs,
        background,
        color: fg,
        fontFamily: tokens.fontSans,
        fontSize: tokens.textXsSize,
        lineHeight: tokens.textXsLine,
        fontWeight: tokens.weightSemibold,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
