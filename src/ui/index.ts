/**
 * `@nimblebrain/synapse/ui` — the visual layer for embedded Synapse apps.
 *
 * Token contract + layout primitives + components, all styled with
 * token-driven inline styles that resolve through the host-injected CSS
 * variables (so theming and light/dark work via CSS, no re-render). Brand
 * values are NOT held here — they arrive by injection; fallbacks are neutral.
 *
 * Load brand fonts with a side-effect import: `import "@nimblebrain/synapse/ui/fonts"`.
 */

// Tier C — components
export { Avatar } from "./components/Avatar.js";
export { Badge, type BadgeTone } from "./components/Badge.js";
export { Button, TextLink } from "./components/Button.js";
export { Card } from "./components/Card.js";
export { EmptyState } from "./components/EmptyState.js";
export { ListRow } from "./components/ListRow.js";
export { Pagination } from "./components/Pagination.js";
export { Prose } from "./components/Prose.js";
export { SearchField } from "./components/SearchField.js";
export { SegmentedControl } from "./components/SegmentedControl.js";
export { Spinner } from "./components/Spinner.js";
export { type Status, StatusDot } from "./components/StatusDot.js";
// Font loader (also available as a side-effect import: "@nimblebrain/synapse/ui/fonts")
export { injectFonts } from "./fonts.js";
// Tier A — layout primitives
export { Divider, Inline, Spacer, Stack } from "./primitives.js";
// Foundation — token contract + resolver
export {
  type HeadingSize,
  headingStyle,
  type TextSize,
  type Tokens,
  textStyle,
  tokens,
  useTokens,
} from "./tokens.js";
// Typography
export { Heading, Text } from "./typography.js";
