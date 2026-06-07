import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "../../ui/components/Drawer.js";
import { type Column, Table } from "../../ui/components/Table.js";

afterEach(cleanup);

describe("Drawer", () => {
  it("renders the dialog closed (not open) when open is false", () => {
    const { container } = render(
      <Drawer open={false} onClose={() => {}}>
        body
      </Drawer>,
    );
    const dialog = container.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.hasAttribute("open")).toBe(false);
  });

  it("shows content when open and closes on backdrop + close button", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        <Drawer.Header onClose={onClose}>Deal</Drawer.Header>
        <Drawer.Body>Details</Drawer.Body>
      </Drawer>,
    );
    const dialog = screen.getByRole("dialog");
    expect(screen.getByText("Details")).toBeDefined();

    // backdrop click — a click whose target is the dialog itself
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);

    // header close button
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("routes the dialog's cancel (Escape) to onEscape, leaving onClose for backdrop/button", () => {
    const onClose = vi.fn();
    const onEscape = vi.fn();
    render(
      <Drawer open onClose={onClose} onEscape={onEscape}>
        <Drawer.Body>Details</Drawer.Body>
      </Drawer>,
    );
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

interface Row {
  id: string;
  name: string;
  value: number;
}
const COLS: Column<Row>[] = [
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "value", header: "Value", align: "right", render: (r) => `$${r.value}` },
];
const ROWS: Row[] = [
  { id: "a", name: "Acme", value: 100 },
  { id: "b", name: "Globex", value: 200 },
];

describe("Table", () => {
  it("renders headers and rows from declarative columns", () => {
    render(<Table data={ROWS} columns={COLS} rowKey={(r) => r.id} />);
    expect(screen.getByText("Name")).toBeDefined();
    expect(screen.getByText("Acme")).toBeDefined();
    expect(screen.getByText("$200")).toBeDefined();
    expect(screen.getAllByRole("row")).toHaveLength(3); // 1 header + 2 body
  });

  it("fires onRowClick by mouse and keyboard", () => {
    const onRowClick = vi.fn();
    render(<Table data={ROWS} columns={COLS} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText("Acme"));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0], 0);
    const globexRow = screen.getByText("Globex").closest("tr") as HTMLElement;
    fireEvent.keyDown(globexRow, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1], 1);
  });

  it("renders the empty slot when there is no data", () => {
    render(<Table data={[]} columns={COLS} rowKey={(r) => r.id} empty={<div>Nothing here</div>} />);
    expect(screen.getByText("Nothing here")).toBeDefined();
  });
});
