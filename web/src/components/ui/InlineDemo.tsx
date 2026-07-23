import { Badge, Divider, Heading, Inline, Stack, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function InlineDemo() {
  return (
    <Preview>
      <Stack gap={16}>
        <Inline gap={10}>
          <Badge tone="accent">New</Badge>
          <Text>Inline lays children left to right, vertically centered.</Text>
        </Inline>
        <Divider />
        <Inline gap={8} justify="between">
          <Text weight="semibold">Acme renewal</Text>
          <Text tone="muted" size="sm">$12,000</Text>
        </Inline>
        <Inline gap={8} align="baseline">
          <Heading size="lg">42</Heading>
          <Text tone="muted" size="sm">open tasks</Text>
        </Inline>
      </Stack>
    </Preview>
  );
}
