import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "../../ui/layouts/AppFrame.js";
import { SidebarLayout, useSidebar } from "../../ui/layouts/SidebarLayout.js";

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
