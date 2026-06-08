/**
 * SearchField — a text input in two postures: `underline` (invisible at rest,
 * reveals an underline on focus — the Research editorial style) and `boxed`
 * (a bordered field). Focus styling lives in a once-injected stylesheet.
 */

import type { InputHTMLAttributes } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { type StyleWithVars, tokens } from "../tokens.js";

const STYLE_ID = "nb-synapse-searchfield";
const RULES = `
.nb-search { font-family: var(--nb-search-font); color: var(--nb-search-fg); outline: none; }
.nb-search::placeholder { color: var(--nb-search-placeholder); }
.nb-search--underline {
  border: none;
  border-bottom: 1px solid transparent;
  background: transparent;
  padding: 0.3rem 0.1rem;
  transition: border-color 160ms ease;
}
.nb-search--underline:focus { border-bottom-color: var(--nb-search-accent); }
.nb-search--boxed {
  border: 1px solid var(--nb-search-border);
  border-radius: var(--nb-search-radius);
  background: var(--nb-search-bg);
  padding: 0.4rem 0.6rem;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}
.nb-search--boxed:focus {
  border-color: var(--nb-search-accent);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--nb-search-accent) 18%, transparent);
}
`;

interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: "underline" | "boxed";
}

export function SearchField({
  variant = "underline",
  style,
  className,
  type = "search",
  ...rest
}: SearchFieldProps) {
  ensureStyle(STYLE_ID, RULES);
  const fieldStyle: StyleWithVars = {
    "--nb-search-font": tokens.fontSans,
    "--nb-search-fg": tokens.fg,
    "--nb-search-placeholder": tokens.fgFaint,
    "--nb-search-accent": tokens.accent,
    "--nb-search-border": tokens.border,
    "--nb-search-bg": tokens.bgSubtle,
    "--nb-search-radius": tokens.radiusSm,
    fontSize: tokens.textSmSize,
    lineHeight: tokens.textSmLine,
    ...style,
  };
  return (
    <input
      type={type}
      className={`nb-search nb-search--${variant} ${className ?? ""}`.trim()}
      style={fieldStyle}
      {...rest}
    />
  );
}
