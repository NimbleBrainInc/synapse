/**
 * ListDetailLayout — a master list beside a detail pane (CRM contacts → record,
 * Research runs → report, conversations → thread). Responsive to the layout's
 * own width: side-by-side when wide; below `breakpoint` it shows one at a time —
 * the list, or the detail when something is `selected`, with a `Back`
 * affordance to return.
 *
 * `selected` is driven by the app's own selection state. Place
 * `<ListDetailLayout.Back />` at the top of `Detail`; it renders only on a
 * narrow pane and calls `onBack`.
 */

import { createContext, type HTMLAttributes, type ReactNode, useContext } from "react";
import { TextLink } from "../components/Button.js";
import { tokens } from "../tokens.js";
import { useBreakpoint } from "./use-container-width.js";

interface ListDetailState {
  collapsed: boolean;
  selected: boolean;
  listWidth: number | string;
  onBack?: () => void;
}

const ListDetailCtx = createContext<ListDetailState | null>(null);

/** Read the list/detail responsive state — for custom back affordances. */
export function useListDetail(): ListDetailState {
  const ctx = useContext(ListDetailCtx);
  if (!ctx) throw new Error("useListDetail must be used within <ListDetailLayout>");
  return ctx;
}

interface ListDetailLayoutProps extends HTMLAttributes<HTMLDivElement> {
  /** Is a detail open? Drives which pane shows on a narrow layout. */
  selected?: boolean;
  /** Called by `Back` (and custom triggers) to return to the list when narrow. */
  onBack?: () => void;
  /** Master list width when side-by-side. Default 320. */
  listWidth?: number | string;
  /** Collapse to one-at-a-time below this layout width (px). Default 720. */
  breakpoint?: number;
  children?: ReactNode;
}

function ListDetailLayoutRoot({
  selected = false,
  onBack,
  listWidth = 320,
  breakpoint = 720,
  style,
  children,
  ...rest
}: ListDetailLayoutProps) {
  const { ref, isNarrow } = useBreakpoint<HTMLDivElement>(breakpoint);
  return (
    <ListDetailCtx.Provider value={{ collapsed: isNarrow, selected, listWidth, onBack }}>
      <div
        ref={ref}
        style={{ display: "flex", flexDirection: "row", height: "100%", minHeight: 0, ...style }}
        {...rest}
      >
        {children}
      </div>
    </ListDetailCtx.Provider>
  );
}

function List({ style, children, ...rest }: HTMLAttributes<HTMLElement>) {
  const { collapsed, selected, listWidth } = useListDetail();
  if (collapsed && selected) return null; // detail has the stage
  const border = `${tokens.borderWidth} solid ${tokens.border}`;
  return (
    <section
      style={{
        // Clip horizontally, scroll vertically. A too-wide child (e.g. an
        // auto-layout <table> that won't shrink below its content) would
        // otherwise spill out of this fixed-width rail and paint over the
        // detail pane. `minWidth: 0` lets the rail participate in flex
        // sizing without being forced wider by its content.
        overflow: "hidden auto",
        ...(collapsed
          ? { flex: 1, minWidth: 0 }
          : { width: listWidth, minWidth: 0, flexShrink: 0, borderRight: border }),
        ...style,
      }}
      {...rest}
    >
      {children}
    </section>
  );
}

function Detail({ style, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const { collapsed, selected } = useListDetail();
  if (collapsed && !selected) return null; // list has the stage
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", ...style }} {...rest}>
      {children}
    </div>
  );
}

interface BackProps {
  children?: ReactNode;
  style?: React.CSSProperties;
}

/** "← Back" affordance — renders only on a narrow pane with a detail open. */
function Back({ children, style }: BackProps) {
  const { collapsed, selected, onBack } = useListDetail();
  if (!collapsed || !selected) return null;
  return (
    <TextLink onClick={() => onBack?.()} style={{ marginBottom: "0.5rem", ...style }}>
      {children ?? "← Back"}
    </TextLink>
  );
}

/** `ListDetailLayout` with `.List`, `.Detail`, and `.Back` slots. */
export const ListDetailLayout = Object.assign(ListDetailLayoutRoot, { List, Detail, Back });
