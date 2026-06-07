/**
 * SegmentedControl — the view-toggle pattern (Board/Table, All/Today/Week).
 * A small set of mutually-exclusive options; the active one gets a raised pill.
 */

import type { HTMLAttributes } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

const STYLE_ID = "nb-synapse-segmented";
const RULES = `
.nb-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--nb-seg-radius);
  background: var(--nb-seg-track);
}
.nb-seg__btn {
  border: none;
  background: transparent;
  color: var(--nb-seg-fg);
  font-family: var(--nb-seg-font);
  font-weight: var(--nb-seg-weight);
  padding: 0.25rem 0.7rem;
  border-radius: calc(var(--nb-seg-radius) - 2px);
  cursor: pointer;
  transition: color 130ms ease, background 130ms ease;
  white-space: nowrap;
}
.nb-seg__btn:hover:not([aria-pressed="true"]) { color: var(--nb-seg-fg-strong); }
.nb-seg__btn[aria-pressed="true"] {
  background: var(--nb-seg-active-bg);
  color: var(--nb-seg-fg-strong);
  box-shadow: var(--nb-seg-active-shadow);
}
`;

interface Option<T extends string> {
  label: string;
  value: T;
}

interface SegmentedControlProps<T extends string>
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  ensureStyle(STYLE_ID, RULES);
  const trackStyle: StyleWithVars = {
    "--nb-seg-radius": tokens.radiusSm,
    "--nb-seg-track": tokens.bgSubtle,
    "--nb-seg-fg": tokens.fgMuted,
    "--nb-seg-fg-strong": tokens.fg,
    "--nb-seg-font": tokens.fontSans,
    "--nb-seg-weight": tokens.weightMedium,
    "--nb-seg-active-bg": tokens.bgRaised,
    "--nb-seg-active-shadow": tokens.shadowSm,
    fontSize: tokens.textSmSize,
    lineHeight: tokens.textSmLine,
    ...style,
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: role="group" with aria-label is the correct grouping for a set of toggle buttons; <fieldset> would impose form semantics this control doesn't have.
    <div className={`nb-seg ${className ?? ""}`.trim()} role="group" style={trackStyle} {...rest}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="nb-seg__btn"
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
