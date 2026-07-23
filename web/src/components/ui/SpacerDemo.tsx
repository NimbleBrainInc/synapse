import { Badge, Inline, Spacer, Stack, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function SpacerDemo() {
  return (
    <Preview>
      <Stack gap={12}>
        <Inline gap={8}>
          <Text weight="semibold">Deal name</Text>
          <Spacer />
          <Badge tone="success">Won</Badge>
        </Inline>
        <Inline gap={8}>
          <Text weight="semibold">Follow-up call</Text>
          <Spacer />
          <Text tone="muted" size="sm">Due today</Text>
        </Inline>
      </Stack>
    </Preview>
  );
}
