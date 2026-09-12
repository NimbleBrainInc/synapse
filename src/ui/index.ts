/**
 * `@nimblebrain/synapse/ui` — the visual layer for embedded Synapse apps.
 *
 * Token contract + layout primitives + components, all styled with
 * token-driven inline styles that resolve through the host-injected CSS
 * variables (so theming and light/dark work via CSS, no re-render). Brand
 * values are NOT held here — they arrive by injection; fallbacks are neutral.
 *
 * That includes typography. The fallbacks are web-safe system stacks, so an app
 * renders correctly with no host, no network, and no font files. A host that
 * wants its own typeface sends `@font-face` descriptors on the theme
 * (`Theme.fontFaces`) and the SDK loads them — the SDK itself ships no
 * font data and fetches nothing.
 */

// Tier C — components
export { Avatar } from "./components/Avatar.js";
export { Badge, type BadgeTone } from "./components/Badge.js";
export { Breadcrumb, type Crumb } from "./components/Breadcrumb.js";
export { Button, TextLink } from "./components/Button.js";
export { Card } from "./components/Card.js";
export { ConfirmDialog } from "./components/ConfirmDialog.js";
export { Drawer } from "./components/Drawer.js";
export { EmptyState } from "./components/EmptyState.js";
export { ListRow } from "./components/ListRow.js";
export { PageHeader } from "./components/PageHeader.js";
export { Pagination } from "./components/Pagination.js";
export { Prose } from "./components/Prose.js";
export { SearchField } from "./components/SearchField.js";
export { SegmentedControl } from "./components/SegmentedControl.js";
export { Spinner } from "./components/Spinner.js";
export { type Status, StatusDot } from "./components/StatusDot.js";
export { type Column, Table } from "./components/Table.js";
export { Tabs } from "./components/Tabs.js";
// Tier B1 — layout scaffolds: they DIVIDE the pane into regions, and own the scroll and
// responsive behaviour of each. One per screen, outermost.
export { AppFrame } from "./layouts/AppFrame.js";
export { ListDetailLayout, useListDetail } from "./layouts/ListDetailLayout.js";
// Tier B2 — page templates: they ARRANGE content inside one region a scaffold produced.
//
// A different category from the scaffolds above, and the distinction is what keeps the next
// one from being invented ad hoc. A page template:
//
//   * fills a region (in practice `AppFrame.Body`) and never creates one — no panes, no
//     scroll ownership, no responsive pane behaviour;
//   * owns the ORDER and vertical rhythm of the parts it takes, which is the whole reason it
//     is a component rather than a documented recipe;
//   * draws no chrome. An embedded app does not own its window: the host spends the left edge
//     on a rail and the right on a chat panel, so a bar of the app's own is a third layer
//     whose rule cannot agree with the host's.
//
// `PageLayout` is the standard one and, for now, the only one. Siblings are expected — a
// full-bleed reading page for a single artefact is the obvious next — but a taxonomy built
// for a family of one is a guess about the second member. The contract above is what the
// second one has to satisfy; write it when there is a second screen that needs it.
export { PageLayout } from "./layouts/PageLayout.js";
export { SidebarLayout, useSidebar } from "./layouts/SidebarLayout.js";
export { useBreakpoint } from "./layouts/use-container-width.js";
// Tier A — layout primitives
export { Divider, Inline, Spacer, Stack } from "./primitives.js";
// Foundation — token contract
export {
  type HeadingSize,
  headingStyle,
  type TextSize,
  type Tokens,
  textStyle,
  tokens,
} from "./tokens.js";
// Typography
export { Heading, Text } from "./typography.js";
