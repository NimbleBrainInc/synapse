import { Stack, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function TextDemo() {
  return (
    <Preview>
      <Stack gap={16}>
        <Stack gap={6}>
          <Text size="lg">Large body text</Text>
          <Text size="base">Base body text</Text>
          <Text size="sm">Small body text</Text>
          <Text size="xs">Extra-small body text</Text>
        </Stack>
        <Stack gap={6}>
          <Text weight="semibold">Semibold weight</Text>
          <Text tone="muted">Muted tone</Text>
          <Text tone="danger">Danger tone</Text>
          <Text mono>mono: sk-live-8f2a1c</Text>
          <Text truncate style={{ maxWidth: 220 }}>
            Truncated single line that ellipses when it runs past its container width
          </Text>
        </Stack>
      </Stack>
    </Preview>
  );
}
