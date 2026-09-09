/**
 * PageLayout — one screen of a Synapse app, assembled in the one order that works.
 *
 * A header naming what you are looking at, a tab bar of that thing's facets, an optional
 * toolbar over the content, then the content. Every level of an app is this shape, and the
 * only thing descending changes is whose facets the tab bar holds: at the root the header
 * names the app and the tabs are its sections; a level down a trail appears above the header,
 * the header names the record, and the tabs are the record's own.
 *
 * **Why this is a component when the kit says thin compositions stay recipes.** That rule
 * measures mechanical complexity, and by it this is a recipe — it is a vertical stack in a
 * fixed order. But the reason to own it is not that assembling it is hard; it is that
 * assembling it DIFFERENTLY is a defect rather than a preference, and a recipe written down
 * in prose does not stop that. The failures are real ones, all found in a shipped app: two
 * tab bars stacked until the reader could not tell which row changed what; an app-level
 * chrome bar whose rule landed a few pixels off the host's chat panel; an unbounded
 * agent-authored description pushing the content below the fold. Each is an ordering or
 * composition mistake that a component makes unavailable and a convention only discourages.
 *
 * So the amended rule: a layout becomes a component when it is complex to build OR when
 * getting its arrangement wrong is a bug. This is the second kind.
 *
 * **What it deliberately does not have is a chrome slot.** A Synapse app does not own its
 * window — the host spends the left edge on a rail and the right on a chat panel — so an
 * app-level bar is a third chrome layer, and its rule cannot agree with the chat panel's.
 * Everything here is page content, which is the only thing on screen the app unambiguously
 * owns.
 *
 * Compose it inside `AppFrame.Body`; it manages its own vertical rhythm and nothing else.
 */

import type { HTMLAttributes, ReactNode } from "react";
import type { Crumb } from "../components/Breadcrumb.js";
import { PageHeader } from "../components/PageHeader.js";

interface PageLayoutProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** The trail. Omit at the top level, which has nothing above it to name. */
  crumbs?: Crumb[];
  title: ReactNode;
  /** Beside the title — typically a `Badge`. */
  status?: ReactNode;
  /** The far end of the title's row. */
  actions?: ReactNode;
  description?: ReactNode;
  /** Lines the description is clamped to. `0` removes the clamp. */
  descriptionLines?: number;
  /**
   * ONE tab bar, of the facets of whatever the title names. A `Tabs`.
   *
   * A slot rather than typed props because `Tabs` already has an API worth having, and
   * wrapping it here would mean maintaining a second copy of it that drifts. What the layout
   * owns is the bar's POSITION — under the header, above the content — which is the part
   * apps get wrong.
   */
  tabs?: ReactNode;
  /**
   * Controls that narrow the content below: a search field, a status filter, a view toggle.
   *
   * Distinct from `tabs` on purpose. A tab changes which facet of one entity is shown; a
   * toolbar reshapes a set within that facet. Rendering them as one row is how an app ends up
   * with two identical-looking control strips whose difference nobody can see.
   */
  toolbar?: ReactNode;
  children?: ReactNode;
}

export function PageLayout({
  crumbs,
  title,
  status,
  actions,
  description,
  descriptionLines,
  tabs,
  toolbar,
  children,
  style,
  ...rest
}: PageLayoutProps) {
  return (
    // A `<section>`, not a `<div>`, and it is the header below that makes it load-bearing.
    // `<header>` maps to the `banner` landmark UNLESS it descends from sectioning content, so
    // a page inside a page — a `PageLayout` in a pane of one — produced TWO banners, both
    // claiming to head the document. That is the same defect as the app-chrome bar this
    // layout exists without, one layer down and invisible on screen: it shows up only in the
    // landmark list a screen-reader user navigates by.
    //
    // Scoping it here rather than asking callers to wrap is the point. A consuming app hit
    // this, diagnosed it, and wrapped its own instance — correct, and not a thing every app
    // should have to rediscover. An embedded app is not the document anyway: the host owns
    // the real banner, and what this renders is a section of the host's page.
    <section
      style={{ display: "flex", flexDirection: "column", gap: "1.1rem", minWidth: 0, ...style }}
      {...rest}
    >
      <PageHeader
        crumbs={crumbs}
        title={title}
        status={status}
        actions={actions}
        description={description}
        descriptionLines={descriptionLines}
      />
      {tabs}
      {/* The toolbar sits closer to the content it filters than to the tabs above it, so the
          gap is tightened here rather than inheriting the stack's rhythm. A control that looks
          equally attached to both is a control whose scope the reader has to guess. */}
      {toolbar ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
            minWidth: 0,
            marginBottom: "-0.35rem",
          }}
        >
          {toolbar}
        </div>
      ) : null}
      {children}
    </section>
  );
}
