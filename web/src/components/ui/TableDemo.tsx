import { Badge, type Column, Table } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

interface Person {
  id: number;
  name: string;
  role: string;
  deals: number;
  stage: "Won" | "Open" | "Lost";
}

const people: Person[] = [
  { id: 1, name: "Jordan Ratner", role: "VP Sales", deals: 12, stage: "Won" },
  { id: 2, name: "Priya Nair", role: "Head of Ops", deals: 7, stage: "Open" },
  { id: 3, name: "Sam Okoye", role: "Founder", deals: 3, stage: "Lost" },
];

const stageTone = { Won: "success", Open: "accent", Lost: "danger" } as const;

const columns: Column<Person>[] = [
  { key: "name", header: "Name", render: (p) => p.name },
  { key: "role", header: "Role", render: (p) => p.role },
  { key: "deals", header: "Deals", align: "right", render: (p) => p.deals },
  {
    key: "stage",
    header: "Stage",
    render: (p) => <Badge tone={stageTone[p.stage]}>{p.stage}</Badge>,
  },
];

export default function TableDemo() {
  return (
    <Preview>
      <Table
        data={people}
        columns={columns}
        rowKey={(p) => p.id}
        onRowClick={(p) => window.alert(`Opened ${p.name}`)}
      />
    </Preview>
  );
}
