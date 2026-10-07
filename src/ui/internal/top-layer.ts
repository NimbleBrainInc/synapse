/**
 * Lifts an overlay's scrim into the browser's top layer, so nothing it is declared
 * inside can clip it or paint over it.
 *
 * The overlays render in place, beside the control that opens them, and `position:
 * fixed` alone does not lift them out of every ancestor. Safari clips a fixed element
 * declared inside a `position: sticky` box within an overflow scroller to that
 * scroller: a confirmation raised from a list's pinned header shows its scrim over
 * the list pane only, and its centred panel is cut away. An ancestor with a
 * `transform`, `filter` or `contain` traps a fixed element in every engine. The top
 * layer paints above the whole document regardless of ancestors, which is what
 * `showModal()` would give if the app sandbox allowed it (see `modal.ts`).
 *
 * `popover="manual"` reaches the top layer without that permission, and it does no
 * more: no light dismiss, no Escape, and no focus move unless something inside
 * carries `autofocus`, so `useModal` stays the owner of all three. The element keeps
 * its place in the DOM, so CSS inheritance and the DOM nesting `useModal` reads are
 * unchanged.
 *
 * The top layer stacks in the order elements were shown. A confirmation raised inside
 * a drawer must sit above it, but when both mount in one commit React runs the
 * child's layout effect first. So an overlay nested in a kit overlay that is not yet
 * shown waits, and each overlay shows its nested kit overlays after itself. Only
 * kit overlays (`data-nb-overlay`) are touched: an app's own popover inside a drawer
 * stays as the app left it.
 *
 * Nothing here hides a popover. Every overlay renders nothing when closed, and an
 * element leaving the DOM leaves the top layer with no focus side effect, whereas
 * `hidePopover()` may move focus itself and race `useModal`'s restore.
 *
 * Where `showPopover` is missing or throws, the overlay renders as it did before,
 * a fixed box at its own z-index.
 *
 * Limit: an app popup portaled to `<body>` from inside an open overlay renders under
 * it whatever its z-index, as it would under a native modal dialog.
 */

import { type RefObject, useLayoutEffect } from "react";

/** Marks an element as a kit overlay's scrim, for the nesting order above. */
export const OVERLAY_ATTR = "data-nb-overlay";

/** The attributes an overlay's scrim carries. */
export const overlayProps = { popover: "manual", [OVERLAY_ATTR]: "" } as const;

/**
 * UA `[popover]` defaults to undo on a scrim, which is a full-viewport box: an
 * author rule beats the UA sheet at any specificity, so these hold shown or not.
 */
export const OVERLAY_RESET =
  "margin: 0; border: 0; padding: 0; width: auto; height: auto; max-width: none; max-height: none; overflow: visible; color: inherit;";

// Tracked here rather than read off `:popover-open`, which throws in an engine
// without popovers and would let a second effect run show an element twice.
const shown = new WeakSet<Element>();

function show(el: HTMLElement): void {
  if (shown.has(el) || typeof el.showPopover !== "function") return;
  try {
    el.showPopover();
    shown.add(el);
  } catch {
    // Not connected, or the engine refused: the fixed box still renders in place.
  }
}

export function useTopLayer(open: boolean, scrimRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const scrim = scrimRef.current;
    if (!open || !scrim) return;
    const parent = scrim.parentElement?.closest(`[${OVERLAY_ATTR}]`);
    // The parent mounted in this commit and shows this one after itself.
    if (parent && !shown.has(parent)) return;
    show(scrim);
    for (const nested of scrim.querySelectorAll<HTMLElement>(`[${OVERLAY_ATTR}]`)) show(nested);
  }, [open, scrimRef]);
}
