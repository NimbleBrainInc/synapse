import { Avatar, Badge, ListRow, Stack, StatusDot } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function ListRowDemo() {
  return (
    <Preview>
      <Stack gap={4}>
        <ListRow
          leading={<Avatar name="Jordan Ratner" />}
          title="Jordan Ratner"
          meta="jordan@acme.co · Last touched 2d ago"
          trailing={<Badge tone="success">Won</Badge>}
        />
        <ListRow
          leading={<Avatar name="Priya Nair" />}
          title="Priya Nair"
          meta="priya@globex.io · Last touched 5h ago"
          trailing={<Badge tone="warning">At risk</Badge>}
          interactive
        />
        <ListRow
          leading={<StatusDot status="working" />}
          title="Nightly sync"
          meta="Running — 412 records processed"
          trailing="12:04"
        />
      </Stack>
    </Preview>
  );
}
