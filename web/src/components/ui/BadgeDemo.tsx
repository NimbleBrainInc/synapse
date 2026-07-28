import { Badge, Inline } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function BadgeDemo() {
  return (
    <Preview>
      <Inline gap={8} wrap>
        <Badge>Neutral</Badge>
        <Badge tone="accent">Accent</Badge>
        <Badge tone="success">Success</Badge>
        <Badge tone="warning">Warning</Badge>
        <Badge tone="danger">Danger</Badge>
        <Badge tone="processing">Processing</Badge>
      </Inline>
    </Preview>
  );
}
