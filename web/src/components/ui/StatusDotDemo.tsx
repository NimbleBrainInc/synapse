import { Inline, Stack, StatusDot, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function StatusDotDemo() {
  return (
    <Preview>
      <Stack gap={12}>
        <Inline gap={8}>
          <StatusDot status="working" />
          <Text size="sm">Working (pulses)</Text>
        </Inline>
        <Inline gap={8}>
          <StatusDot status="completed" />
          <Text size="sm">Completed</Text>
        </Inline>
        <Inline gap={8}>
          <StatusDot status="failed" />
          <Text size="sm">Failed</Text>
        </Inline>
        <Inline gap={8}>
          <StatusDot status="idle" />
          <Text size="sm">Idle</Text>
        </Inline>
        <Inline gap={8}>
          <StatusDot color="#a855f7" size={12} />
          <Text size="sm">Custom color + size</Text>
        </Inline>
      </Stack>
    </Preview>
  );
}
