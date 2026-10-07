/**
 * Keeps an overlay's panel inside the part of the app frame the user can see.
 *
 * A host may size the app's iframe to its content and scroll its own page instead
 * (an inline tool result, a section of a settings page). The frame's viewport is
 * then the whole frame, so a `position: fixed; inset: 0` scrim spans all of it and
 * a panel centred in it lands at the frame's middle, which can be far above or
 * below what is on screen. The frame cannot read the host's scroll position, and
 * the MCP Apps protocol does not report it.
 *
 * `IntersectionObserver` does. With the implicit root, the browser clips a target in
 * a cross-origin frame by every ancestor frame and the top-level viewport, and
 * reports the result in the frame's own coordinates. The target here is a sentinel
 * that is the frame's viewport (`position: fixed; inset: 0`), so its intersection is
 * the visible slice of the frame. Each overlay sets the slice's distance from the
 * frame's top and bottom as `--nb-slice-top` / `--nb-slice-bottom` on its scrim, and
 * pads its content box by them: the scrim still covers and blocks the whole frame,
 * and the panel is laid out in the slice.
 *
 * The sentinel is observed from the moment an overlay mounts, not when it opens,
 * because the first report arrives a frame after observing starts. By the time an
 * overlay opens the slice is known, so the panel is placed before paint and before
 * `useModal` focuses into it; a panel placed off screen would make that focus scroll
 * the host page. Reports keep arriving while an overlay is open, so the panel follows
 * the host page when it scrolls under the scrim.
 *
 * A report arrives only when the visible fraction crosses a threshold. `THRESHOLDS`
 * is every half percent, so on a 1500px frame the slice is current to within about
 * 8px, which the panels' own 1rem margin absorbs.
 *
 * Where the whole frame is visible, or no report has arrived, or the engine has no
 * `IntersectionObserver`, the variables are 0 and the overlays lay out as before.
 */

import { type RefObject, useLayoutEffect } from "react";

interface Slice {
  top: number;
  bottom: number;
}

const FULL: Slice = { top: 0, bottom: 0 };
const THRESHOLDS = Array.from({ length: 201 }, (_, i) => i / 200);

let current: Slice = FULL;
let sentinel: HTMLElement | null = null;
let observer: IntersectionObserver | null = null;
let mounted = 0;
const scrims = new Set<HTMLElement>();

function apply(scrim: HTMLElement, slice: Slice): void {
  scrim.style.setProperty("--nb-slice-top", `${slice.top}px`);
  scrim.style.setProperty("--nb-slice-bottom", `${slice.bottom}px`);
}

function onReport(entries: IntersectionObserverEntry[]): void {
  const entry = entries.at(-1);
  if (!entry) return;
  const frame = entry.boundingClientRect;
  const seen = entry.intersectionRect;
  // Not on screen at all: nothing better to place against than the whole frame.
  current =
    entry.isIntersecting && seen.height > 0
      ? {
          top: Math.max(0, seen.top - frame.top),
          bottom: Math.max(0, frame.bottom - seen.bottom),
        }
      : FULL;
  for (const scrim of scrims) apply(scrim, current);
}

function retain(): void {
  mounted += 1;
  if (observer || typeof IntersectionObserver !== "function") return;
  sentinel = document.createElement("div");
  sentinel.setAttribute("aria-hidden", "true");
  sentinel.setAttribute("data-nb-slice-sentinel", "");
  sentinel.style.cssText =
    "position: fixed; inset: 0; visibility: hidden; pointer-events: none; z-index: -1;";
  document.body.appendChild(sentinel);
  observer = new IntersectionObserver(onReport, { threshold: THRESHOLDS });
  observer.observe(sentinel);
}

function release(): void {
  mounted -= 1;
  if (mounted > 0) return;
  observer?.disconnect();
  sentinel?.remove();
  observer = null;
  sentinel = null;
  current = FULL;
}

export function useVisibleSlice(open: boolean, scrimRef: RefObject<HTMLElement | null>): void {
  // Before the effect below, so an overlay that mounts open finds the sentinel.
  useLayoutEffect(() => {
    retain();
    return release;
  }, []);

  useLayoutEffect(() => {
    const scrim = scrimRef.current;
    if (!open || !scrim) return;
    apply(scrim, current);
    scrims.add(scrim);
    return () => {
      scrims.delete(scrim);
    };
  }, [open, scrimRef]);
}
