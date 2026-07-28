/**
 * Badge — a small pill for status and priority labels (e.g. MEDIUM/HIGH,
 * open/resolved). Soft tinted background with a same-hue label.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { tokens } from "../tokens.js";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "processing";

/** `{ bg, fg }` per tone. Soft tinted background, same-hue label. The status
 * tones have no `*Light` token so their tint is derived from the fg color. */
const TONE: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: tokens.bgSubtle, fg: tokens.fgMuted },
  accent: { bg: tokens.infoLight, fg: tokens.accent },
  success: { bg: `color-mix(in oklab, ${tokens.success} 14%, transparent)`, fg: tokens.success },
  warning: { bg: `color-mix(in oklab, ${tokens.warning} 14%, transparent)`, fg: tokens.warning },
  danger: { bg: `color-mix(in oklab, ${tokens.danger} 14%, transparent)`, fg: tokens.danger },
  processing: { bg: tokens.processingLight, fg: tokens.processing },
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children?: ReactNode;
}

export function Badge({ tone = "neutral", style, children, ...rest }: BadgeProps) {
  const { bg, fg } = TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.1rem 0.45rem",
        borderRadius: tokens.radiusXs,
        background: bg,
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
