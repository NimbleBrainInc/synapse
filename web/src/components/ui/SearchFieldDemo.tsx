import { SearchField, Stack } from "@nimblebrain/synapse/ui";
import { useState } from "react";
import { Preview } from "./Preview";

export default function SearchFieldDemo() {
  const [underline, setUnderline] = useState("");
  const [boxed, setBoxed] = useState("");
  return (
    <Preview>
      <Stack gap={16}>
        <SearchField
          placeholder="Search (underline)…"
          value={underline}
          onChange={(e) => setUnderline(e.target.value)}
        />
        <SearchField
          variant="boxed"
          placeholder="Search (boxed)…"
          value={boxed}
          onChange={(e) => setBoxed(e.target.value)}
        />
      </Stack>
    </Preview>
  );
}
