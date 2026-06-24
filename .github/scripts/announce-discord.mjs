#!/usr/bin/env node
// Post a synapse release announcement to the NimbleBrain #announcements Discord
// webhook. Formats from the GitHub Release: a one-sentence teaser (synapse's
// CHANGELOG leads are code-dense, so the opening sentence reads far cleaner in
// Discord than the full body) plus links to the full notes and the compare diff.
//
// Synapse-specific by design — NOT a shared/reusable action. Other products get
// their own announce, tuned to their own changelog style.
//
// Env:
//   WEBHOOK_URL   Discord webhook. Empty/unset -> print payload + skip (a release
//                 never fails on a missing secret).
//   REPO          owner/name (GITHUB_REPOSITORY).
//   RELEASE_JSON  path to `gh release view ... --json tagName,name,body,url,publishedAt`.
//   PREV_TAG      previous release tag, for the compare link (optional).
//   DRY_RUN       "true" -> print payload, don't POST.
import { readFileSync } from "node:fs";

const webhook = (process.env.WEBHOOK_URL || "").trim();
const repo = process.env.REPO || "NimbleBrainInc/synapse";
const repoName = repo.split("/").pop() || "synapse";
const prevTag = (process.env.PREV_TAG || "").trim();
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
const para = lead.join(" ").trim();

// Teaser = the first sentence (+ the second only if the first is terse and they
// still fit). Sentence boundaries are detected backtick-aware, so a `.` inside an
// identifier like `tokens.bgSubtle` is never a false split.
function splitSentences(text) {
  let inCode = false;
  let start = 0;
  const out = [];
  for (let j = 0; j < text.length; j++) {
    const c = text[j];
    if (c === "`") inCode = !inCode;
    else if (!inCode && (c === "." || c === "!" || c === "?")) {
      const next = text[j + 1];
      if (next === undefined || next === " ") {
        out.push(text.slice(start, j + 1).trim());
        start = j + 1;
      }
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

const sentences = splitSentences(para);
let desc = sentences[0] || para;
if (desc.length < 70 && sentences[1] && desc.length + 1 + sentences[1].length <= 240) {
  desc += ` ${sentences[1]}`;
}

// Safety net: a runaway single sentence still gets word-boundary capped.
const CAP = 320;
if (desc.length > CAP) {
  const cut = desc.lastIndexOf(" ", CAP);
  desc = `${desc.slice(0, cut > 0 ? cut : CAP).trimEnd()}…`;
}
if (!desc) {
  console.log("::warning::No lead paragraph found in the release body — posting generic copy. Check CHANGELOG.md.");
}

const links = [`[Full release notes →](${url})`];
if (prevTag && tag) {
  links.push(`[Changelog ${prevTag}…${tag} →](https://github.com/${repo}/compare/${prevTag}...${tag})`);
}
const description = `${desc || "New release."}\n\n${links.join("\n")}`;

const payload = {
  username: "NimbleBrain Releases",
  embeds: [
    {
      title: `🚀 ${repoName} ${tag}`,
      url,
      description,
      color: 0x0055ff, // NimbleBrain brand blue
      footer: { text: "@nimblebrain/synapse" },
      ...(rel.publishedAt ? { timestamp: rel.publishedAt } : {}),
    },
  ],
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
