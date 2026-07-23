import { Inline, TextLink } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function TextLinkDemo() {
  return (
    <Preview>
      <Inline gap={20} align="center">
        <TextLink>Muted</TextLink>
        <TextLink tone="default">Default</TextLink>
        <TextLink tone="danger">Danger</TextLink>
      </Inline>
    </Preview>
  );
}
