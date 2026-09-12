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

## Rows that pin a boundary rather than a goal

Most rows assert something we want. Two record something we merely need to know:

- **`a task-augmented tools/call is refused by a spec host`.** The spec's
  `AppBridge` throws on `params.task` outright, so `callToolAsTask` works
  against the NimbleBrain bridge and nowhere else. When this row starts
  *failing*, ext-apps has opened the door and the tasks helper can go portable.
- **The host advertises `tasks` outside the ext-apps capability type.** A client
  that parses the handshake result against the spec's schema drops it. Our own
  client reads the field raw and therefore sees it; an `App`-based client would
  not.

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
