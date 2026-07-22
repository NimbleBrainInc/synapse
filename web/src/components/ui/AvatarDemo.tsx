import { Avatar, Inline } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function AvatarDemo() {
  return (
    <Preview>
      <Inline gap={14} align="center">
        <Avatar name="Jordan Ratner" />
        <Avatar name="Priya Nair" />
        <Avatar name="mat" />
        <Avatar name="Sam Okoye" size={40} />
        <Avatar name="Ada Lovelace" src="https://i.pravatar.cc/96?img=47" size={40} />
        <Avatar name="Grace Hopper" size={56} />
      </Inline>
    </Preview>
  );
}
