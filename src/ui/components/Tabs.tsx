/**
 * Tabs — facets of ONE entity, rendered as an underlined bar.
 *
 * **Why this exists beside `SegmentedControl`, which is also a row of exclusive choices.**
 * They are the same control mechanically and different jobs, and an app that uses one
 * component for both stacks two or three identical pill rows down the page — app
 * navigation, then entity facets, then a list filter, all wearing one costume. The reader
 * cannot tell which row changes what, and the screen reads as noise rather than hierarchy.
 * So the distinction is carried in the FORM: tabs are an underlined bar that belongs to the
 * thing above them, pills are a raised track that belongs to the thing below them.
 *
 * The rule that decides which to reach for:
 *
 *   - **Tabs** change which FACET of one chosen entity is shown. They add no selection, so
 *     they add no level — the entity is the same before and after.
 *   - **SegmentedControl** narrows or reshapes a SET. A status filter over a list, a
 *     board/table toggle.
 *
 * Full ARIA tab semantics (`role="tablist"`, roving focus, arrow keys) because a tab bar is
 * a documented pattern a screen reader user already knows, and half of it — buttons with no
 * relationship declared between them — is worse than plain buttons, which at least do not
 * promise a structure that is not there.
 */

import { type HTMLAttributes, type KeyboardEvent, useRef } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

const STYLE_ID = "nb-synapse-tabs";
const RULES = `
.nb-tabs {
  display: flex;
  align-items: stretch;
  gap: var(--nb-tabs-gap);
  border-bottom: var(--nb-tabs-rule);
  overflow-x: auto;
  scrollbar-width: none;
}
.nb-tabs::-webkit-scrollbar { display: none; }
.nb-tabs__tab {
  border: none;
  background: transparent;
  color: var(--nb-tabs-fg);
  font-family: var(--nb-tabs-font);
  font-weight: var(--nb-tabs-weight);
  font-size: var(--nb-tabs-size);
  line-height: var(--nb-tabs-line);
  padding: 0.4rem 0.15rem 0.55rem;
  cursor: pointer;
  white-space: nowrap;
  position: relative;
  transition: color 130ms ease;
}
.nb-tabs__tab::after {
  content: "";
  position: absolute;
  /* bottom 0, not -1px. overflow-x auto makes the computed overflow-y auto as well, and
     clipping happens at the PADDING box - so a negative offset put 1px of the 2px accent
     outside it: the underline rendered half-height and left 1px of phantom overflow. */
  left: 0; right: 0; bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: transparent;
  transition: background 130ms ease;
}
.nb-tabs__tab:hover { color: var(--nb-tabs-fg-strong); }
.nb-tabs__tab[aria-selected="true"] {
  color: var(--nb-tabs-fg-strong);
  font-weight: var(--nb-tabs-weight-active);
}
.nb-tabs__tab[aria-selected="true"]::after { background: var(--nb-tabs-accent); }
.nb-tabs__tab:focus-visible {
  outline: 2px solid var(--nb-tabs-ring);
  outline-offset: -2px;
  border-radius: var(--nb-tabs-radius);
}
`;

interface Tab<T extends string> {
  label: string;
  value: T;
  /** A small trailing count. Rendered muted, and omitted entirely when undefined. */
  count?: number;
}

interface TabsProps<T extends string> extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  tabs: Tab<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the tab set — what these are facets OF. */
  label?: string;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  style,
  className,
  onKeyDown: callerKeyDown,
  ...rest
}: TabsProps<T>) {
  ensureStyle(STYLE_ID, RULES);
  const barRef = useRef<HTMLDivElement>(null);

  const barStyle: StyleWithVars = {
    "--nb-tabs-gap": "1.25rem",
    "--nb-tabs-rule": `${tokens.borderWidth} solid ${tokens.border}`,
    "--nb-tabs-fg": tokens.fgMuted,
    "--nb-tabs-fg-strong": tokens.fg,
    "--nb-tabs-accent": tokens.accent,
    "--nb-tabs-ring": tokens.ring,
    "--nb-tabs-font": tokens.fontSans,
    "--nb-tabs-weight": tokens.weightMedium,
    "--nb-tabs-weight-active": tokens.weightSemibold,
    "--nb-tabs-size": tokens.textSmSize,
    "--nb-tabs-line": tokens.textSmLine,
    "--nb-tabs-radius": tokens.radiusXs,
    ...style,
  };

  // Arrow keys move FOCUS, and selection follows it.
  //
  // Moving selection alone was the bug this replaces: the roving tabindex handed tabIndex=0
  // to the newly selected tab while the browser's focus stayed on the previous one, so the
  // focus ring sat on an unselected tab, a screen reader announced nothing (AT announces
  // focus, not aria-selected), and tabbing out and back landed somewhere else. The APG tabs
  // pattern specifies that arrows move focus with activation following it, and half of a
  // pattern a reader already knows is worse than none of it.
  //
  // Focused imperatively off the bar's own DOM rather than through an effect keyed on value:
  // the buttons are already rendered so the target exists now, and an effect would also
  // steal focus when a PARENT changed the value - a tab bar grabbing focus because something
  // else navigated.
  //
  // The caller's own handler runs FIRST and can suppress navigation with preventDefault().
  // `onKeyDown` is part of this component's public prop type, so accepting one and never
  // calling it is the same silent lie as letting it replace the contract outright - the two
  // failures a caller cannot tell apart from the type. Opting out is now something they do
  // on purpose, in one visible line.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    callerKeyDown?.(e);
    if (e.defaultPrevented) return;
    const at = tabs.findIndex((t) => t.value === value);
    if (at < 0) return;
    let to: number;
    if (e.key === "ArrowRight") to = (at + 1) % tabs.length;
    else if (e.key === "ArrowLeft") to = (at - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = tabs.length - 1;
    else return;
    e.preventDefault();
    // Arrows wrap, because a bar with a dead end makes the reader reverse direction to reach
    // the tab one step past the one they are on. Home and End are absolute and do not - so
    // they are the two keys that can land on the tab already held, and a change event for a
    // value that did not change is one a caller has to defend against (a refetch, a route
    // push, an analytics event). Focus still moves, because the key was still pressed.
    if (to !== at) onChange(tabs[to].value);
    barRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  };

  return (
    <div
      // `rest` FIRST, so nothing a caller passes can overwrite what makes this a tablist.
      // `role` and `aria-label` are the contract the pattern rests on; a caller who could
      // replace them would have a bar announcing something it does not implement.
      {...rest}
      ref={barRef}
      role="tablist"
      aria-label={label}
      className={`nb-tabs ${className ?? ""}`.trim()}
      style={barStyle}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            // Roving tabindex: one stop for the whole bar, then arrows within it.
            tabIndex={selected ? 0 : -1}
            className="nb-tabs__tab"
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span style={{ marginLeft: "0.35rem", color: tokens.fgFaint }}>{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
