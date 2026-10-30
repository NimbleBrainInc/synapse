/**
 * `Table` responsive mode, as far as a test DOM can see it.
 *
 * happy-dom has no layout engine: every width it reports is zero, so whether a table fits,
 * and which column a real browser would hide, are not observable here. Those claims are the
 * layout suite's (`layout/`, real Chromium). What this file holds is the logic around the
 * measurement: which tables opt in, which columns may hide, in what order, and what a hidden
 * column leaves behind. To drive the logic it stands in for the browser's measurement with a
 * stubbed `getBoundingClientRect`: each header cell is 100px wide, and the wrapper is as wide
 * as the test says.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Column, Table } from "../../ui/components/Table.js";

interface Row {
  id: string;
  name: string;
  a: string;
  b: string;
  c: string;
}
const ROWS: Row[] = [{ id: "1", name: "Acme", a: "A-1", b: "B-1", c: "C-1" }];

const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "a", header: "Alpha", priority: 1, render: (r) => r.a },
  { key: "b", header: <em>Beta</em>, label: "Beta", priority: 2, render: (r) => r.b },
  { key: "c", header: "Gamma", priority: 3, render: (r) => r.c },
  { key: "act", header: "Act", render: () => "go" },
];

const headers = (container: HTMLElement) =>
  [...container.querySelectorAll("thead th")].map((th) => th.textContent);

let wrapperWidth = 10_000;
const PER_COLUMN = 100;

beforeEach(() => {
  wrapperWidth = 10_000;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    let width = 0;
    if (this.tagName === "TABLE") width = this.querySelectorAll("thead th").length * PER_COLUMN;
    else if (this.tagName === "DIV" && this.querySelector(":scope > table")) width = wrapperWidth;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("responsive mode is opt-in", () => {
  it("stays in fixed mode when no column declares a priority, even when it would not fit", () => {
    wrapperWidth = 50;
    const columns = COLUMNS.map(({ priority: _p, ...col }) => col);
    const { container } = render(
      <Table
        data={ROWS}
        rowKey={(r) => r.id}
        columns={[{ ...columns[0], width: 200 }, ...columns.slice(1)]}
      />,
    );
    const table = container.querySelector("table") as HTMLTableElement;
    expect(container.firstElementChild).toBe(table);
    expect(table.className).toBe("nb-table");
    expect(table.style.tableLayout).toBe("fixed");
    expect(headers(container)).toEqual(["Name", "Alpha", "Beta", "Gamma", "Act"]);
  });

  it("turns on when any column declares a priority, and a width no longer means fixed layout", () => {
    const { container } = render(
      <Table
        data={ROWS}
        rowKey={(r) => r.id}
        columns={[{ ...(COLUMNS[0] as Column<Row>), width: 180 }, ...COLUMNS.slice(1)]}
      />,
    );
    const table = container.querySelector("table") as HTMLTableElement;
    expect(table.classList.contains("nb-table--fit")).toBe(true);
    // Auto layout: the primary column takes the slack and the others size to content.
    expect(table.style.tableLayout).toBe("");
    // The measured wrapper must not grow with its content (the flex `min-width: auto` trap).
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.style.minWidth).toBe("0");
    // The width on the primary column is its readable minimum, not its width.
    const primaryHead = container.querySelector("thead th") as HTMLElement;
    expect(primaryHead.classList.contains("nb-table__primary")).toBe(true);
    expect(primaryHead.style.minWidth).toBe("180px");
    expect(primaryHead.style.width).toBe("");
  });

  it("gives the primary column the rules that make it grow and truncate", () => {
    render(<Table data={ROWS} rowKey={(r) => r.id} columns={COLUMNS} />);
    const css = document.getElementById("nb-synapse-table")?.textContent ?? "";
    expect(css).toMatch(/\.nb-table--fit \.nb-table__primary \{[^}]*width: 100%; max-width: 0;/);
    expect(css).toMatch(/\.nb-table--fit th, \.nb-table--fit td \{ white-space: nowrap; \}/);
  });
});

describe("header titles", () => {
  it("uses the label, else a string header, else nothing", () => {
    const { container } = render(
      <Table
        data={ROWS}
        rowKey={(r) => r.id}
        columns={[...COLUMNS, { key: "x", header: <b>X</b>, render: () => "x" }]}
      />,
    );
    const titles = [...container.querySelectorAll("thead th")].map((th) =>
      th.getAttribute("title"),
    );
    expect(titles).toEqual(["Name", "Alpha", "Beta", "Gamma", "Act", null]);
  });
});

describe("hiding columns that do not fit", () => {
  it("shows every column when they fit", () => {
    const { container } = render(<Table data={ROWS} rowKey={(r) => r.id} columns={COLUMNS} />);
    expect(headers(container)).toEqual(["Name", "Alpha", "Beta", "Gamma", "Act"]);
    expect(container.querySelector(".nb-table__hidden")).toBeNull();
  });

  it("hides the highest priority number first, until the table fits", () => {
    wrapperWidth = 350; // three columns fit
    const { container } = render(<Table data={ROWS} rowKey={(r) => r.id} columns={COLUMNS} />);
    expect(headers(container)).toEqual(["Name", "Alpha", "Act"]);
  });

  it("hides the rightmost first on a tie", () => {
    wrapperWidth = 450;
    const tied = COLUMNS.map((c) => (c.priority !== undefined ? { ...c, priority: 2 } : c));
    const { container } = render(<Table data={ROWS} rowKey={(r) => r.id} columns={tied} />);
    expect(headers(container)).toEqual(["Name", "Alpha", "Beta", "Act"]);
  });

  it("never hides a column without a priority, nor the first column", () => {
    wrapperWidth = 10; // nothing fits
    const firstHasPriority = [{ ...(COLUMNS[0] as Column<Row>), priority: 9 }, ...COLUMNS.slice(1)];
    const { container } = render(
      <Table data={ROWS} rowKey={(r) => r.id} columns={firstHasPriority} />,
    );
    expect(headers(container)).toEqual(["Name", "Act"]);
  });

  it("moves each hidden value under the primary cell, named and in column order", () => {
    wrapperWidth = 350;
    const { container } = render(<Table data={ROWS} rowKey={(r) => r.id} columns={COLUMNS} />);
    const primary = container.querySelector("tbody td") as HTMLElement;
    expect(primary.classList.contains("nb-table__primary")).toBe(true);
    expect(primary.querySelector(".nb-table__primary-main")?.textContent).toBe("Acme");
    const list = primary.querySelector("dl.nb-table__hidden") as HTMLElement;
    const pairs = [...list.children].map((pair) => [
      pair.querySelector("dt")?.textContent,
      pair.querySelector("dd")?.textContent,
    ]);
    // `label` names a column whose header is not text.
    expect(pairs).toEqual([
      ["Beta", "B-1"],
      ["Gamma", "C-1"],
    ]);
    // A hidden column has no cell of its own, so its value is in the row exactly once.
    expect(screen.getAllByText("B-1")).toHaveLength(1);
    expect(container.querySelectorAll("tbody td")).toHaveLength(3);
  });

  it("names nothing for a hidden column with neither a label nor a text header", () => {
    wrapperWidth = 150; // two 100px columns do not fit
    const columns: Column<Row>[] = [
      COLUMNS[0] as Column<Row>,
      { key: "c", header: <i>c</i>, priority: 1, render: (r) => r.c },
    ];
    const again = render(<Table data={ROWS} rowKey={(r) => r.id} columns={columns} />);
    const pair = again.container.querySelector("dl.nb-table__hidden > div") as HTMLElement;
    expect(pair.querySelector("dt")).toBeNull();
    expect(pair.querySelector("dd")?.textContent).toBe("C-1");
  });

  it("applies minWidth only once nothing more can hide", () => {
    wrapperWidth = 450;
    const partly = render(
      <Table data={ROWS} rowKey={(r) => r.id} columns={COLUMNS} minWidth={720} />,
    );
    expect(headers(partly.container)).toEqual(["Name", "Alpha", "Beta", "Act"]);
    expect(partly.container.querySelector("table")?.style.minWidth).toBe("");
    cleanup();
    wrapperWidth = 10;
    const fully = render(
      <Table data={ROWS} rowKey={(r) => r.id} columns={COLUMNS} minWidth={720} />,
    );
    expect(headers(fully.container)).toEqual(["Name", "Act"]);
    expect(fully.container.querySelector("table")?.style.minWidth).toBe("720px");
    const scroller = fully.container.firstElementChild as HTMLElement;
    expect(scroller.style.overflowX).toBe("auto");
    expect(scroller.tabIndex).toBe(0);
  });
});

describe("without a ResizeObserver", () => {
  it("renders every column, as useBreakpoint does without one", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    wrapperWidth = 10;
    const { container } = render(<Table data={ROWS} rowKey={(r) => r.id} columns={COLUMNS} />);
    expect(headers(container)).toEqual(["Name", "Alpha", "Beta", "Gamma", "Act"]);
  });
});
