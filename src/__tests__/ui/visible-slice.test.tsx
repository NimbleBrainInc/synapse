import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../ui/components/ConfirmDialog.js";
import { Drawer } from "../../ui/components/Drawer.js";

// happy-dom has no layout, so the browser's report is played by hand: a frame
// 1500px tall whose rows 600 to 1000 are on screen. Each observer is kept, so a test
// can see which element it watches and deliver its first report.
class FakeObserver {
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly cb: (entries: IntersectionObserverEntry[]) => void) {
    observers.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  report(entry: Partial<IntersectionObserverEntry>) {
    if (!this.disconnected) this.cb([entry as IntersectionObserverEntry]);
  }
}
let observers: FakeObserver[] = [];
const latest = () => observers.at(-1) as FakeObserver;

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
  observers = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const insets = (scrim: HTMLElement) => [
  scrim.style.getPropertyValue("--nb-slice-top"),
  scrim.style.getPropertyValue("--nb-slice-bottom"),
];

describe("overlays in a frame partly on screen", () => {
  it("test_confirm_dialog_opened_in_scrolled_frame_insets_to_visible_slice", () => {
    render(<Confirm />);
    expect(observers).toHaveLength(0);
    act(() => screen.getByText("Remove").click());
    const scrim = scrimOf(screen.getByRole("alertdialog"));
    expect(latest().observed).toEqual([scrim]);
    act(() => latest().report(slice(600, 1000)));
    expect(insets(scrim)).toEqual(["600px", "500px"]);
  });

  // An observer reports again only when the visible fraction crosses a threshold,
  // and scrolling a tall frame through its middle keeps the fraction fixed: a
  // long-lived observer never hears about it. Each open measures with a new one.
  it("test_reopen_after_constant_share_scroll_measures_new_slice", () => {
    render(<Confirm />);
    act(() => screen.getByText("Remove").click());
    const first = latest();
    act(() => first.report(slice(600, 1000)));
    act(() => screen.getByText("Cancel").click());
    expect(first.disconnected).toBe(true);

    act(() => screen.getByText("Remove").click());
    expect(latest()).not.toBe(first);
    act(() => latest().report(slice(800, 1200)));
    expect(insets(scrimOf(screen.getByRole("alertdialog")))).toEqual(["800px", "300px"]);
  });

  it("test_first_report_disconnects_observer", () => {
    render(<Confirm />);
    act(() => screen.getByText("Remove").click());
    act(() => latest().report(slice(600, 1000)));
    expect(latest().disconnected).toBe(true);
  });

  it("test_whole_frame_visible_insets_zero", () => {
    render(<Confirm />);
    act(() => screen.getByText("Remove").click());
    act(() => latest().report(slice(0, 1500)));
    expect(insets(scrimOf(screen.getByRole("alertdialog")))).toEqual(["0px", "0px"]);
  });

  it("test_frame_off_screen_leaves_insets_unset", () => {
    render(<Confirm />);
    act(() => screen.getByText("Remove").click());
    act(() => latest().report(slice(0, 0)));
    expect(insets(scrimOf(screen.getByRole("alertdialog")))).toEqual(["", ""]);
  });

  it("test_drawer_opened_in_scrolled_frame_insets_to_visible_slice", () => {
    render(
      <Drawer open onClose={() => {}}>
        <Drawer.Header title="Lead" />
      </Drawer>,
    );
    act(() => latest().report(slice(600, 1000)));
    expect(insets(scrimOf(screen.getByRole("dialog")))).toEqual(["600px", "500px"]);
  });

  it("test_no_intersection_observer_lays_out_as_before", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Confirm />);
    act(() => screen.getByText("Remove").click());
    expect(insets(scrimOf(screen.getByRole("alertdialog")))).toEqual(["", ""]);
  });

  // Until the slice report places it, the panel may sit off screen; a scrolling
  // focus would drag the host page there.
  it("test_initial_focus_does_not_scroll", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<Confirm />);
    act(() => screen.getByText("Remove").click());
    const cancel = screen.getByText("Cancel");
    expect(document.activeElement).toBe(cancel);
    const call = focus.mock.calls.at(-1);
    expect(focus.mock.contexts.at(-1)).toBe(cancel);
    expect(call?.[0]).toEqual({ preventScroll: true });
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
