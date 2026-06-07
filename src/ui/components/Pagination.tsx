/**
 * Pagination — chrome-less prev/next text links with a "page X of Y" counter.
 * 1-based `page`. Buttons disable at the ends.
 */

import type { HTMLAttributes } from "react";
import { Inline } from "../primitives.js";
import { tokens } from "../tokens.js";
import { TextLink } from "./Button.js";

interface PaginationProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Current page, 1-based. */
  page: number;
  /** Total number of pages. */
  pageCount: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, pageCount, onChange, style, ...rest }: PaginationProps) {
  const atStart = page <= 1;
  const atEnd = page >= pageCount;
  return (
    <Inline
      justify="between"
      style={{
        fontFamily: tokens.fontSans,
        fontSize: tokens.textXsSize,
        color: tokens.fgMuted,
        letterSpacing: "0.02em",
        ...style,
      }}
      {...rest}
    >
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        Page {page} of {pageCount}
      </span>
      <Inline gap="1rem">
        <TextLink disabled={atStart} onClick={() => onChange(page - 1)}>
          ← Prev
        </TextLink>
        <TextLink disabled={atEnd} onClick={() => onChange(page + 1)}>
          Next →
        </TextLink>
      </Inline>
    </Inline>
  );
}
