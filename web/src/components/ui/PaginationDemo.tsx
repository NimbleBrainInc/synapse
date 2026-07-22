import { Pagination, Stack, Text } from "@nimblebrain/synapse/ui";
import { useState } from "react";
import { Preview } from "./Preview";

export default function PaginationDemo() {
  const [page, setPage] = useState(1);
  return (
    <Preview>
      <Stack gap={12}>
        <Text size="sm" tone="muted">
          Showing page {page} of 5
        </Text>
        <Pagination page={page} pageCount={5} onChange={setPage} />
      </Stack>
    </Preview>
  );
}
