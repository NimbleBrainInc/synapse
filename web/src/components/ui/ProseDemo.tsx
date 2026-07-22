import { Prose } from "@nimblebrain/synapse/ui";
import { Preview } from "./Preview";

export default function ProseDemo() {
  return (
    <Preview>
      <Prose>
        <h2>Reading typography</h2>
        <p>
          Prose styles rendered rich text: headings, paragraphs, lists, links, and{" "}
          <code>code</code>, with the host's reading scale. Bring your own markdown
          parser; Prose owns the styling, not the parsing.
        </p>
        <ul>
          <li>Consistent line-height and rhythm</li>
          <li>
            <a href="#">Themed links</a> that resolve from the accent token
          </li>
          <li>First and last children shed their outer margins</li>
        </ul>
      </Prose>
    </Preview>
  );
}
