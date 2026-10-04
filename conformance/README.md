# Conformance suite

```bash
npx playwright install chromium
npm run conformance
```

Every bridge in this repo is hand-written. A hand-written parser agrees with its
own author's mistakes, so "does this follow the spec" cannot be answered by
another of our own parsers — it has to be answered by the spec's own
implementation. That is what this suite is: `@modelcontextprotocol/ext-apps`'s
`AppBridge` as the host, real Chromium, and nothing under test but our wire
behaviour.

It is not a vitest file because the failures it catches are about frame
*ordering* across a real `postMessage` boundary between two documents, which
`happy-dom` has no boundary to cross.

## The three scenarios

| Scenario | Under test | Driven by |
|---|---|---|
| `connect()` | `src/` — the React path's client | the spec's `AppBridge` |
| `connectUI (vendored IIFE)` | `python/nimblebrain_synapse/_assets/synapse-ui.iife.js` | the spec's `AppBridge` |
| `preview host` | `src/preview/server.ts` — our dev host | the spec's `App` |

The third runs the other direction on purpose. The first two ask whether our
clients are correct; only pointing the spec's *client* at our *host* can ask
whether an app built on the official SDK renders in preview at all.

The `connectUI` scenario deliberately loads the **vendored** bundle rather than
bundling the TypeScript. That file is what the Python package ships and what a
self-contained `ui://` component inlines, and it is refreshed by hand from
`dist/` — so testing the source instead would test a build nobody serves. The
first thing this suite caught was a stale vendored copy.

## The tasks rows

`callToolAsTask` speaks the MCP tasks extension (`io.modelcontextprotocol/tasks`,
protocol 2026-07-28): it declares the extension in the `tools/call` `_meta`, and
the server answers with the result or with a task. The spec's `AppBridge`
passes that `_meta` through and runs the tool outright, so **`callToolAsTask
declares the extension, and a spec host's outright answer completes it`** asserts
the declaration on the wire and a handle that comes back `completed` with the
result.

It leans on **`the host's tasks capability survives the handshake`**.
`callToolAsTask` refuses to send unless it can read the host's capability, which
travels in `hostCapabilities.experimental["io.modelcontextprotocol/tasks"]`
because the ext-apps capability type has no field for it and `experimental` is
the only slot a spec client's handshake parse keeps.

## Two logs, and which one to assert against

A run produces both:

- **`wire`** — every frame the app posted, in order, captured off `postMessage`
  before the bridge sees it. Ordering claims use this, because a frame the
  bridge chooses to ignore is still a frame the app sent, and a stricter host is
  entitled to act on it.
- **`handled`** — what the bridge routed to a handler: what a real host observes.

## Adding a row

Add the call to the relevant page in `pages/`, recording its outcome under a key
on `window.__results`. Then add a row in `run.mjs` with a `why` that says what
breaks in a real host when it fails — the failure output prints it, and a row
whose justification cannot be written is a row that will be deleted by whoever
hits it next.
