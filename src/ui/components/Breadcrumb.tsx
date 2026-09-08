/**
 * Breadcrumb — the trail back, and where you are.
 *
 * A hierarchy deeper than two levels cannot be navigated by a back button: "up one" and
 * "up two" need separate controls, and an app that grows a second one ends up rendering
 * both adjacent, differently labelled, with only one correct at any depth. A trail has no
 * such limit — every level is named, so every jump is the same gesture — and it answers
 * a question a back button never does, which is where the reader currently is.
 *
 * The last crumb renders as text, never as a disabled control. A control that looks
 * clickable and does nothing is worse than no control, and the reader is already there.
 *
 * Steps are BUTTONS, not anchors, and that is deliberate: a Synapse app lives in an iframe
 * with no address of its own, so a crumb changes app state rather than navigating to a URL.
 * There is no href to put on an anchor, and a `<span>` with a click handler is reachable by
 * neither keyboard nor screen reader.
 */

import type { HTMLAttributes } from "react";
import { Fragment } from "react";
import { tokens } from "../tokens.js";
import { Text } from "../typography.js";
import { TextLink } from "./Button.js";

export interface Crumb {
  label: string;
  /** Omit on the current step. A crumb with no handler renders as plain text. */
  onClick?: () => void;
}

interface BreadcrumbProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  crumbs: Crumb[];
  /** The glyph between steps. */
  separator?: string;
}

export function Breadcrumb({ crumbs, separator = "›", style, ...rest }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
        flexWrap: "wrap",
        minWidth: 0,
        ...style,
      }}
      {...rest}
    >
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a crumb's POSITION is its identity — "the second level" is what the step means, and two levels can legitimately carry the same label. There is no id to key on, and a trail that changed shape SHOULD remount rather than reconcile a step into a different depth.
          <Fragment key={`${crumb.label}:${i}`}>
            {last || !crumb.onClick ? (
              <Text
                size="xs"
                tone={last ? "muted" : "default"}
                aria-current={last ? "page" : undefined}
              >
                {crumb.label}
              </Text>
            ) : (
              <TextLink onClick={crumb.onClick} style={{ fontSize: tokens.textXsSize }}>
                {crumb.label}
              </TextLink>
            )}
            {last ? null : (
              <Text size="xs" tone="faint" aria-hidden="true">
                {separator}
              </Text>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
