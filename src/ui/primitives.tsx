/**
 * Layout primitives — the composition atoms. `Stack` (vertical) and `Inline`
 * (horizontal) replace ad-hoc `display:flex` style objects; `Spacer` and
 * `Divider` cover the two other recurring layout needs. Deliberately minimal
 * (no `Box`, no grid system) — the layout scaffolds handle page structure.
 */

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { tokens } from "./tokens.js";

type Align = "start" | "center" | "end" | "stretch" | "baseline";
type Justify = "start" | "center" | "end" | "between" | "around";

const ALIGN: Record<Align, CSSProperties["alignItems"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
};

const JUSTIFY: Record<Justify, CSSProperties["justifyContent"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
};

/** A `gap` may be a CSS length string or a number (interpreted as px). */
function gapValue(gap: number | string | undefined): string | number | undefined {
  return typeof gap === "number" ? gap : gap;
}

interface FlexProps extends HTMLAttributes<HTMLDivElement> {
  gap?: number | string;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  children?: ReactNode;
}

function flexStyle(
  direction: "row" | "column",
  { gap, align, justify, wrap }: FlexProps,
): CSSProperties {
  return {
    display: "flex",
    flexDirection: direction,
    gap: gapValue(gap),
    alignItems: align ? ALIGN[align] : undefined,
    justifyContent: justify ? JUSTIFY[justify] : undefined,
    flexWrap: wrap ? "wrap" : undefined,
  };
}

/** Vertical flex container with `gap`. Defaults to `align: stretch`. */
export function Stack({ gap, align, justify, wrap, style, children, ...rest }: FlexProps) {
  return (
    <div style={{ ...flexStyle("column", { gap, align, justify, wrap }), ...style }} {...rest}>
      {children}
    </div>
  );
}

/** Horizontal flex container with `gap`. Defaults to `align: center`. */
export function Inline({
  gap,
  align = "center",
  justify,
  wrap,
  style,
  children,
  ...rest
}: FlexProps) {
  return (
    <div style={{ ...flexStyle("row", { gap, align, justify, wrap }), ...style }} {...rest}>
      {children}
    </div>
  );
}

/** Flexible gap that pushes siblings apart inside a `Stack`/`Inline`. */
export function Spacer({ style, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div style={{ flex: 1, ...style }} {...rest} />;
}

interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

/** A hairline rule using the border token. Horizontal by default. Decorative
 * (`aria-hidden`) — it's a visual divider, not a focusable/valued separator. */
export function Divider({ orientation = "horizontal", style, ...rest }: DividerProps) {
  const isVertical = orientation === "vertical";
  return (
    <div
      aria-hidden="true"
      style={{
        flexShrink: 0,
        background: tokens.border,
        ...(isVertical
          ? { width: tokens.borderWidth, alignSelf: "stretch" }
          : { height: tokens.borderWidth, width: "100%" }),
        ...style,
      }}
      {...rest}
    />
  );
}
