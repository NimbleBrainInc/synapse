import { useState } from "react";
import { Button, Drawer, Inline, Stack, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function DrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Preview>
      <Button onClick={() => setOpen(true)}>Open drawer</Button>
      <Drawer open={open} onClose={() => setOpen(false)}>
        <Drawer.Header title="Contact details" onClose={() => setOpen(false)} />
        <Drawer.Body>
          <Stack gap={12}>
            <Text>
              Drawer is built on the native <Text mono>&lt;dialog&gt;</Text> element, so
              focus trapping, Escape to close, and scroll locking come for free.
            </Text>
            <Text tone="muted" size="sm">
              Press Escape or click the backdrop to dismiss.
            </Text>
          </Stack>
        </Drawer.Body>
        <Drawer.Footer>
          <Inline gap={10} justify="end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save</Button>
          </Inline>
        </Drawer.Footer>
      </Drawer>
    </Preview>
  );
}
