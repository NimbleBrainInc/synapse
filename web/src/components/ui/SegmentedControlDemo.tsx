import { SegmentedControl, Stack } from "@nimblebrain/synapse/ui";
import { useState } from "react";
import { Preview } from "./Preview";

export default function SegmentedControlDemo() {
  const [view, setView] = useState<"board" | "table">("board");
  const [range, setRange] = useState<"all" | "today" | "week">("today");
  return (
    <Preview>
      <Stack gap={16}>
        <SegmentedControl
          options={[
            { label: "Board", value: "board" },
            { label: "Table", value: "table" },
          ]}
          value={view}
          onChange={setView}
        />
        <SegmentedControl
          options={[
            { label: "All", value: "all" },
            { label: "Today", value: "today" },
            { label: "Week", value: "week" },
          ]}
          value={range}
          onChange={setRange}
        />
      </Stack>
    </Preview>
  );
}
