import { useState } from "react";
import { Avatar, Badge, Heading, ListDetailLayout, ListRow, Stack, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

const people = [
  { id: "1", name: "Jane Doe", company: "Acme", email: "jane@acme.com" },
  { id: "2", name: "Marco Ruiz", company: "Northwind", email: "marco@northwind.com" },
  { id: "3", name: "Priya Shah", company: "Globex", email: "priya@globex.com" },
];

export default function ListDetailLayoutDemo() {
  const [id, setId] = useState<string | null>("1");
  const person = people.find((p) => p.id === id) ?? null;
  return (
    <Preview padding={0}>
      <div style={{ height: 340 }}>
        <ListDetailLayout
          selected={id !== null}
          onBack={() => setId(null)}
          listWidth={200}
          breakpoint={360}
        >
          <ListDetailLayout.List>
            {people.map((p) => (
              <ListRow
                key={p.id}
                interactive
                onClick={() => setId(p.id)}
                leading={<Avatar name={p.name} />}
                title={p.name}
                meta={p.company}
              />
            ))}
          </ListDetailLayout.List>
          <ListDetailLayout.Detail>
            <ListDetailLayout.Back />
            <div style={{ padding: 20 }}>
              {person ? (
                <Stack gap={8}>
                  <Heading size="md">{person.name}</Heading>
                  <Text tone="muted">{person.company}</Text>
                  <Badge tone="success">Active</Badge>
                  <Text mono size="sm">
                    {person.email}
                  </Text>
                </Stack>
              ) : (
                <Text tone="muted">Select a contact.</Text>
              )}
            </div>
          </ListDetailLayout.Detail>
        </ListDetailLayout>
      </div>
    </Preview>
  );
}
