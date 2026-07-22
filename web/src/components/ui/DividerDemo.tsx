import { Divider, Inline, Stack, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function DividerDemo() {
  return (
    <Preview>
      <Stack gap={12}>
        <Text>Above the rule</Text>
        <Divider />
        <Text>Below the rule</Text>
        <Inline gap={12} align="center">
          <Text tone="muted" size="sm">Drafts</Text>
          <Divider orientation="vertical" style={{ height: 16 }} />
          <Text tone="muted" size="sm">Sent</Text>
          <Divider orientation="vertical" style={{ height: 16 }} />
          <Text tone="muted" size="sm">Archived</Text>
        </Inline>
      </Stack>
    </Preview>
  );
}
