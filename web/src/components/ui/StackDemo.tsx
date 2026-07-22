import { Card, Divider, Heading, Stack, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function StackDemo() {
  return (
    <Preview>
      <Stack gap={20}>
        <Stack gap={8}>
          <Heading size="sm">Vertical rhythm</Heading>
          <Card padding="0.6rem 0.85rem">
            <Text size="sm">Deploy the runtime</Text>
          </Card>
          <Card padding="0.6rem 0.85rem">
            <Text size="sm">Wire the connectors</Text>
          </Card>
          <Card padding="0.6rem 0.85rem">
            <Text size="sm">Ship the app</Text>
          </Card>
        </Stack>
        <Divider />
        <Stack gap={6} align="center">
          <Text weight="semibold">Centered column</Text>
          <Text tone="muted" size="sm">
            align "center" centers each child on the cross axis.
          </Text>
        </Stack>
      </Stack>
    </Preview>
  );
}
