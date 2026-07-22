import { Heading, Stack } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function HeadingDemo() {
  return (
    <Preview>
      <Stack gap={16}>
        <Stack gap={8}>
          <Heading size="lg">Large heading</Heading>
          <Heading size="md">Medium heading</Heading>
          <Heading size="sm">Small heading</Heading>
        </Stack>
        <Stack gap={8}>
          <Heading size="sm" weight="normal">
            Normal weight
          </Heading>
          <Heading size="sm" weight="bold">
            Bold weight
          </Heading>
          <Heading size="sm" tone="muted">
            Muted tone
          </Heading>
          <Heading size="sm" tone="accent">
            Accent tone
          </Heading>
        </Stack>
      </Stack>
    </Preview>
  );
}
