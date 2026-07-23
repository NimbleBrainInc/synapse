import { Card, Heading, Stack, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function CardDemo() {
  return (
    <Preview>
      <Stack gap={16}>
        <Card>
          <Stack gap={6}>
            <Heading size="sm">Acme migration</Heading>
            <Text size="sm" tone="muted">
              Kickoff scheduled for Thursday. Two open questions on data access.
            </Text>
          </Stack>
        </Card>
        <Card interactive padding="1.25rem">
          <Stack gap={6}>
            <Heading size="sm">Interactive card</Heading>
            <Text size="sm" tone="muted">
              Hover to see the lift, for clickable cards.
            </Text>
          </Stack>
        </Card>
      </Stack>
    </Preview>
  );
}
