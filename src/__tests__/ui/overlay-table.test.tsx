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

  it("Header title renders an h2 and names the dialog via aria-labelledby", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header title="Deal X" onClose={() => {}} />
        <Drawer.Body>Details</Drawer.Body>
      </Drawer>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Deal X" });
    expect(heading.id).toBeTruthy();
    expect(screen.getByRole("dialog").getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("Header onBack renders a Back button that fires the callback", () => {
    const onBack = vi.fn();
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header title="Contact" onBack={onBack} onClose={() => {}} />
      </Drawer>,
    );
    fireEvent.click(screen.getByLabelText("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("Header renders the actions slot and applies coarse-pointer hit-target class to icon buttons", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header
          title="Deal"
          actions={<button type="button">Edit</button>}
          onBack={() => {}}
          onClose={() => {}}
        />
      </Drawer>,
    );
    expect(screen.getByText("Edit")).toBeDefined();
    expect(screen.getByLabelText("Back").className).toContain("nb-drawer-iconbtn");
    expect(screen.getByLabelText("Close").className).toContain("nb-drawer-iconbtn");
  });

  it("side=bottom applies the bottom-sheet modifier class", () => {
    const { container } = render(
      <Drawer open side="bottom" onClose={() => {}}>
        <Drawer.Body>Sheet</Drawer.Body>
      </Drawer>,
    );
    expect(container.querySelector("dialog")?.className).toContain("nb-drawer--bottom");
  });

  it("does not set aria-labelledby when the header uses plain children (no title)", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>Deal</Drawer.Header>
      </Drawer>,
    );
    expect(screen.getByRole("dialog").getAttribute("aria-labelledby")).toBeNull();
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
