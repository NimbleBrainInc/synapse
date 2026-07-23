import { Button, EmptyState } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function EmptyStateDemo() {
  return (
    <Preview>
      <EmptyState
        icon={<span style={{ fontSize: 32 }}>📭</span>}
        title="No tasks yet"
        description="Everything you add will show up here. Create your first task to get started."
        action={<Button size="sm">New task</Button>}
      />
    </Preview>
  );
}
