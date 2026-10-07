/**
 * Lays an overlay's panel out in the part of the app frame the user can see.
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
 * reports the result in the frame's own coordinates. The scrim is the frame's
 * viewport, so its intersection is the visible slice of the frame. The overlay sets
 * the slice's distance from the frame's top and bottom as `--nb-slice-top` /
 * `--nb-slice-bottom` on the scrim and pads its content box by them: the scrim still
 * covers and blocks the whole frame, and the panel is laid out in the slice.
 *
 * The slice is measured once per open, by a new observer. An observer reports on
 * creation and afterwards only when the visible *fraction* crosses a threshold, and
 * scrolling a frame taller than the host's viewport through its middle keeps the
 * fraction constant, so a long-lived observer's last report goes stale silently. A
 * new one reports the current slice. That report arrives a frame after open, while
 * the panel's fade-in is still near transparent; `useModal` focuses without
 * scrolling, so the panel's first position does not scroll the host page to it.
 *
 * Where the whole frame is visible, the frame is off screen, or the engine has no
 * `IntersectionObserver`, the variables stay unset and the overlay lays out as before.
 */

import { type RefObject, useLayoutEffect } from "react";

export function useVisibleSlice(open: boolean, scrimRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const scrim = scrimRef.current;
    if (!open || !scrim || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (!entry) return;
      observer.disconnect();
      const frame = entry.boundingClientRect;
      const seen = entry.intersectionRect;
      if (!entry.isIntersecting || seen.height <= 0) return;
      scrim.style.setProperty("--nb-slice-top", `${Math.max(0, seen.top - frame.top)}px`);
      scrim.style.setProperty("--nb-slice-bottom", `${Math.max(0, frame.bottom - seen.bottom)}px`);
    });
    observer.observe(scrim);
    return () => observer.disconnect();
  }, [open, scrimRef]);
}
