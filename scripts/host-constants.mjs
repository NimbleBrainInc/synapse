#!/usr/bin/env node
// The NimbleBrain host's constants, as Synapse tests against them.
//
//   node scripts/host-constants.mjs refresh   replace the snapshot with the published document
//   node scripts/host-constants.mjs check     fail when the snapshot differs from it
//
// The snapshot is src/__tests__/host-constants/nimblebrain-host.constants.json,
// and src/__tests__/host-constants.test.ts holds Synapse's own constants equal to
// it. The host generates the document from its bridge and publishes it beside its
// JSON Schemas, so the snapshot is a copy of what the host serves and never edited
// to make a test pass. HOST_CONSTANTS_URL overrides the address, for a document
// that is not published yet.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HOST_CONSTANTS_URL =
  process.env.HOST_CONSTANTS_URL ??
  "https://schemas.nimblebrain.ai/v1/nimblebrain-host-bridge.constants.json";
const SNAPSHOT = fileURLToPath(
  new URL("../src/__tests__/host-constants/nimblebrain-host.constants.json", import.meta.url),
);
/** The document shape the parity test reads. A host that changes it bumps `version`. */
const KNOWN_VERSION = 1;

const mode = process.argv[2];
if (mode !== "refresh" && mode !== "check") {
  console.error("usage: node scripts/host-constants.mjs <refresh|check>");
  process.exit(2);
}

const response = await fetch(HOST_CONSTANTS_URL);
if (!response.ok) {
  console.error(`${HOST_CONSTANTS_URL} answered ${response.status}; the snapshot is unchanged.`);
  process.exit(1);
}
const published = await response.json();
if (published?.version !== KNOWN_VERSION) {
  console.error(
    `${HOST_CONSTANTS_URL} is version ${published?.version}; this script and host-constants.test.ts read version ${KNOWN_VERSION}.`,
  );
  process.exit(1);
}

// Compared and written as parsed JSON in one layout, so the host's formatting
// never shows up as a difference.
const serialized = `${JSON.stringify(published, null, 2)}\n`;
if (mode === "refresh") {
  await writeFile(SNAPSHOT, serialized);
  console.log(`Wrote ${SNAPSHOT}. Run \`npm run lint:fix && npm test\`.`);
} else {
  const current = JSON.stringify(JSON.parse(await readFile(SNAPSHOT, "utf8")), null, 2);
  if (`${current}\n` !== serialized) {
    console.error(
      "The snapshot differs from the published host constants. Run `npm run host-constants:refresh`.",
    );
    process.exit(1);
  }
  console.log("The snapshot matches the published host constants.");
}
