# Why Synapse?

MCP ext-apps gives you an iframe and postMessage. That's enough to render HTML next to a chat — but the moment your UI needs to *collaborate* with an agent, you're writing a lot of plumbing. Synapse handles that plumbing.

This page walks through the specific problems Synapse solves, with before/after comparisons.

---

## 1. The UI goes stale when the agent acts

**The problem:** A user asks the agent to "change the headline." The agent calls `set_content` on the MCP server. The UI has no idea anything happened — it shows stale data until the user manually refreshes.

**Without Synapse:**

```javascript
// Poll every 2 seconds? Listen for a custom event?
// There's no standard mechanism in ext-apps for this.
setInterval(async () => {
  const data = await callTool("get_workspace");
  render(data);
}, 2000);
```

**With Synapse:**

```tsx
useDataSync(() => {
  refreshPreview(); // Fires when the agent calls any tool on this server
});
```

One hook. No polling. The host notifies the iframe when the agent mutates state.

---

## 2. The agent can't see what the user is doing

**The problem:** The user is looking at a filtered view — "West Coast, Q2 revenue." They ask the agent "how does this compare to last quarter?" The agent has no idea what "this" refers to.

**Without Synapse:** You'd need to serialize UI state into tool call arguments manually, or hope the user describes what they're looking at.

**With Synapse:**

```tsx
const setVisible = useVisibleState();

// Whenever the filter changes:
setVisible(
  { region: "west-coast", period: "Q2-2026" },
  "User is viewing West Coast Q2 2026 revenue"
);
```

The agent's context now includes that summary. It can answer "compare to Q1" without asking "which region?"

---

## 3. Tool calls are untyped and boilerplate-heavy

**The problem:** Every tool call through raw postMessage requires hand-rolling JSON-RPC, tracking request IDs, parsing the content array, and handling timeouts.

**Without Synapse:**

```javascript
const pending = {};

function callTool(name, args) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending[id] = { resolve, reject };
    window.parent.postMessage({
      jsonrpc: "2.0", id, method: "tools/call",
      params: { name, arguments: args || {} }
    }, "*");
    setTimeout(() => {
      if (pending[id]) { delete pending[id]; reject(new Error("Timeout")); }
    }, 10000);
  });
}

// Then parse the result manually:
function parse(r) {
  if (r?.content && Array.isArray(r.content)) {
    const t = r.content.map(c => c.text || "").join("");
    try { return JSON.parse(t); } catch { return t; }
  }
  return r;
}
```

**With Synapse:**

```tsx
const { call, data, isPending, error } = useCallTool<DocumentInfo[]>("list_documents");

// One line. Typed. Loading state included.
await call({ limit: 10 });
```

---

## 4. Theming requires manual plumbing

**The problem:** Your UI needs to match the host's light/dark mode and brand colors. With raw ext-apps, you parse theme tokens from the `ui/initialize` message, then listen for `ui/themeChanged`, then manually apply CSS variables.

**Without Synapse:**

```javascript
window.addEventListener("message", (e) => {
  const m = e.data;
  if (m.method === "ui/initialize" && m.params?.theme?.tokens) {
    for (const [k, v] of Object.entries(m.params.theme.tokens)) {
      document.documentElement.style.setProperty(k, v);
    }
  }
  if (m.method === "ui/themeChanged" && m.params?.tokens) {
    for (const [k, v] of Object.entries(m.params.tokens)) {
      document.documentElement.style.setProperty(k, v);
    }
  }
});
```

**With Synapse:**

```tsx
const theme = useTheme();

<div style={{
  background: theme.tokens["--color-background-primary"] || "#fff",
  color: theme.tokens["--color-text-primary"] || "#1a1a1a",
}}>
```

Reactive. Re-renders on change. Fallbacks for non-NimbleBrain hosts built in.

---

## 5. Local development is painful

**The problem:** To test an MCP app UI locally, you need to:
1. Start the MCP server in stdio mode
2. Write a bridge page that iframes your app
3. Wire up postMessage proxying between the iframe and the server's stdin/stdout
4. Handle the ext-apps handshake manually

**Without Synapse:** You build all of that yourself, or you deploy to a host every time you want to test.

**With Synapse:**

```typescript
// vite.config.ts
export default {
  plugins: [react(), viteSingleFile(), synapseVite()],
};
```

`npm run dev` → Vite spawns your MCP server, serves a preview host at `/__preview`, proxies tool calls, handles the handshake. HMR works inside the iframe. Edit a `.tsx` file, see the change instantly.

---

## 6. State doesn't survive iframe reloads

**The problem:** The host may reload or remount the iframe (navigation, resizing, tab switching). All your component state disappears.

**Without Synapse:** You'd need to implement your own serialization to `localStorage` or negotiate storage with the host via postMessage.

**With Synapse:**

```typescript
const store = createStore(synapse, {
  initialState: { selectedId: null, filters: {} },
  actions: { select: (state, id) => ({ ...state, selectedId: id }) },
  persist: true, // State survives iframe reloads
});
```

The host stores it. The iframe gets it back on remount.

---

## When you don't need Synapse

Synapse is optional. Skip it when:

- **Simple display-only UI** — If your UI just renders static content (a logo, a help page), raw HTML is fine.
- **One or two tools, no agent interaction** — If the user clicks a button and sees a result, and the agent never touches the same server, the postMessage boilerplate is manageable.
- **Non-iframe context** — If you're building a CLI tool or a server-only integration, there's no UI to enhance.

The [hello server](https://github.com/NimbleBrainInc/mcp-hello) ships both: a Synapse-powered React UI *and* an inline HTML fallback. Start with the fallback, upgrade to Synapse when the plumbing starts hurting.
