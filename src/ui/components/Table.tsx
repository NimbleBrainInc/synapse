/**
 * Table — a token-styled data table with declarative columns. For the tabular
 * list surfaces (CRM contacts/deals) that simple `ListRow`s don't fit. Renders
 * a real `<table>` for semantics; header is sticky; rows hover-tint and can be
 * clickable. Sorting / selection / virtualization are deliberately out of v1 —
 * compose `Pagination` for paging.
 *
 * The table lays out in one of two modes, chosen by its columns.
 *
 * **Responsive mode — any column declares a `priority`.** The table fits the width it is
 * actually given, which in an app is a pane whose width the host controls. It uses auto
 * layout with every cell on one line. One column is the primary column: the one that
 * declares `primary`, else the first. It takes the space the others leave and truncates with an ellipsis, and a `width` on it is its
 * readable minimum. The other columns size to their content. When the columns do not fit,
 * the column with the highest `priority` number is hidden (rightmost first on a tie), then
 * the next, until they do — the browser measures the fit before paint, so no caller states
 * a pixel budget. A hidden column's value is not lost: each row shows it under the primary
 * cell's content, in a muted line of label and value pairs. A column without a `priority`
 * is never hidden, so selection checkboxes and action columns stay, and the primary column
 * never hides either, because it carries the hidden values. A hidden column's sort control,
 * if its header holds one, is hidden with it. When every column that may hide is hidden
 * and the table is still too wide, it scrolls inside its own container if `minWidth` is
 * set, and otherwise overflows.
 *
 * **Fixed mode — no column declares a `priority`.** Every column always shows, which is
 * what a spreadsheet-like table needs. Here **a column that truncates must declare a
 * `width`.** The default is CSS auto table layout, which sizes every column to its
 * content — so a long cell has no width to be clipped against and instead widens the table
 * past its container, carrying the later columns off the pane. Declaring a width on ANY
 * column switches the table to fixed layout, which is what gives a truncating cell
 * something to overflow. It is easy to leave off because nothing fails loudly when you do:
 * the table renders, the text is there, and the columns you cannot see are simply past the
 * right edge.
 *
 * In both modes horizontal scrolling is opt-in via `minWidth`. It is not the default
 * because it costs the sticky header: an `overflow-x` container captures the stickiness
 * that `position: sticky` resolves against the page's own scroller, and CSS gives no way
 * to scroll one axis while leaving the other visible. A table that fits does not need it;
 * a genuinely wide one is worth the trade, and the caller is the one who knows which it is.
 */

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type DroppableColumn, useColumnFit } from "../internal/use-column-fit.js";
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
   * Column width (`"40%"`, `220`, `"12rem"`).
   *
   * In fixed mode (no column declares a `priority`), declaring one on any column switches
   * the table to `table-layout: fixed`, and columns without a width then divide the
   * remainder equally. Required on any column whose cell truncates — see the note on the
   * module above.
   *
   * In responsive mode it is a minimum: the column is never laid out narrower. On the primary
   * column, which takes the remaining space and truncates, it is the narrowest that column
   * stays readable.
   */
  width?: number | string;
  /**
   * How important the column is when space runs out: `1` is the most important, and higher
   * numbers are hidden first. Declaring it on any column turns on responsive mode (see the
   * module note). A column without a priority is never hidden, and neither is the primary
   * column.
   */
  priority?: number;
  /**
   * Makes this the primary column in responsive mode: the one that takes the remaining
   * space, truncates, never hides, and carries the hidden columns' values. Without it the
   * first column is primary. Name it when the first column is something else, a row
   * checkbox for instance, which would otherwise be the column that grows. Only one column
   * may declare it; if several do, the first of them is primary.
   */
  primary?: boolean;
  /**
   * The column's name as plain text: it names the column's value when the column is hidden
   * and its value moves under the primary cell, and it is the header's `title`. Defaults to
   * `header` when `header` is a string. Give it whenever `header` is not plain text.
   */
  label?: string;
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
   * The narrowest this table stays readable, and the switch that turns scrolling on.
   *
   * In fixed mode, a fixed-layout table has no lower bound of its own, so seven columns in
   * a 400px pane become seven clipped headers and a badge overflowing its cell. Below this
   * width the table scrolls inside its own container instead of crushing — and setting the
   * floor is the only way to ask for that, because a scroller with no floor has no defined
   * moment to engage: under fixed layout the table always fits its container, and under
   * auto layout it engages at whatever width the content happens to reach.
   *
   * In responsive mode the table hides columns instead of crushing, and the floor applies
   * only once every column that may hide is hidden: past that point the table scrolls
   * rather than overflowing its container. A list surface in responsive mode rarely needs
   * it.
   *
   * The cost is the sticky header. An `overflow-x` container captures the stickiness
   * `position: sticky` resolves against the page's own scroller, and CSS gives no way to
   * scroll one axis while leaving the other visible — so a table without a floor keeps its
   * sticky header, and one with a floor trades it.
   */
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
.nb-table--fit th, .nb-table--fit td { white-space: nowrap; }
.nb-table--fit th { overflow: hidden; text-overflow: ellipsis; }
.nb-table--fit .nb-table__primary {
  width: 100%; max-width: 0;
  overflow: hidden; text-overflow: ellipsis;
}
.nb-table__primary-main { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-table__hidden {
  display: flex; flex-wrap: wrap; column-gap: 0.75rem;
  margin: 0.15rem 0 0; white-space: normal;
  color: var(--nb-table-muted); font-size: var(--nb-table-xs);
}
.nb-table__hidden > div { display: flex; gap: 0.25rem; min-width: 0; }
.nb-table__hidden dt, .nb-table__hidden dd { margin: 0; }
.nb-table__hidden dt { white-space: nowrap; }
.nb-table__hidden dd { color: var(--nb-table-fg); overflow-wrap: anywhere; }
`;

/** The plain-text name of a column: its `label`, else its header when that is text. */
function columnLabel<T>(col: Column<T>): string | undefined {
  if (col.label !== undefined) return col.label;
  return typeof col.header === "string" ? col.header : undefined;
}

export function Table<T>({
  data,
  columns,
  rowKey,
  onRowClick,
  empty,
  minWidth,
  style,
  className,
  ...rest
}: TableProps<T>) {
  ensureStyle(STYLE_ID, RULES);

  // Responsive mode is opt-in per table, so a table whose columns must all stay — a
  // spreadsheet, a comparison — keeps fixed mode by declaring no priority anywhere.
  const responsive = columns.some((col) => col.priority !== undefined);
  const showsEmpty = data.length === 0 && empty !== undefined;

  // The primary column hosts the hidden values, so it never hides, whatever it declares. It
  // is the column that says so, else the first.
  const declaredPrimary = columns.findIndex((col) => col.primary);
  const primaryIndex = declaredPrimary === -1 ? 0 : declaredPrimary;
  const droppable: DroppableColumn[] = [];
  columns.forEach((col, index) => {
    if (index !== primaryIndex && col.priority !== undefined) {
      droppable.push({ key: col.key, priority: col.priority, index });
    }
  });
  const fit = useColumnFit({
    enabled: responsive,
    droppable,
    data,
    columns,
    mounted: !showsEmpty,
  });

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

  if (showsEmpty) {
    return <>{empty}</>;
  }

  const visible = responsive ? columns.filter((col) => !fit.hidden.has(col.key)) : columns;
  const hiddenCols = responsive ? columns.filter((col) => fit.hidden.has(col.key)) : [];
  const primaryKey = columns[primaryIndex]?.key;

  // Fixed mode: any declared width means the caller has an opinion about proportions, and
  // auto layout would ignore it in favour of content — so one width switches the whole table
  // to fixed. Derived rather than a separate prop: a `width` that silently did nothing is the
  // trap this replaces, not a second knob to remember alongside it.
  const fixed = !responsive && columns.some((col) => col.width !== undefined);
  // In responsive mode the floor waits until nothing more can hide; applied earlier, it would
  // read as overflow and hide columns the space could hold.
  const floor = minWidth !== undefined && (!responsive || fit.exhausted) ? { minWidth } : {};
  const tableStyle: StyleWithVars = {
    ...vars,
    ...(fixed ? { tableLayout: "fixed" as const } : {}),
    ...floor,
    ...style,
  };
  const tableClass = ["nb-table", responsive ? "nb-table--fit" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  const headerStyle = (col: Column<T>): CSSProperties => {
    if (!responsive) return { width: col.width, textAlign: col.align ?? "left" };
    return { minWidth: col.width, textAlign: col.align ?? "left" };
  };

  const table = (
    <table ref={fit.tableRef} className={tableClass} style={tableStyle} {...rest}>
      <thead>
        <tr>
          {visible.map((col) => (
            <th
              key={col.key}
              scope="col"
              className={responsive && col.key === primaryKey ? "nb-table__primary" : undefined}
              title={responsive ? columnLabel(col) : undefined}
              style={headerStyle(col)}
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
              {visible.map((col) =>
                responsive && col.key === primaryKey ? (
                  <td
                    key={col.key}
                    className="nb-table__primary"
                    style={{ minWidth: col.width, textAlign: col.align ?? "left" }}
                  >
                    <div className="nb-table__primary-main">{col.render(row, i)}</div>
                    {hiddenCols.length > 0 && (
                      // A description list, so each value is announced with its name. The
                      // hidden columns are not rendered anywhere else, so nothing is read twice.
                      <dl className="nb-table__hidden">
                        {hiddenCols.map((hc) => {
                          const name = columnLabel(hc);
                          return (
                            <div key={hc.key}>
                              {name !== undefined && <dt>{name}</dt>}
                              <dd>{hc.render(row, i)}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                  </td>
                ) : (
                  <td key={col.key} style={{ textAlign: col.align ?? "left" }}>
                    {col.render(row, i)}
                  </td>
                ),
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // Responsive mode always has a wrapper: it is the element whose width is measured, so it
  // must not grow with the table. `min-width: 0` stops a flex or grid item's default
  // `min-width: auto` from sizing it to its content, and with no `overflow` set it scrolls
  // nothing, so the sticky header survives unless `minWidth` asks for a scroller.
  if (minWidth === undefined) {
    if (!responsive) return table;
    return (
      <div ref={fit.wrapRef} style={{ width: "100%", minWidth: 0 }}>
        {table}
      </div>
    );
  }
  // `tabIndex={0}` is not decoration. A scroll container that is neither focusable nor holds
  // a focusable descendant cannot be scrolled by keyboard at all (WCAG 2.1.1; axe's
  // `scrollable-region-focusable`), and a read-only table has no focusable descendants —
  // rows take a tabIndex only when `onRowClick` is set. Without this, every column past the
  // right edge is reachable with a pointer and by nothing else.
  //
  // `role="region"` only when the caller named the table, because a region without an
  // accessible name is its own violation. The name is mirrored from the caller's own
  // `aria-label` rather than taken as a new prop: the label already reaches the table
  // through `rest`, and inventing a second way to say the same thing under review is how a
  // kit grows two spellings of one idea.
  const label = (rest as { "aria-label"?: string })["aria-label"];
  // Role and name travel together or not at all — an `aria-label` on a roleless element names
  // nothing, and a `region` without a name is its own violation.
  const named = label ? ({ role: "region", "aria-label": label } as const) : {};
  return (
    <div
      ref={responsive ? fit.wrapRef : undefined}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the two requirements point opposite ways here, and a scroll container is the case this rule does not model. axe's `scrollable-region-focusable` REQUIRES the tabIndex, because a container that is neither focusable nor holds a focusable descendant cannot be scrolled by keyboard at all (WCAG 2.1.1) — and a read-only table has no focusable descendants, since rows take a tabIndex only when `onRowClick` is set. Removing this makes every column past the right edge pointer-only.
      tabIndex={0}
      {...named}
      // `max-width: 100%` as well as `overflow-x`, because a flex or grid item's default
      // `min-width: auto` lets it grow to its content and the scroller never engages — the
      // container would widen instead, which is the failure this exists to stop.
      style={
        responsive
          ? { overflowX: "auto", maxWidth: "100%", width: "100%", minWidth: 0 }
          : { overflowX: "auto", maxWidth: "100%" }
      }
    >
      {table}
    </div>
  );
}
