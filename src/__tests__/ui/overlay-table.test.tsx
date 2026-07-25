import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "../../ui/components/Drawer.js";
import { type Column, Table } from "../../ui/components/Table.js";

afterEach(cleanup);

describe("Drawer", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <Drawer open={false} onClose={() => {}}>
        body
      </Drawer>,
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("is a plain <div> overlay, never a native <dialog> (the app iframe sandbox withholds allow-modals, so <dialog>.showModal() would throw)", () => {
    const { container } = render(
      <Drawer open onClose={() => {}}>
        <Drawer.Body>Details</Drawer.Body>
      </Drawer>,
    );
    expect(container.querySelector("dialog")).toBeNull();
    const panel = screen.getByRole("dialog");
    expect(panel.tagName).toBe("DIV");
    expect(panel.getAttribute("aria-modal")).toBe("true");
  });

  it("shows content when open and closes on scrim click + close button (but not on a panel click)", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Drawer open onClose={onClose}>
        <Drawer.Header onClose={onClose}>Deal</Drawer.Header>
        <Drawer.Body>Details</Drawer.Body>
      </Drawer>,
    );
    expect(screen.getByText("Details")).toBeDefined();

    // scrim click — target is the scrim itself, not the panel — dismisses
    const scrim = container.querySelector(".nb-drawer-scrim");
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim as Element);
    expect(onClose).toHaveBeenCalledTimes(1);

    // a click inside the panel does NOT dismiss
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);

    // header close button
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("routes Escape to onEscape, leaving onClose for the scrim/button", () => {
    const onClose = vi.fn();
    const onEscape = vi.fn();
    render(
      <Drawer open onClose={onClose} onEscape={onEscape}>
        <Drawer.Body>Details</Drawer.Body>
      </Drawer>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
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
    render(
      <Drawer open side="bottom" onClose={() => {}}>
        <Drawer.Body>Sheet</Drawer.Body>
      </Drawer>,
    );
    expect(screen.getByRole("dialog").className).toContain("nb-drawer--bottom");
  });

  it("does not set aria-labelledby when the header uses plain children (no title)", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>Deal</Drawer.Header>
      </Drawer>,
    );
    expect(screen.getByRole("dialog").getAttribute("aria-labelledby")).toBeNull();
  });

  it("traps Tab from the last focusable back to the first", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
        </Drawer.Body>
      </Drawer>,
    );
    // DOM order: [Close (header), A, B]. first = Close, last = B.
    const close = screen.getByLabelText("Close");
    const last = screen.getByText("B");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("traps Shift+Tab from the first focusable to the last", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
        </Drawer.Body>
      </Drawer>,
    );
    const close = screen.getByLabelText("Close"); // first
    const last = screen.getByText("B"); // last
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("keeps focus on the panel when it holds nothing tabbable", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Body>just text, nothing focusable</Drawer.Body>
      </Drawer>,
    );
    const panel = screen.getByRole("dialog");
    fireEvent.keyDown(panel, { key: "Tab" });
    expect(document.activeElement).toBe(panel);
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
