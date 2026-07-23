import { Button, Inline, Stack } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function ButtonDemo() {
  return (
    <Preview>
      <Stack gap={16}>
        <Inline gap={10}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
        </Inline>
        <Inline gap={10} align="center">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button disabled>Disabled</Button>
        </Inline>
      </Stack>
    </Preview>
  );
}
