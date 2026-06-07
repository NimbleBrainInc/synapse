/**
 * Table — a token-styled data table with declarative columns. For the tabular
 * list surfaces (CRM contacts/deals) that simple `ListRow`s don't fit. Renders
 * a real `<table>` for semantics; header is sticky; rows hover-tint and can be
 * clickable. Sorting / selection / virtualization are deliberately out of v1 —
 * compose `Pagination` for paging.
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

  const tableStyle: StyleWithVars = { ...vars, ...style };

  return (
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
}
