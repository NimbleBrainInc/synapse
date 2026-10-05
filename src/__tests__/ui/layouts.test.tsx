import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "../../ui/layouts/AppFrame.js";
import { ListDetailLayout, useListDetail } from "../../ui/layouts/ListDetailLayout.js";
import { SidebarLayout, useSidebar } from "../../ui/layouts/SidebarLayout.js";
import { tokens } from "../../ui/tokens.js";

// happy-dom has no ResizeObserver; mock one that reports a controllable width
// synchronously on observe, so the layouts' responsive branch can be tested.
let mockWidth = 1000;
class MockResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe() {
    this.cb(
      [{ contentRect: { width: mockWidth } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  mockWidth = 1000;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
});
afterEach(() => {
  cleanup();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = undefined;
});

describe("AppFrame", () => {
  it("renders header, body, and footer slots", () => {
    render(
      <AppFrame>
        <AppFrame.Header>Header</AppFrame.Header>
        <AppFrame.Body>Body</AppFrame.Body>
        <AppFrame.Footer>Footer</AppFrame.Footer>
      </AppFrame>,
    );
    expect(screen.getByText("Header")).toBeDefined();
    expect(screen.getByText("Body")).toBeDefined();
    expect(screen.getByText("Footer")).toBeDefined();
  });

  it("establishes the root-height chain on render so the shell can't collapse", () => {
    document.getElementById("nb-synapse-base")?.remove();
    render(
      <AppFrame>
        <AppFrame.Body>Body</AppFrame.Body>
      </AppFrame>,
    );
    // Without a definite-height ancestor chain, AppFrame's `height: 100%` would
    // collapse to content height inside the host pane (issue #22). Rendering it
    // must supply the chain, with no per-app `index.html` requirement.
    const reset = document.getElementById("nb-synapse-base");
    expect(reset?.textContent).toContain("height: 100%");
  });
});

describe("SidebarLayout", () => {
  it("shows rail + main side-by-side when wide, with no drawer trigger", () => {
    mockWidth = 1000;
    render(
      <SidebarLayout collapseMode="drawer" breakpoint={640}>
        <SidebarLayout.Trigger />
        <SidebarLayout.Sidebar>Nav</SidebarLayout.Sidebar>
        <SidebarLayout.Main>Main</SidebarLayout.Main>
      </SidebarLayout>,
    );
    expect(screen.getByText("Nav")).toBeDefined();
    expect(screen.getByText("Main")).toBeDefined();
    // not collapsed → no hamburger
    expect(screen.queryByLabelText("Toggle sidebar")).toBeNull();
  });

  it("reveals a drawer trigger when narrow and toggles the drawer open", () => {
    mockWidth = 400;
    render(
      <SidebarLayout collapseMode="drawer" breakpoint={640}>
        <SidebarLayout.Trigger />
        <SidebarLayout.Sidebar>Nav</SidebarLayout.Sidebar>
        <SidebarLayout.Main>Main</SidebarLayout.Main>
      </SidebarLayout>,
    );
    const trigger = screen.getByLabelText("Toggle sidebar");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders no drawer trigger in reflow mode even when narrow", () => {
    mockWidth = 400;
    render(
      <SidebarLayout collapseMode="reflow" breakpoint={640}>
        <SidebarLayout.Trigger />
        <SidebarLayout.Sidebar>Nav</SidebarLayout.Sidebar>
        <SidebarLayout.Main>Main</SidebarLayout.Main>
      </SidebarLayout>,
    );
    expect(screen.getByText("Nav")).toBeDefined();
    expect(screen.queryByLabelText("Toggle sidebar")).toBeNull();
  });

  it("throws if useSidebar is used outside the layout", () => {
    const Probe = () => {
      useSidebar();
      return null;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/useSidebar/);
    spy.mockRestore();
  });
});

describe("ListDetailLayout", () => {
  it("shows list and detail together when wide", () => {
    mockWidth = 1000;
    render(
      <ListDetailLayout selected={false}>
        <ListDetailLayout.List>List</ListDetailLayout.List>
        <ListDetailLayout.Detail>Detail</ListDetailLayout.Detail>
      </ListDetailLayout>,
    );
    expect(screen.getByText("List")).toBeDefined();
    expect(screen.getByText("Detail")).toBeDefined();
  });

  it("shows only the list when narrow and nothing is selected", () => {
    mockWidth = 400;
    render(
      <ListDetailLayout selected={false}>
        <ListDetailLayout.List>List</ListDetailLayout.List>
        <ListDetailLayout.Detail>
          <ListDetailLayout.Back />
          Detail
        </ListDetailLayout.Detail>
      </ListDetailLayout>,
    );
    expect(screen.getByText("List")).toBeDefined();
    expect(screen.queryByText("Detail")).toBeNull();
    expect(screen.queryByText("← Back")).toBeNull();
  });

  it("swaps to the detail with a Back affordance when narrow and selected", () => {
    mockWidth = 400;
    const onBack = vi.fn();
    render(
      <ListDetailLayout selected onBack={onBack}>
        <ListDetailLayout.List>List</ListDetailLayout.List>
        <ListDetailLayout.Detail>
          <ListDetailLayout.Back />
          Detail
        </ListDetailLayout.Detail>
      </ListDetailLayout>,
    );
    expect(screen.queryByText("List")).toBeNull();
    expect(screen.getByText("Detail")).toBeDefined();
    fireEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("throws if useListDetail is used outside the layout", () => {
    const Probe = () => {
      useListDetail();
      return null;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/useListDetail/);
    spy.mockRestore();
  });
});

// The gutter is the kit's: the host hands over an edge-to-edge slot, an app names no spacing,
// and the kit's layouts inset content by one token. happy-dom drops every inline declaration
// holding a `var()`, so what is asserted here is the injected rules, the classes that select
// them, and the literals that survive (CLAUDE.md, "what the test DOM cannot see").
describe("the gutter", () => {
  it("is one token that an override reaches and the frame's width sets", () => {
    expect(tokens.gutter).toBe("var(--nb-gutter, var(--nb-gutter-auto, 1.5rem))");
  });

  it("narrows with the FRAME's width, by container query", () => {
    const { container } = render(
      <AppFrame>
        <AppFrame.Body>Body</AppFrame.Body>
      </AppFrame>,
    );
    expect(container.firstElementChild?.classList.contains("nb-appframe")).toBe(true);
    const rules = document.getElementById("nb-synapse-appframe")?.textContent ?? "";
    expect(rules).toContain("container-type: inline-size");
    expect(rules).toMatch(
      /@container \(max-width: 640px\) \{ \.nb-appframe > \* \{ --nb-gutter-auto: 1rem; \} \}/,
    );
  });

  it("keeps the frame's class when an app adds its own", () => {
    const { container } = render(<AppFrame className="app-root">Body</AppFrame>);
    expect(container.firstElementChild?.className).toBe("nb-appframe app-root");
  });
});

describe("ListDetailLayout's panes inset their own content", () => {
  const panes = (props: { inset?: boolean } = {}) =>
    render(
      <ListDetailLayout selected>
        <ListDetailLayout.List {...props}>List</ListDetailLayout.List>
        <ListDetailLayout.Detail {...props}>Detail</ListDetailLayout.Detail>
      </ListDetailLayout>,
    );

  it("by the gutter, the list less a row's own padding so row text lands on the gutter line", () => {
    panes();
    expect(screen.getByText("List").closest("section")?.className).toContain("nb-ldl-list--inset");
    expect(screen.getByText("Detail").className).toContain("nb-ldl-detail--inset");
    const rules = document.getElementById("nb-synapse-listdetail")?.textContent ?? "";
    expect(rules).toContain(
      `.nb-ldl-list--inset { padding-inline: calc(${tokens.gutter} - 0.75rem); }`,
    );
    expect(rules).toContain(`.nb-ldl-detail--inset { padding-inline: ${tokens.gutter}; }`);
  });

  it("hands the whole width to content that runs edge to edge itself", () => {
    panes({ inset: false });
    expect(screen.getByText("List").closest("section")?.className ?? "").not.toContain("inset");
    expect(screen.getByText("Detail").className).not.toContain("inset");
  });
});
