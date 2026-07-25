import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
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
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    last.dispatchEvent(ev);
    expect(document.activeElement).toBe(close);
    // preventDefault cancels the browser's native traversal that would otherwise
    // run after the handler and land focus one element past the wrap target.
    expect(ev.defaultPrevented).toBe(true);
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
    const ev = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    close.dispatchEvent(ev);
    expect(document.activeElement).toBe(last);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("prevents Tab when the panel holds nothing tabbable", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Body>just text, nothing focusable</Drawer.Body>
      </Drawer>,
    );
    const panel = screen.getByRole("dialog");
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    panel.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("excludes a trailing hidden input from the tab boundary", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
          <input type="hidden" defaultValue="csrf" />
        </Drawer.Body>
      </Drawer>,
    );
    // The hidden input is not tabbable, so `B` is the real last — Tab from it wraps.
    const close = screen.getByLabelText("Close"); // first
    const b = screen.getByText("B"); // last tabbable
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("excludes a disabled control with an explicit tabindex from the boundary", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
          <button type="button" disabled tabIndex={0}>
            D
          </button>
        </Drawer.Body>
      </Drawer>,
    );
    // The disabled control isn't tabbable despite its tabindex, so `B` is the real
    // last — Tab from it wraps to the first.
    const close = screen.getByLabelText("Close");
    const b = screen.getByText("B");
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("traps Shift+Tab from the panel itself to the last focusable", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
        </Drawer.Body>
      </Drawer>,
    );
    const panel = screen.getByRole("dialog");
    const last = screen.getByText("B");
    // The open effect leaves focus on the panel — the state a keyboard user is in
    // on the first keystroke after the Drawer opens.
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("excludes a trailing [hidden] control from the boundary", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
          <input type="file" hidden />
        </Drawer.Body>
      </Drawer>,
    );
    // The [hidden] input isn't tabbable, so `B` is the real last — Tab from it wraps.
    const close = screen.getByLabelText("Close");
    const b = screen.getByText("B");
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  // The trap must stay OUT of the way off-boundary: only wrap at the edges, only
  // on Tab. These pin the guards (not just the branches that fire).
  it("leaves a mid-panel Tab to the browser (no wrap)", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
        </Drawer.Body>
      </Drawer>,
    );
    const a = screen.getByText("A"); // middle of [Close, A, B]
    a.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(a);
  });

  it("leaves a mid-panel Shift+Tab to the browser (no jump to last)", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
        </Drawer.Body>
      </Drawer>,
    );
    const a = screen.getByText("A");
    a.focus();
    const ev = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(a);
  });

  it("ignores non-Tab keys at the boundary (typing isn't hijacked)", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
        </Drawer.Body>
      </Drawer>,
    );
    const b = screen.getByText("B"); // the last/boundary element
    b.focus();
    const ev = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    b.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(b);
  });

  it("excludes a trailing tabindex=-1 control from the boundary", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
          <button type="button" tabIndex={-1}>
            D
          </button>
        </Drawer.Body>
      </Drawer>,
    );
    // tabindex="-1" isn't tabbable, so `B` is the real last — Tab from it wraps.
    const close = screen.getByLabelText("Close");
    const b = screen.getByText("B");
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("excludes a leading tabindex=-1 control from the boundary", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Body>
          <button type="button" tabIndex={-1}>
            L
          </button>
          <button type="button">A</button>
          <button type="button">B</button>
        </Drawer.Body>
      </Drawer>,
    );
    // The leading tabindex="-1" isn't tabbable, so `A` is the real first —
    // Shift+Tab from it wraps to the last (B).
    const a = screen.getByText("A");
    const b = screen.getByText("B");
    a.focus();
    const ev = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    a.dispatchEvent(ev);
    expect(document.activeElement).toBe(b);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("excludes a trailing negative tabindex (not only the literal -1) from the boundary", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
          <button type="button" tabIndex={-2}>
            D
          </button>
        </Drawer.Body>
      </Drawer>,
    );
    // Any negative tabindex is non-tabbable, so `B` is the real last — Tab wraps.
    const close = screen.getByLabelText("Close");
    const b = screen.getByText("B");
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("excludes a control under a [hidden] ancestor from the boundary", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
          <div hidden>
            <button type="button">D</button>
          </div>
        </Drawer.Body>
      </Drawer>,
    );
    // The button inherits [hidden] from its ancestor, so it isn't tabbable — `B`
    // is the real last. (A per-element check would miss this and make D the false last.)
    const close = screen.getByLabelText("Close");
    const b = screen.getByText("B");
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("scopes the Tab trap to the panel — a Tab dispatched outside it is not hijacked", () => {
    render(
      <>
        <button type="button">outside</button>
        <Drawer open onClose={() => {}}>
          <Drawer.Header onClose={() => {}}>H</Drawer.Header>
          <Drawer.Body>
            <button type="button">A</button>
            <button type="button">B</button>
          </Drawer.Body>
        </Drawer>
      </>,
    );
    const outside = screen.getByText("outside");
    const b = screen.getByText("B"); // the real last, inside the panel
    b.focus();
    expect(document.activeElement).toBe(b);
    // The listener is bound to the panel, not document, so a Tab that never bubbles
    // through the panel is left alone. A document-scoped listener would see
    // active===last and wrap to first — the round-2 regression (hijacking portal'd
    // overlays / fighting a second Drawer) this pins against.
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    outside.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(b);
  });

  it("excludes a control buried in a closed <details> from the boundary", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <button type="button">B</button>
          <details>
            <summary>Advanced</summary>
            <button type="button">D</button>
          </details>
        </Drawer.Body>
      </Drawer>,
    );
    // The collapsed <details> hides D (a UA display:none), so it isn't reachable —
    // `B` is the real last. (Its tabIndex is still 0, so a tabIndex-only check
    // would make the unreachable D the false last and let Tab escape.)
    const close = screen.getByLabelText("Close");
    const b = screen.getByText("B");
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("includes controls in an OPEN <details> (the exclusion is scoped to closed)", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header onClose={() => {}}>H</Drawer.Header>
        <Drawer.Body>
          <button type="button">A</button>
          <details open>
            <summary>Advanced</summary>
            <button type="button">D</button>
          </details>
        </Drawer.Body>
      </Drawer>,
    );
    // Open <details> reveals D, so it's reachable and is the real last — Tab wraps.
    // Pins that the exclusion keys on `:not([open])`, not any <details> at all.
    // (The closed-<details> `<summary>` stays a boundary too, but happy-dom reports
    // summary.tabIndex === -1, so that half needs a browser test.)
    const close = screen.getByLabelText("Close");
    const d = screen.getByText("D");
    d.focus();
    fireEvent.keyDown(d, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  // CANDIDATES is net-new here; the exclusion side is covered exhaustively above,
  // but every one of those tests admits a <button>. Pin that each element *kind*
  // is counted as a boundary, so dropping a clause can't silently under-count.
  it("counts every candidate element kind as the boundary, not only <button>", () => {
    const kinds: Array<[string, ReactElement]> = [
      [
        "a[href]",
        <a key="k" href="#x" data-testid="trailing">
          L
        </a>,
      ],
      ["input", <input key="k" type="text" data-testid="trailing" />],
      [
        "select",
        <select key="k" data-testid="trailing">
          <option>o</option>
        </select>,
      ],
      ["textarea", <textarea key="k" data-testid="trailing" />],
      [
        "[tabindex]",
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a bare [tabindex] element is exactly the CANDIDATES clause under test
        <div key="k" tabIndex={0} data-testid="trailing">
          T
        </div>,
      ],
      // <summary> is a candidate too, but happy-dom reports summary.tabIndex === -1
      // (Chrome: 0), so it can't be pinned in this fixture — needs a browser test.
    ];
    for (const [name, trailing] of kinds) {
      const { unmount } = render(
        <Drawer open onClose={() => {}}>
          <Drawer.Header onClose={() => {}}>H</Drawer.Header>
          <Drawer.Body>
            <button type="button">A</button>
            {trailing}
          </Drawer.Body>
        </Drawer>,
      );
      const close = screen.getByLabelText("Close");
      const last = screen.getByTestId("trailing");
      last.focus();
      fireEvent.keyDown(last, { key: "Tab" });
      expect(document.activeElement, `${name} as trailing boundary`).toBe(close);
      unmount();
    }
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
