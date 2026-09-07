/**
 * Table — a token-styled data table with declarative columns. For the tabular
 * list surfaces (CRM contacts/deals) that simple `ListRow`s don't fit. Renders
 * a real `<table>` for semantics; header is sticky; rows hover-tint and can be
 * clickable. Sorting / selection / virtualization are deliberately out of v1 —
 * compose `Pagination` for paging.
 *
 * **A column that truncates must declare a `width`.** The default is CSS auto
 * table layout, which sizes every column to its content — so a long cell has no
 * width to be clipped against and instead widens the table past its container,
 * carrying the later columns off the pane. Declaring a width on ANY column
 * switches the table to fixed layout, which is what gives a truncating cell
 * something to overflow. This is the whole reason `width` exists on `Column`,
 * and it is easy to leave off because nothing fails loudly when you do: the
 * table renders, the text is there, and the columns you cannot see are simply
 * past the right edge.
 *
 * Horizontal scrolling is opt-in via `scrollable`, and it is not the default
 * because it costs the sticky header: an `overflow-x` container captures the
 * stickiness that `position: sticky` currently resolves against the page's own
 * scroller, and CSS gives no way to scroll one axis while leaving the other
 * visible. A table that fits does not need it; a genuinely wide one is worth
 * the trade, and the caller is the one who knows which it is.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

type Align = "left" | "right" | "center";

export interface Column<T> {
  /** Stable column id. */
  key: string;
  header: ReactNode;
  /** Cell content for a row. */
  render: (row: T, index: number) => ReactNode;
  align?: Align;
  /**
   * Column width (`"40%"`, `220`, `"12rem"`). Declaring one on any column switches
   * the table to `table-layout: fixed`, and columns without a width then divide the
   * remainder equally. Required on any column whose cell truncates — see the note on
   * the module above.
   */
  width?: number | string;
}

interface TableProps<T> extends Omit<HTMLAttributes<HTMLTableElement>, "children"> {
  data: T[];
  columns: Column<T>[];
  /** Stable key per row. */
  rowKey: (row: T, index: number) => string | number;
  onRowClick?: (row: T, index: number) => void;
  /** Shown when `data` is empty. */
  empty?: ReactNode;
  /**
   * Let a table wider than its container scroll ITSELF rather than its page.
   *
   * Off by default because it trades the sticky header away (see the module note).
   * Reach for it when the columns genuinely cannot fit — not to paper over a missing
   * `width`, which is the cause worth fixing rather than scrolling past.
   */
  scrollable?: boolean;
  /** Floor for the table's own width when `scrollable`, below which it scrolls instead of crushing. */
  minWidth?: number | string;
}

const STYLE_ID = "nb-synapse-table";
const RULES = `
.nb-table { width: 100%; border-collapse: collapse; font-family: var(--nb-table-font); }
.nb-table th, .nb-table td {
  padding: 0.55rem 0.75rem;
  border-bottom: var(--nb-table-border);
  font-size: var(--nb-table-size); line-height: var(--nb-table-line);
}
.nb-table thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--nb-table-head-bg);
  color: var(--nb-table-muted);
  font-weight: var(--nb-table-semibold);
  font-size: var(--nb-table-xs); text-align: left;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.nb-table tbody td { color: var(--nb-table-fg); }
.nb-table tbody tr.nb-table__row--clickable { cursor: pointer; }
.nb-table tbody tr.nb-table__row--clickable:hover { background: var(--nb-table-hover); }
`;

export function Table<T>({
  data,
  columns,
  rowKey,
  onRowClick,
  empty,
  scrollable = false,
  minWidth,
  style,
  className,
  ...rest
}: TableProps<T>) {
  ensureStyle(STYLE_ID, RULES);

  const vars: Record<`--${string}`, string> = {
    "--nb-table-font": tokens.fontSans,
    "--nb-table-fg": tokens.fg,
    "--nb-table-muted": tokens.fgMuted,
    "--nb-table-head-bg": tokens.bg,
    "--nb-table-hover": tokens.bgSubtle,
    "--nb-table-border": `${tokens.borderWidth} solid ${tokens.border}`,
    "--nb-table-size": tokens.textSmSize,
    "--nb-table-line": tokens.textSmLine,
    "--nb-table-xs": tokens.textXsSize,
    "--nb-table-semibold": tokens.weightSemibold,
  };

  if (data.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }

  // Any declared width means the caller has an opinion about proportions, and auto layout
  // would ignore it in favour of content — so one width switches the whole table to fixed.
  // Derived rather than a separate prop: a `width` that silently did nothing is the trap
  // this replaces, not a second knob to remember alongside it.
  const fixed = columns.some((col) => col.width !== undefined);
  const tableStyle: StyleWithVars = {
    ...vars,
    ...(fixed ? { tableLayout: "fixed" as const } : {}),
    ...(minWidth !== undefined ? { minWidth } : {}),
    ...style,
  };

  const table = (
    <table className={`nb-table ${className ?? ""}`.trim()} style={tableStyle} {...rest}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              scope="col"
              style={{ width: col.width, textAlign: col.align ?? "left" }}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => {
          const clickable = Boolean(onRowClick);
          return (
            <tr
              key={rowKey(row, i)}
              className={clickable ? "nb-table__row--clickable" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onRowClick?.(row, i) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick?.(row, i);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((col) => (
                <td key={col.key} style={{ textAlign: col.align ?? "left" }}>
                  {col.render(row, i)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  if (!scrollable) return table;
  // `max-width: 100%` as well as `overflow-x`, because a flex or grid item's default
  // `min-width: auto` lets it grow to its content and the scroller never engages — the
  // container would widen instead, which is the failure this exists to stop.
  return <div style={{ overflowX: "auto", maxWidth: "100%" }}>{table}</div>;
}
