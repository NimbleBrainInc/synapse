/**
 * Typography components bound to the type scale and the sans/heading font
 * slots. `Text` for body copy, `Heading` for display type (uses the heading
 * font — Hanken Grotesk in the NimbleBrain host, `system-ui` elsewhere).
 */

import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";
import { type HeadingSize, headingStyle, type TextSize, textStyle, tokens } from "./tokens.js";

type Tone = "default" | "muted" | "faint" | "accent" | "danger" | "success";
type Weight = "normal" | "medium" | "semibold" | "bold";

const TONE: Record<Tone, string> = {
  default: tokens.fg,
  muted: tokens.fgMuted,
  faint: tokens.fgFaint,
  accent: tokens.accent,
  danger: tokens.danger,
  success: tokens.success,
};

const WEIGHT: Record<Weight, string> = {
  normal: tokens.weightNormal,
  medium: tokens.weightMedium,
  semibold: tokens.weightSemibold,
  bold: tokens.weightBold,
};

interface TextProps extends Omit<HTMLAttributes<HTMLElement>, "color"> {
  size?: TextSize;
  weight?: Weight;
  tone?: Tone;
  mono?: boolean;
  /**
   * Single-line ellipsis truncation.
   *
   * Sets `display: block` alongside the ellipsis rules, and that is load-bearing rather
   * than incidental: `overflow` and `text-overflow` do not apply to a non-replaced INLINE
   * box, so on the default `<span>` the only declaration that survived was
   * `white-space: nowrap` — and the prop did the exact opposite of its name, making text
   * unwrappable instead of clipping it. Inside an auto-layout `<table>` that widened the
   * column to the full string and pushed every later column off the pane.
   *
   * `min-width: 0` comes with it so the box can actually shrink as a flex item; without it
   * a truncating `Text` inside `Inline`/`Stack` refuses to go below its content width and
   * pushes its container instead, which is the same bug one layer out.
   *
   * A truncating cell in a `Table` also needs its column to declare a `width` — see
   * `Column.width`. Auto table layout sizes to content, so the ellipsis has nothing to
   * clip against until some column is pinned.
   */
  truncate?: boolean;
  as?: ElementType;
  children?: ReactNode;
}

/** Body text. Defaults to base size, normal weight, primary tone, sans font. */
export function Text({
  size = "base",
  weight = "normal",
  tone = "default",
  mono = false,
  truncate = false,
  as: As = "span",
  style,
  children,
  ...rest
}: TextProps) {
  const truncation: CSSProperties = truncate
    ? {
        display: "block",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }
    : {};
  return (
    <As
      style={{
        margin: 0,
        fontFamily: mono ? tokens.fontMono : tokens.fontSans,
        fontWeight: WEIGHT[weight],
        color: TONE[tone],
        ...textStyle(size),
        ...truncation,
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}

interface HeadingProps extends Omit<HTMLAttributes<HTMLHeadingElement>, "color"> {
  size?: HeadingSize;
  weight?: Weight;
  tone?: Tone;
  as?: ElementType;
  children?: ReactNode;
}

/** Display heading using the heading font slot. Defaults to md, semibold. */
export function Heading({
  size = "md",
  weight = "semibold",
  tone = "default",
  as: As = "h2",
  style,
  children,
  ...rest
}: HeadingProps) {
  return (
    <As
      style={{
        margin: 0,
        fontFamily: tokens.fontHeading,
        fontWeight: WEIGHT[weight],
        color: TONE[tone],
        letterSpacing: "-0.015em",
        ...headingStyle(size),
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
