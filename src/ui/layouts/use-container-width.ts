/**
 * Responsive hooks keyed to an element's OWN width, not the device viewport.
 *
 * Synapse apps render in an iframe pane whose width the host controls — it may
 * be fullscreen, split, or a narrow sidebar. Layouts must react to the space
 * they're actually given, so these observe the element via `ResizeObserver`
 * rather than reading `window`. SSR/test-safe: when `ResizeObserver` is absent,
 * width stays `null` and consumers treat the layout as "not yet narrow".
 */

import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/** Observe an element's content width. Attach the returned `ref` to it. */
export function useContainerWidth<T extends HTMLElement = HTMLDivElement>(): {
  ref: RefObject<T | null>;
  width: number | null;
} {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

/**
 * `true` once the observed element is narrower than `breakpoint` (px). Attach
 * the returned `ref` to the element whose width should drive the decision.
 */
export function useBreakpoint<T extends HTMLElement = HTMLDivElement>(
  breakpoint: number,
): { ref: RefObject<T | null>; width: number | null; isNarrow: boolean } {
  const { ref, width } = useContainerWidth<T>();
  return { ref, width, isNarrow: width !== null && width < breakpoint };
}
