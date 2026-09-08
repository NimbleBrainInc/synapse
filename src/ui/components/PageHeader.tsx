/**
 * PageHeader — the top of a page: where you are, what this is, and what you can do to it.
 *
 * One component rather than each screen assembling its own, because the parts have to keep
 * one order and one rhythm for a multi-screen app to read as one app. It is also what makes
 * a full-width screen legible as a LEVEL in a hierarchy rather than as a page that happens
 * to be open — the trail above the title is doing that work, not decoration.
 *
 * The order is fixed and the reasons are not interchangeable: the trail comes first because
 * orientation precedes identity; actions sit on the title's row because they act on the
 * thing the title names; the description comes last because it is the only part a reader
 * can skip.
 *
 * **The description is clamped to two lines.** Descriptions here are frequently
 * agent-authored and of no bounded length, and an unbounded paragraph at the top of every
 * screen pushes the content the reader came for below the fold. Two lines is enough to
 * identify the thing and not enough to become the page. Callers with genuinely short,
 * curated copy can raise it; the default protects the common case rather than the tidy one.
 *
 * `status`, `actions` and `nav` are ReactNode slots, not typed vocabularies. A page header has
 * no business knowing what states a caller's entity can be in, which of its verbs are primary,
 * or where an app's sections live — that knowledge belongs to the app, and a kit that encoded
 * it would need extending for every app that arrived with a different one.
 *
 * **`nav` is where an embedded app's top-level destinations go, and the reason is the frame.**
 * A Synapse app does not own its window: the host spends the left edge on a rail and the right
 * on chat, so a chrome bar of the app's own is a third layer whose rule lands a few pixels off
 * the chat panel's — two near-parallel lines that read as a mistake rather than as structure,
 * and styling does not reconcile them. Sharing the trail's row costs no rule, no tint, and no
 * second row: destinations read as part of the page, which is the only thing on screen that is
 * unambiguously the app's to draw.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import type { StyleWithVars } from "../tokens.js";
import { Heading, Text } from "../typography.js";
import { Breadcrumb, type Crumb } from "./Breadcrumb.js";

const STYLE_ID = "nb-synapse-page-header";
// The clamp lives in a stylesheet rule rather than an inline style, following the same
// pattern Table/Tabs/SegmentedControl use. Two reasons beyond consistency: `display:
// -webkit-box` and `-webkit-line-clamp` are a matched pair that only works together, so they
// belong in one place a caller cannot half-override with `style`; and the line count stays
// parameterized through a custom property, which is how every other knob in this kit travels.
const RULES = `
.nb-page-header__desc {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--nb-ph-desc-lines, 2);
  line-clamp: var(--nb-ph-desc-lines, 2);
  overflow: hidden;
}
`;

interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** The trail. Omit on a top-level page, which has nothing above it to name. */
  crumbs?: Crumb[];
  /**
   * Top-level destinations, rendered at the far end of the trail's row.
   *
   * Shares that row rather than getting one of its own — see the note above. The row appears
   * for either `crumbs` or `nav`, so a top-level page with no trail still shows its
   * destinations, and a deep page shows both with the trail taking the space it needs.
   */
  nav?: ReactNode;
  title: ReactNode;
  /** Sits beside the title — typically a `Badge`. */
  status?: ReactNode;
  /** Sits at the far end of the title's row. Buttons, a menu. */
  actions?: ReactNode;
  description?: ReactNode;
  /** Lines the description is clamped to before ellipsis. `0` removes the clamp. */
  descriptionLines?: number;
}

export function PageHeader({
  crumbs,
  nav,
  title,
  status,
  actions,
  description,
  descriptionLines = 2,
  style,
  ...rest
}: PageHeaderProps) {
  ensureStyle(STYLE_ID, RULES);
  const descVars: StyleWithVars =
    descriptionLines > 0 ? { "--nb-ph-desc-lines": String(descriptionLines) } : {};
  return (
    <header
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 0, ...style }}
      {...rest}
    >
      {(crumbs && crumbs.length > 0) || nav ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          {/* An empty span rather than nothing when there is no trail: `space-between` with a
              single child pushes it to the START, so a top-level page's destinations would
              jump to the left edge and the row's geometry would change with depth. */}
          {crumbs && crumbs.length > 0 ? <Breadcrumb crumbs={crumbs} /> : <span />}
          {nav ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
              {nav}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <Heading size="md">{title}</Heading>
          {status}
        </div>
        {/* Rendered only when given. An empty actions box still occupies its row and pulls
            the title off centre, which reads as a control that failed to load. */}
        {actions ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            {actions}
          </div>
        ) : null}
      </div>

      {description ? (
        <Text
          size="sm"
          tone="muted"
          className={descriptionLines > 0 ? "nb-page-header__desc" : undefined}
          // A measure, clamped or not. The clamp needs a width to resolve line boxes
          // against, and unclamped prose past ~72 characters a line is hard to track back
          // to the next line's start whatever its length.
          style={{ maxWidth: "72ch", ...descVars }}
        >
          {description}
        </Text>
      ) : null}
    </header>
  );
}
