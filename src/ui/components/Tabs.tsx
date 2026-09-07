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

import type { HTMLAttributes, KeyboardEvent } from "react";
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
  left: 0; right: 0; bottom: -1px;
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
  ...rest
}: TabsProps<T>) {
  ensureStyle(STYLE_ID, RULES);

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

  // Arrow keys move between tabs, which is the half of the tablist contract that is actually
  // load-bearing: a reader who knows the pattern expects to arrow along the bar, and buttons
  // that only respond to Tab make them walk the whole page to reach the next facet.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const at = tabs.findIndex((t) => t.value === value);
    if (at < 0) return;
    // Wraps, because a bar with a dead end makes the reader reverse direction to reach the
    // tab one step past the one they are on.
    const next = tabs[(at + step + tabs.length) % tabs.length];
    onChange(next.value);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`nb-tabs ${className ?? ""}`.trim()}
      style={barStyle}
      onKeyDown={onKeyDown}
      {...rest}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`nb-tab-${tab.value}`}
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
