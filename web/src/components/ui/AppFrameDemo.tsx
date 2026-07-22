import { AppFrame, Badge, Heading, Inline, ListRow, StatusDot, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

const runs = [
  { name: "Nightly sync", meta: "Acme · finished 2m ago", status: "completed" as const },
  { name: "Enrich contacts", meta: "Northwind · running", status: "working" as const },
  { name: "Export report", meta: "Globex · failed", status: "failed" as const },
];

export default function AppFrameDemo() {
  return (
    <Preview padding={0}>
      <div style={{ height: 420 }}>
        <AppFrame>
          <AppFrame.Header>
            <Inline align="center">
              <Heading size="md">Runs</Heading>
              <div style={{ flex: 1 }} />
              <Badge tone="processing">3 active</Badge>
            </Inline>
          </AppFrame.Header>
          <AppFrame.Body>
            {runs.map((r) => (
              <ListRow
                key={r.name}
                leading={<StatusDot status={r.status} />}
                title={r.name}
                meta={r.meta}
              />
            ))}
          </AppFrame.Body>
          <AppFrame.Footer>
            <Text tone="muted" size="sm">
              Header, scrollable body, footer — the shell fills the pane.
            </Text>
          </AppFrame.Footer>
        </AppFrame>
      </div>
    </Preview>
  );
}
