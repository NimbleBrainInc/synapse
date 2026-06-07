import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "../../ui/components/Drawer.js";
import { type Column, Table } from "../../ui/components/Table.js";

afterEach(cleanup);

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <Drawer open={false} onClose={() => {}}>
        body
      </Drawer>,
    );
    expect(container.querySelector(".nb-drawerlay")).toBeNull();
  });

  it("renders a modal dialog when open and closes on scrim + Escape", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        <Drawer.Header onClose={onClose}>Deal</Drawer.Header>
        <Drawer.Body>Details</Drawer.Body>
      </Drawer>,
    );
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Details")).toBeDefined();

    // scrim (first "Close" label) dismisses
    fireEvent.click(screen.getAllByLabelText("Close")[0] as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("routes Escape to onEscape when provided, leaving onClose for scrim/X", () => {
    const onClose = vi.fn();
    const onEscape = vi.fn();
    render(
      <Drawer open onClose={onClose} onEscape={onEscape}>
        <Drawer.Body>Details</Drawer.Body>
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
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
