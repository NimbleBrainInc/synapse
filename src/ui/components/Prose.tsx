/**
 * Prose — a token-styled container for rendered rich text. It applies the
 * NimbleBrain reading typography (ported from the Research app's markdown
 * element map) to whatever HTML it wraps, via a once-injected scoped
 * stylesheet — so it stays dependency-free.
 *
 * Pass pre-rendered nodes as `children`, or a trusted HTML string as `html`.
 * Bring your own markdown parser (`marked`, `react-markdown`, …) upstream; this
 * owns the *styling*, not the parsing — keeping the SDK free of a parser dep.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { tokens } from "../tokens.js";

const STYLE_ID = "nb-synapse-prose";
const RULES = `
.nb-prose {
  font-family: ${tokens.fontSans};
  font-size: ${tokens.textBaseSize};
  line-height: 1.7;
  color: ${tokens.fg};
}
.nb-prose > :first-child { margin-top: 0; }
.nb-prose > :last-child { margin-bottom: 0; }
.nb-prose h1, .nb-prose h2 { font-family: ${tokens.fontHeading}; letter-spacing: -0.015em; color: ${tokens.fg}; }
.nb-prose h1 { font-size: ${tokens.headingMdSize}; line-height: ${tokens.headingMdLine}; margin: 2rem 0 0.75rem; }
.nb-prose h2 { font-size: ${tokens.headingSmSize}; line-height: ${tokens.headingSmLine}; margin: 1.75rem 0 0.5rem; }
.nb-prose h3 { font-size: ${tokens.textBaseSize}; font-weight: ${tokens.weightSemibold}; margin: 1.5rem 0 0.35rem; color: ${tokens.fg}; }
.nb-prose p { margin: 0 0 1rem; }
.nb-prose ul, .nb-prose ol { margin: 0 0 1rem; padding-left: 1.25rem; }
.nb-prose li { margin: 0.25rem 0; }
.nb-prose a { color: ${tokens.accent}; text-decoration: underline; text-underline-offset: 2px; }
.nb-prose blockquote { margin: 0 0 1rem; padding-left: 1rem; border-left: 2px solid ${tokens.accent}; color: ${tokens.fgMuted}; font-style: italic; }
.nb-prose code { font-family: ${tokens.fontMono}; font-size: 0.88em; padding: 0.08rem 0.32rem; border-radius: ${tokens.radiusXs}; background: ${tokens.bgSubtle}; }
.nb-prose pre { font-family: ${tokens.fontMono}; font-size: ${tokens.textSmSize}; line-height: 1.55; margin: 0 0 1.25rem; padding: 0.875rem 1rem; background: ${tokens.bgSubtle}; border-radius: ${tokens.radiusSm}; overflow-x: auto; }
.nb-prose pre code { padding: 0; background: none; }
.nb-prose hr { border: none; border-top: 1px solid ${tokens.border}; margin: 2rem 0; }
.nb-prose strong { font-weight: ${tokens.weightSemibold}; }
`;

interface ProseProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "dangerouslySetInnerHTML"> {
  /** Trusted, pre-sanitized HTML string. */
  html?: string;
  children?: ReactNode;
}

export function Prose({ html, children, className, ...rest }: ProseProps) {
  ensureStyle(STYLE_ID, RULES);
  const cls = `nb-prose ${className ?? ""}`.trim();
  if (html !== undefined) {
    // biome-ignore lint/security/noDangerouslySetInnerHtml: caller supplies trusted, pre-sanitized HTML by contract.
    return <div className={cls} dangerouslySetInnerHTML={{ __html: html }} {...rest} />;
  }
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
