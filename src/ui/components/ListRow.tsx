/**
 * ListRow — the recurring list item: an optional leading slot (status dot,
 * avatar), a title with optional meta line, and a trailing slot (timestamp,
 * actions). Rounded hover tint, flat at rest — the pattern Research,
 * Conversations, and the Collateral sidebar each re-rolled.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

const STYLE_ID = "nb-synapse-listrow";
const RULES = `
.nb-listrow { transition: background 140ms ease; }
.nb-listrow--interactive { cursor: pointer; }
.nb-listrow--interactive:hover { background: var(--nb-listrow-hover); }
`;

interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  /** Secondary line under the title. */
  meta?: ReactNode;
  /** Leading slot — e.g. a StatusDot or Avatar. */
  leading?: ReactNode;
  /** Trailing slot — e.g. a timestamp or actions. */
  trailing?: ReactNode;
  /** Enables pointer cursor + hover tint. */
  interactive?: boolean;
}

export function ListRow({
  title,
  meta,
  leading,
  trailing,
  interactive = false,
  style,
  className,
  ...rest
}: ListRowProps) {
  ensureStyle(STYLE_ID, RULES);
  const rowStyle: StyleWithVars = {
    "--nb-listrow-hover": tokens.bgSubtle,
    display: "grid",
    gridTemplateColumns: `${leading ? "auto " : ""}minmax(0, 1fr)${trailing ? " auto" : ""}`,
    columnGap: "0.75rem",
    alignItems: "baseline",
    padding: "0.65rem 0.75rem",
    borderRadius: tokens.radiusSm,
    ...style,
  };
  return (
    <div
      className={`nb-listrow ${interactive ? "nb-listrow--interactive" : ""} ${className ?? ""}`.trim()}
      style={rowStyle}
      {...rest}
    >
      {leading ? <div style={{ alignSelf: "center", display: "flex" }}>{leading}</div> : null}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: tokens.fontSans,
            fontSize: tokens.textBaseSize,
            lineHeight: tokens.textBaseLine,
            fontWeight: tokens.weightMedium,
            color: tokens.fg,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {meta ? (
          <div
            style={{
              marginTop: "0.15rem",
              fontFamily: tokens.fontSans,
              fontSize: tokens.textXsSize,
              lineHeight: tokens.textXsLine,
              color: tokens.fgMuted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {meta}
          </div>
        ) : null}
      </div>
      {trailing ? (
        <div
          style={{
            alignSelf: "center",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: tokens.textXsSize,
            color: tokens.fgMuted,
            whiteSpace: "nowrap",
          }}
        >
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
