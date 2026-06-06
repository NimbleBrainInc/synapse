import {
  AppFrame,
  Avatar,
  Badge,
  type BadgeTone,
  Button,
  Card,
  Divider,
  EmptyState,
  Heading,
  Inline,
  ListRow,
  Pagination,
  Prose,
  SearchField,
  SegmentedControl,
  SidebarLayout,
  Spacer,
  Spinner,
  Stack,
  type Status,
  StatusDot,
  Text,
  TextLink,
  tokens,
} from "@nimblebrain/synapse/ui";
import { type ReactNode, useEffect, useState } from "react";
import { applyTheme, type Mode, type ThemeKey, THEMES } from "./demo-theme.js";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Stack gap="1.25rem" style={{ marginBottom: "3.5rem" }}>
      <Stack gap="0.25rem">
        <Heading size="sm">{title}</Heading>
        {subtitle ? (
          <Text size="sm" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </Stack>
      {children}
    </Stack>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <Stack gap="0.4rem">
      <div
        style={{
          height: 44,
          borderRadius: tokens.radiusSm,
          background: value,
          border: `1px solid ${tokens.border}`,
        }}
      />
      <Text size="xs" mono tone="muted">
        {name}
      </Text>
    </Stack>
  );
}

function Grid({ min = 120, children }: { min?: number; children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
        gap: "1rem",
      }}
    >
      {children}
    </div>
  );
}

const BADGE_TONES: BadgeTone[] = [
  "neutral",
  "accent",
  "success",
  "warning",
  "danger",
  "processing",
  "warm",
];
const STATUSES: Status[] = ["working", "completed", "failed", "idle"];

const PROSE_HTML = `
<h2>Reading typography</h2>
<p>The <code>Prose</code> container styles rendered HTML with the active theme's
reading scale — headings in the heading font, body in the sans, code in mono.
Bring your own parser; <code>Prose</code> owns the styling.</p>
<ul><li>Token-driven, theme-aware</li><li>Dependency-free</li></ul>
<blockquote>One system, per-app personality.</blockquote>
`;

function NavItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      style={{
        textAlign: "left",
        border: "none",
        cursor: "pointer",
        background: active ? tokens.bgSubtle : "transparent",
        color: active ? tokens.fg : tokens.fgMuted,
        fontFamily: tokens.fontSans,
        fontSize: tokens.textSmSize,
        fontWeight: active ? tokens.weightMedium : tokens.weightNormal,
        padding: "0.4rem 0.6rem",
        borderRadius: tokens.radiusSm,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

export function App() {
  const [theme, setTheme] = useState<ThemeKey>("default");
  const [mode, setMode] = useState<Mode>("light");
  const [view, setView] = useState("board");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(2);
  const [layoutMode, setLayoutMode] = useState("reflow");
  const [paneWidth, setPaneWidth] = useState(760);

  useEffect(() => {
    applyTheme(theme, mode);
  }, [theme, mode]);

  return (
    <div style={{ minHeight: "100vh", background: tokens.bg, color: tokens.fg }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 1.5rem 6rem" }}>
        {/* Header */}
        <Inline align="start" style={{ marginBottom: "0.5rem" }}>
          <Stack gap="0.35rem">
            <Heading size="lg">Synapse UI</Heading>
            <Text size="sm" tone="muted">
              Brand book &amp; component reference — @nimblebrain/synapse/ui
            </Text>
          </Stack>
          <Spacer />
          <Stack gap="0.5rem" align="end">
            <SegmentedControl
              aria-label="Theme"
              value={theme}
              onChange={(t) => setTheme(t as ThemeKey)}
              options={THEMES.map((t) => ({ label: t.label, value: t.key }))}
            />
            <SegmentedControl
              aria-label="Mode"
              value={mode}
              onChange={(m) => setMode(m as Mode)}
              options={[
                { label: "Light", value: "light" },
                { label: "Dark", value: "dark" },
              ]}
            />
          </Stack>
        </Inline>
        <Text size="xs" tone="faint" style={{ display: "block", marginTop: "0.75rem" }}>
          The components bake in no brand — the host injects the theme as CSS variables. Switch the
          theme above to re-skin everything below; the library code is identical across all of them.
        </Text>
        <Divider style={{ margin: "1.5rem 0 2.5rem" }} />

        <Section title="Color" subtitle="Surfaces, text, borders, and brand semantics.">
          <Grid>
            <Swatch name="bg" value={tokens.bg} />
            <Swatch name="bgRaised" value={tokens.bgRaised} />
            <Swatch name="bgSubtle" value={tokens.bgSubtle} />
            <Swatch name="fg" value={tokens.fg} />
            <Swatch name="fgMuted" value={tokens.fgMuted} />
            <Swatch name="fgFaint" value={tokens.fgFaint} />
            <Swatch name="accent" value={tokens.accent} />
            <Swatch name="border" value={tokens.border} />
            <Swatch name="danger" value={tokens.danger} />
            <Swatch name="success" value={tokens.success} />
            <Swatch name="warning" value={tokens.warning} />
            <Swatch name="warm" value={tokens.warm} />
            <Swatch name="processing" value={tokens.processing} />
            <Swatch name="infoLight" value={tokens.infoLight} />
          </Grid>
        </Section>

        <Section
          title="Typography"
          subtitle="Heading, body, and mono font slots — set by the active theme."
        >
          <Stack gap="0.75rem">
            <Heading size="lg">Heading large</Heading>
            <Heading size="md">Heading medium</Heading>
            <Heading size="sm">Heading small</Heading>
            <Divider />
            <Text size="lg">Body large — the quick brown fox.</Text>
            <Text size="base">Body base — the quick brown fox.</Text>
            <Text size="sm" tone="muted">
              Body small muted — the quick brown fox.
            </Text>
            <Text size="xs" tone="faint">
              Body xs faint — the quick brown fox.
            </Text>
            <Inline gap="1rem" wrap>
              <Text weight="normal">Normal</Text>
              <Text weight="medium">Medium</Text>
              <Text weight="semibold">Semibold</Text>
              <Text weight="bold">Bold</Text>
              <Text mono>mono 0123</Text>
            </Inline>
          </Stack>
        </Section>

        <Section title="Radius &amp; shadow">
          <Inline gap="1.5rem" wrap align="end">
            {(["radiusXs", "radiusSm", "radiusMd", "radiusLg", "radiusXl"] as const).map((r) => (
              <Stack key={r} gap="0.4rem" align="center">
                <div
                  style={{
                    width: 56,
                    height: 56,
                    background: tokens.bgSubtle,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: tokens[r],
                  }}
                />
                <Text size="xs" mono tone="muted">
                  {r}
                </Text>
              </Stack>
            ))}
            {(["shadowSm", "shadowMd", "shadowLg"] as const).map((s) => (
              <Stack key={s} gap="0.4rem" align="center">
                <div
                  style={{
                    width: 56,
                    height: 56,
                    background: tokens.bgRaised,
                    borderRadius: tokens.radiusMd,
                    boxShadow: tokens[s],
                  }}
                />
                <Text size="xs" mono tone="muted">
                  {s}
                </Text>
              </Stack>
            ))}
          </Inline>
        </Section>

        <Section title="Primitives" subtitle="Stack, Inline, Spacer, Divider.">
          <Card>
            <Stack gap="0.75rem">
              <Inline gap="0.5rem">
                <Badge tone="accent">Inline</Badge>
                <Badge tone="neutral">with</Badge>
                <Badge tone="warm">gap</Badge>
                <Spacer />
                <Text size="xs" tone="faint">
                  ← Spacer pushes →
                </Text>
              </Inline>
              <Divider />
              <Text size="sm" tone="muted">
                Stack lays these out vertically with a consistent gap.
              </Text>
            </Stack>
          </Card>
        </Section>

        <Section title="Buttons &amp; links">
          <Stack gap="1rem">
            <Inline gap="0.75rem" wrap>
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button size="sm">Small</Button>
              <Button disabled>Disabled</Button>
              <Button variant="secondary">
                <Spinner size={13} /> Loading
              </Button>
            </Inline>
            <Inline gap="1.25rem">
              <TextLink>Back</TextLink>
              <TextLink tone="default">Open</TextLink>
              <TextLink tone="danger">Delete</TextLink>
            </Inline>
          </Stack>
        </Section>

        <Section title="Badges &amp; status">
          <Stack gap="1rem">
            <Inline gap="0.5rem" wrap>
              {BADGE_TONES.map((t) => (
                <Badge key={t} tone={t}>
                  {t}
                </Badge>
              ))}
            </Inline>
            <Inline gap="1.25rem" wrap>
              {STATUSES.map((s) => (
                <Inline key={s} gap="0.4rem">
                  <StatusDot status={s} />
                  <Text size="sm" tone="muted">
                    {s}
                  </Text>
                </Inline>
              ))}
            </Inline>
          </Stack>
        </Section>

        <Section title="Inputs">
          <Stack gap="1rem" style={{ maxWidth: 360 }}>
            <SearchField
              variant="underline"
              placeholder="Underline search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <SearchField variant="boxed" placeholder="Boxed search…" />
            <SegmentedControl
              aria-label="View"
              value={view}
              onChange={setView}
              options={[
                { label: "Board", value: "board" },
                { label: "Table", value: "table" },
                { label: "Timeline", value: "timeline" },
              ]}
            />
          </Stack>
        </Section>

        <Section title="List rows" subtitle="Leading slot, title + meta, trailing slot. Hover for the tint.">
          <Card padding="0.35rem">
            <ListRow
              interactive
              leading={<StatusDot status="working" />}
              title="Red Night Consulting / Chris Ploessel context"
              meta="research · 21h ago"
              trailing={<Text size="xs" tone="faint">21h</Text>}
            />
            <ListRow
              interactive
              leading={<StatusDot status="completed" />}
              title="Jordan Ratner re-engagement hook"
              meta="research · 22h ago"
              trailing={<Avatar name="Jordan Ratner" size={22} />}
            />
            <ListRow
              interactive
              leading={<StatusDot status="failed" />}
              title="LinkDoctor.io DL research"
              meta="research · 6d ago"
              trailing={<Badge tone="danger">failed</Badge>}
            />
          </Card>
        </Section>

        <Section title="Cards &amp; avatars">
          <Grid min={220}>
            <Card interactive>
              <Stack gap="0.5rem">
                <Inline gap="0.5rem">
                  <Avatar name="John Smith" />
                  <Stack gap="0.1rem">
                    <Text weight="medium">John Smith</Text>
                    <Text size="xs" tone="muted">
                      Interactive card
                    </Text>
                  </Stack>
                </Inline>
                <Text size="sm" tone="muted">
                  Hover to see the lift.
                </Text>
              </Stack>
            </Card>
            <Card>
              <Inline gap="0.5rem" wrap>
                <Avatar name="Ada Lovelace" size={36} />
                <Avatar name="Grace Hopper" size={36} />
                <Avatar name="mat" size={36} />
              </Inline>
            </Card>
          </Grid>
        </Section>

        <Section title="Pagination">
          <Pagination page={page} pageCount={6} onChange={setPage} />
        </Section>

        <Section title="Prose">
          <Card>
            <Prose html={PROSE_HTML} />
          </Card>
        </Section>

        <Section title="Empty state">
          <Card>
            <EmptyState
              title="No conversations yet"
              description="Start a chat and it will show up here."
              action={<Button size="sm">New conversation</Button>}
            />
          </Card>
        </Section>

        <Section
          title="Layouts — SidebarLayout"
          subtitle="The responsive two-column layout. Drag the pane width past the 560px breakpoint and watch the rail collapse — to a top strip (reflow) or an off-canvas drawer."
        >
          <Stack gap="1rem">
            <Inline gap="1.5rem" wrap>
              <SegmentedControl
                aria-label="Collapse mode"
                value={layoutMode}
                onChange={setLayoutMode}
                options={[
                  { label: "reflow", value: "reflow" },
                  { label: "drawer", value: "drawer" },
                ]}
              />
              <Inline gap="0.6rem">
                <Text size="sm" tone="muted">
                  Pane width
                </Text>
                <input
                  type="range"
                  min={320}
                  max={920}
                  value={paneWidth}
                  onChange={(e) => setPaneWidth(Number(e.target.value))}
                  style={{ accentColor: tokens.accent }}
                />
                <Text size="sm" mono tone="muted">
                  {paneWidth}px
                </Text>
              </Inline>
            </Inline>

            <div
              style={{
                width: paneWidth,
                maxWidth: "100%",
                height: 380,
                border: `1px solid ${tokens.border}`,
                borderRadius: tokens.radiusMd,
                overflow: "hidden",
                boxShadow: tokens.shadowSm,
              }}
            >
              <AppFrame>
                <AppFrame.Header>
                  <Heading size="sm">Settings</Heading>
                </AppFrame.Header>
                <AppFrame.Body bleed>
                  <SidebarLayout
                    collapseMode={layoutMode as "reflow" | "drawer"}
                    breakpoint={560}
                    width={180}
                  >
                    <SidebarLayout.Sidebar>
                      {["General", "Skills", "Members", "Billing"].map((item, i) => (
                        <NavItem key={item} label={item} active={i === 0} />
                      ))}
                    </SidebarLayout.Sidebar>
                    <SidebarLayout.Main>
                      <div style={{ padding: "1.25rem 1.5rem" }}>
                        <Stack gap="0.75rem">
                          <Inline gap="0.5rem">
                            <SidebarLayout.Trigger />
                            <Heading size="sm">General</Heading>
                          </Inline>
                          <Text size="sm" tone="muted">
                            {layoutMode === "reflow"
                              ? "Below 560px the rail reflows to a strip on top."
                              : "Below 560px the rail collapses to a drawer — open it with the ☰ button."}
                          </Text>
                          <SearchField variant="boxed" placeholder="Display name" />
                          <Inline gap="0.5rem">
                            <Button size="sm">Save</Button>
                            <Button size="sm" variant="ghost">
                              Cancel
                            </Button>
                          </Inline>
                        </Stack>
                      </div>
                    </SidebarLayout.Main>
                  </SidebarLayout>
                </AppFrame.Body>
              </AppFrame>
            </div>
          </Stack>
        </Section>
      </div>
    </div>
  );
}
