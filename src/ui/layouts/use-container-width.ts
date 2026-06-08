/**
 * `useBreakpoint` — responsive hook keyed to an element's OWN width, not the
 * device viewport. Synapse apps render in an iframe pane whose width the host
 * controls (fullscreen, split, or a narrow sidebar), so layouts must react to
 * the space they're actually given.
 *
 * Attach the returned `ref` to the element whose width drives the decision.
 * Width is measured synchronously on mount (no first-frame flash) and kept live
 * via `ResizeObserver`. SSR/test-safe: without a DOM/`ResizeObserver` it simply
 * reports `isNarrow: false`.
 */

import { type RefObject, useLayoutEffect, useRef, useState } from "react";

export function useBreakpoint<T extends HTMLElement = HTMLDivElement>(
  breakpoint: number,
): { ref: RefObject<T | null>; isNarrow: boolean } {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Synchronous initial measure — runs before paint, so the first painted
    // frame already reflects the real width. Border-box, matching the observer
    // below (so there's no jump on the first resize if the element has padding).
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const w = entry?.borderBoxSize?.[0]?.inlineSize ?? entry?.contentRect.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, isNarrow: width !== null && width < breakpoint };
}
