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
 * (`SynapseTheme.fontFaces`) and the SDK loads them — the SDK itself ships no
 * font data and fetches nothing.
 */

// Tier C — components
export { Avatar } from "./components/Avatar.js";
export { Badge, type BadgeTone } from "./components/Badge.js";
export { Button, TextLink } from "./components/Button.js";
export { Card } from "./components/Card.js";
export { Drawer } from "./components/Drawer.js";
export { EmptyState } from "./components/EmptyState.js";
export { ListRow } from "./components/ListRow.js";
export { Pagination } from "./components/Pagination.js";
export { Prose } from "./components/Prose.js";
export { SearchField } from "./components/SearchField.js";
export { SegmentedControl } from "./components/SegmentedControl.js";
export { Spinner } from "./components/Spinner.js";
export { type Status, StatusDot } from "./components/StatusDot.js";
export { type Column, Table } from "./components/Table.js";
// Tier B — layout scaffolds + responsive hooks
export { AppFrame } from "./layouts/AppFrame.js";
export { ListDetailLayout, useListDetail } from "./layouts/ListDetailLayout.js";
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
