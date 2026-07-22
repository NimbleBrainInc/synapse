import { Inline, Spinner } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function SpinnerDemo() {
  return (
    <Preview>
      <Inline gap={24} align="center">
        <Spinner />
        <Spinner size={24} />
        <Spinner size={40} />
      </Inline>
    </Preview>
  );
}
