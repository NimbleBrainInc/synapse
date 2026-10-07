import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../ui/components/ConfirmDialog.js";
import { Drawer } from "../../ui/components/Drawer.js";

// happy-dom has no layout, so the browser's report is played by hand: a frame
// 1500px tall whose rows 600 to 1000 are on screen.
type Report = (entries: Partial<IntersectionObserverEntry>[]) => void;
let report: Report | null = null;
let observed: Element[] = [];

class FakeObserver {
  constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
    report = (entries) => cb(entries as IntersectionObserverEntry[]);
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {
    observed = [];
  }
}

function slice(top: number, bottom: number, frame = 1500): Partial<IntersectionObserverEntry> {
  return {
    isIntersecting: bottom > top,
    boundingClientRect: { top: 0, bottom: frame, height: frame } as DOMRectReadOnly,
    intersectionRect: { top, bottom, height: Math.max(0, bottom - top) } as DOMRectReadOnly,
  };
}

function scrimOf(panel: HTMLElement): HTMLElement {
  return panel.parentElement as HTMLElement;
}

function Confirm() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Remove
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Remove?"
        destructive
        onConfirm={() => {}}
      />
    </>
  );
}

beforeEach(() => {
  report = null;
  observed = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("overlays in a frame partly on screen", () => {
  it("test_confirm_dialog_opened_in_scrolled_frame_insets_to_visible_slice", () => {
    render(<Confirm />);
    // Observed from mount, before anything opens, so the slice is known at open.
    expect(observed).toHaveLength(1);
    act(() => report?.([slice(600, 1000)]));

    act(() => screen.getByText("Remove").click());
    const scrim = scrimOf(screen.getByRole("alertdialog"));
    expect(scrim.style.getPropertyValue("--nb-slice-top")).toBe("600px");
    expect(scrim.style.getPropertyValue("--nb-slice-bottom")).toBe("500px");
  });

  it("test_open_overlay_host_scrolls_follows_slice", () => {
    render(<Confirm />);
    act(() => report?.([slice(600, 1000)]));
    act(() => screen.getByText("Remove").click());
    act(() => report?.([slice(800, 1200)]));
    const scrim = scrimOf(screen.getByRole("alertdialog"));
    expect(scrim.style.getPropertyValue("--nb-slice-top")).toBe("800px");
    expect(scrim.style.getPropertyValue("--nb-slice-bottom")).toBe("300px");
  });

  it("test_whole_frame_visible_insets_zero", () => {
    render(<Confirm />);
    act(() => report?.([slice(0, 1500)]));
    act(() => screen.getByText("Remove").click());
    const scrim = scrimOf(screen.getByRole("alertdialog"));
    expect(scrim.style.getPropertyValue("--nb-slice-top")).toBe("0px");
    expect(scrim.style.getPropertyValue("--nb-slice-bottom")).toBe("0px");
  });

  it("test_frame_off_screen_insets_zero", () => {
    render(<Confirm />);
    act(() => report?.([slice(0, 0)]));
    act(() => screen.getByText("Remove").click());
    const scrim = scrimOf(screen.getByRole("alertdialog"));
    expect(scrim.style.getPropertyValue("--nb-slice-top")).toBe("0px");
  });

  it("test_drawer_opened_in_scrolled_frame_insets_to_visible_slice", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header title="Lead" />
      </Drawer>,
    );
    act(() => report?.([slice(600, 1000)]));
    const scrim = scrimOf(screen.getByRole("dialog"));
    expect(scrim.style.getPropertyValue("--nb-slice-top")).toBe("600px");
    expect(scrim.style.getPropertyValue("--nb-slice-bottom")).toBe("500px");
  });

  it("test_last_overlay_unmounts_sentinel_removed", () => {
    const { unmount } = render(<Confirm />);
    expect(document.querySelector("[data-nb-slice-sentinel]")).not.toBeNull();
    unmount();
    expect(document.querySelector("[data-nb-slice-sentinel]")).toBeNull();
    expect(observed).toHaveLength(0);
  });

  it("test_no_intersection_observer_lays_out_as_before", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Confirm />);
    act(() => screen.getByText("Remove").click());
    const scrim = scrimOf(screen.getByRole("alertdialog"));
    expect(scrim.style.getPropertyValue("--nb-slice-top")).toBe("0px");
    expect(document.querySelector("[data-nb-slice-sentinel]")).toBeNull();
  });

  it("pads both scrims by the slice insets", () => {
    render(<Confirm />);
    act(() => screen.getByText("Remove").click());
    const confirmRules = document.getElementById("nb-synapse-confirm-dialog")?.textContent ?? "";
    expect(confirmRules).toContain("calc(1rem + var(--nb-slice-top, 0px))");
    expect(confirmRules).toContain("calc(1rem + var(--nb-slice-bottom, 0px))");
    render(<Drawer open onClose={() => {}} />);
    const drawerRules = document.getElementById("nb-synapse-drawer")?.textContent ?? "";
    expect(drawerRules).toContain("padding-top: var(--nb-slice-top, 0px)");
    expect(drawerRules).toContain("padding-bottom: var(--nb-slice-bottom, 0px)");
  });
});
