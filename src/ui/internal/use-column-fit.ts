/**
 * `useColumnFit` — decides which of a table's droppable columns to hide so the table fits the
 * width it is actually given. The browser measures; nothing here sums column widths.
 *
 * Each commit, before paint, the hook compares the table's laid-out width with the width
 * available in its wrapper. While the table is wider, it hides the next column in drop order
 * and records the width the table needed with that column shown. A hidden column comes back
 * only once the wrapper is at least that wide, so a column is never shown at a width where it
 * was just measured not to fit, and a table resting at a threshold does not alternate.
 *
 * Hiding is a prefix of a fixed order (highest `priority` number first, rightmost first on a
 * tie), so the state is one count. The recorded widths go stale when what is measured changes
 * underneath them, so the count resets and the table refits from every column whenever the
 * data, the columns, or the loaded fonts change.
 *
 * The wrapper's width arrives through a `ResizeObserver`, and its change reaches React through
 * `useSyncExternalStore`, whose updates render synchronously: the refit happens in the same
 * frame as the resize, so a narrowed table is never painted overflowing. Without a DOM or a
 * `ResizeObserver` (SSR, a test DOM) nothing is hidden.
 */

import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** A column that may be hidden: its key, its `priority`, and its position among the columns. */
export interface DroppableColumn {
  key: string;
  priority: number;
  index: number;
}

/** Sub-pixel slack, so a fractional table width that matches its wrapper is not "over". */
const EPSILON = 0.5;

function canMeasure(): boolean {
  return typeof window !== "undefined" && typeof ResizeObserver !== "undefined";
}

/** Drop order: highest `priority` number first; on a tie, the rightmost column first. */
export function dropOrder(columns: readonly DroppableColumn[]): string[] {
  return [...columns]
    .sort((a, b) => b.priority - a.priority || b.index - a.index)
    .map((c) => c.key);
}

export function useColumnFit({
  enabled,
  droppable,
  data,
  mounted,
}: {
  enabled: boolean;
  droppable: readonly DroppableColumn[];
  /** Compared by identity: a new array means new content, and new widths to measure. */
  data: unknown;
  /** Whether the table is in the document (it is not while the `empty` slot shows). */
  mounted: boolean;
}): {
  wrapRef: RefObject<HTMLDivElement | null>;
  tableRef: RefObject<HTMLTableElement | null>;
  hidden: ReadonlySet<string>;
  /** True once every droppable column is hidden. */
  exhausted: boolean;
} {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const order = dropOrder(droppable);
  const signature = order.join("\u0000");

  const [count, setCount] = useState(0);
  // needs[i]: the table's width, measured, with order[i] still shown — the width it needed.
  const needs = useRef<number[]>([]);

  // An external store holding one counter, bumped by the observers below. Reading it through
  // `useSyncExternalStore` makes each bump a synchronous render (see the module note).
  const store = useRef({ version: 0, fonts: 0, listeners: new Set<() => void>() });
  const subscribe = useCallback((listener: () => void) => {
    store.current.listeners.add(listener);
    return () => {
      store.current.listeners.delete(listener);
    };
  }, []);
  const getSnapshot = useCallback(() => store.current.version, []);
  useSyncExternalStore(subscribe, getSnapshot, () => 0);

  useLayoutEffect(() => {
    if (!enabled || !mounted || !canMeasure()) return;
    const el = wrapRef.current;
    if (!el) return;
    const bump = () => {
      store.current.version += 1;
      for (const listener of store.current.listeners) listener();
    };
    // Only the width decides what fits. Hiding a column moves its value under the primary
    // cell, which changes the wrapper's height, and reacting to that would refit for nothing.
    let lastWidth = -1;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number" && width !== lastWidth) {
        lastWidth = width;
        bump();
      }
    });
    ro.observe(el);
    // A web font that finishes loading after the first fit changes every text width without
    // changing the wrapper's, so no resize reports it.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    const onFonts = () => {
      store.current.fonts += 1;
      bump();
    };
    fonts?.addEventListener?.("loadingdone", onFonts);
    return () => {
      ro.disconnect();
      fonts?.removeEventListener?.("loadingdone", onFonts);
    };
  }, [enabled, mounted]);

  // What the recorded widths were measured against. A change to any of these resets the fit.
  const basis = useRef<{ data: unknown; signature: string; fonts: number } | null>(null);

  // No dependency list: this runs after every commit, including the ones it causes, which is
  // how one column at a time is hidden or restored until the table fits.
  useLayoutEffect(() => {
    if (!enabled || !mounted || !canMeasure()) return;
    const wrap = wrapRef.current;
    const table = tableRef.current;
    if (!wrap || !table) return;

    const current = { data, signature, fonts: store.current.fonts };
    const previous = basis.current;
    basis.current = current;
    if (
      previous &&
      (previous.data !== current.data ||
        previous.signature !== current.signature ||
        previous.fonts !== current.fonts) &&
      count > 0
    ) {
      needs.current = [];
      setCount(0);
      return;
    }

    // The wrapper's content width: its border box, less any scrollbar it shows.
    const available =
      wrap.getBoundingClientRect().width - (wrap.offsetWidth - wrap.clientWidth || 0);
    const width = table.getBoundingClientRect().width;

    if (width > available + EPSILON) {
      if (count < order.length) {
        needs.current[count] = width;
        setCount(count + 1);
      }
      return;
    }
    const need = needs.current[count - 1];
    if (count > 0 && need !== undefined && need <= available + EPSILON) {
      setCount(count - 1);
    }
  });

  const shown = Math.min(count, order.length);
  return {
    wrapRef,
    tableRef,
    hidden: new Set(order.slice(0, shown)),
    exhausted: order.length > 0 ? shown === order.length : true,
  };
}
