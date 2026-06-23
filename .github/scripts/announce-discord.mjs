#!/usr/bin/env node
// Post a release announcement to a Discord webhook. Formats mechanically from
// the GitHub Release: title + lead paragraph (word-boundary capped) + link.
// Transport-agnostic formatting lives here so it can move into a shared action
// verbatim when we extend to nimblebrain / mpak.
//
// Env:
//   WEBHOOK_URL   Discord webhook. Empty/unset -> print payload + skip (never
//                 fails a release, so merging before the secret exists is safe).
//   REPO          owner/name (GITHUB_REPOSITORY).
//   RELEASE_JSON  path to `gh release view ... --json tagName,name,body,url`.
//   DRY_RUN       "true" -> print payload, don't POST.
import { readFileSync } from "node:fs";

const webhook = (process.env.WEBHOOK_URL || "").trim();
const repoName = (process.env.REPO || "").split("/").pop() || "release";
const dryRun = process.env.DRY_RUN === "true";

const rel = JSON.parse(readFileSync(process.env.RELEASE_JSON || "release.json", "utf8"));
const tag = rel.tagName || rel.name || "";
const url = rel.url || "";

// Lead paragraph: skip leading blanks; take consecutive non-blank lines until a
// blank line, a heading (#), or a list marker (- / *).
const lines = (rel.body || "").replace(/\r/g, "").split("\n");
let i = 0;
while (i < lines.length && lines[i].trim() === "") i++;
const lead = [];
for (; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t === "" || t.startsWith("#") || t.startsWith("- ") || t.startsWith("* ")) break;
  lead.push(t);
}
let desc = lead.join(" ").trim();

// Word-boundary cap; always link out to the full notes.
const CAP = 280;
if (desc.length > CAP) {
  const cut = desc.lastIndexOf(" ", CAP);
  desc = desc.slice(0, cut > 0 ? cut : CAP).trimEnd() + "…";
}
if (!desc) {
  // The parser found no prose lead under the version heading (e.g. a CHANGELOG
  // that leads with `### Fixed`, or a manually-cut release using GitHub's
  // auto-generated notes). Post a generic line but make the gap visible in the
  // run log rather than silently shipping content-free copy.
  console.log("::warning::No lead paragraph found in the release body — posting generic copy. Check the CHANGELOG format.");
}
const description = `${desc || "New release."}\n\n[Full release notes →](${url})`;

const payload = {
  embeds: [{ title: `🚀 ${repoName} ${tag}`, url, description, color: 0x0055ff }],
};

if (!webhook || dryRun) {
  console.log(webhook ? "DRY_RUN — payload:" : "::notice::WEBHOOK_URL unset — skipping post. Payload:");
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}
const res = await fetch(webhook, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
if (!res.ok) {
  console.error(`::error::Discord webhook ${res.status}: ${await res.text().catch(() => "")}`);
  process.exit(1);
}
console.log(`Announced ${repoName} ${tag} to Discord (${res.status}).`);
