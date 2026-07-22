import { Heading, SidebarLayout, Text } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

const nav = ["Overview", "Contacts", "Deals", "Reports", "Settings"];

export default function SidebarLayoutDemo() {
  return (
    <Preview padding={0}>
      <div style={{ height: 340 }}>
        <SidebarLayout width={160} breakpoint={360}>
          <SidebarLayout.Sidebar>
            {nav.map((label, i) => (
              <div
                key={label}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 14,
                  cursor: "pointer",
                  background: i === 1 ? "var(--color-background-tertiary)" : "transparent",
                  color: i === 1 ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                }}
              >
                {label}
              </div>
            ))}
          </SidebarLayout.Sidebar>
          <SidebarLayout.Main>
            <div style={{ padding: 20 }}>
              <Heading size="md">Contacts</Heading>
              <Text tone="muted">
                The rail reacts to its own width, not the device — narrow the pane and it
                reflows to a strip on top.
              </Text>
            </div>
          </SidebarLayout.Main>
        </SidebarLayout>
      </div>
    </Preview>
  );
}
