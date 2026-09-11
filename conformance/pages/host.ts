/**
 * The conformance host: the spec's own `AppBridge`, driving one app in an iframe.
 *
 * This is the point of the suite. Every client in this repo is hand-written, so
 * "does it follow the spec" can only be answered by the spec's own
 * implementation — not by another of our own parsers, which would agree with our
 * mistakes. `AppBridge` answers `ui/initialize`, validates what it receives
 * against the published schemas, and refuses what the spec does not allow.
 *
 * Two logs come out of a run, and they answer different questions:
 *
 *  - `wire` is every frame the app posted, in order, captured straight off
 *    `postMessage` before the bridge sees it. Ordering claims are asserted
 *    against this, because a frame the bridge chooses to ignore is still a frame
 *    the app sent — and a strict host is entitled to act on it.
 *  - `handled` is what the bridge routed to a handler, which is what a real host
 *    would actually observe.
 *
 * The app publishes its own view at `window.__results`; the runner reads both.
 */
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

interface Frame {
  seq: number;
  method: string;
  params?: unknown;
}

interface Conformance {
  wire: Frame[];
  handled: Frame[];
  hostEvents: string[];
  app: unknown;
  error?: string;
  done: boolean;
}

const state: Conformance = { wire: [], handled: [], hostEvents: [], app: null, done: false };
(window as unknown as { __conformance: Conformance }).__conformance = state;

let seq = 0;
const wire = (method: string, params?: unknown) => {
  state.wire.push({ seq: seq++, method, params });
};
const handled = (method: string, params?: unknown) => {
  state.handled.push({ seq: seq++, method, params });
};

const appPage = new URLSearchParams(location.search).get("app") ?? "connect";

const iframe = document.createElement("iframe");
// A real size: the app measures `document.body`, and a zero-height frame would
// make every size assertion vacuous.
iframe.style.cssText = "width:400px;height:300px;border:0";
document.body.appendChild(iframe);

// Capture the raw wire before the bridge's transport parses anything. Registered
// before the app document loads, so the handshake itself is in the log.
window.addEventListener("message", (ev) => {
  if (ev.source !== iframe.contentWindow) return;
  const msg = ev.data as { method?: string; params?: unknown; id?: unknown } | null;
  if (!msg || typeof msg !== "object") return;
  // A response carries no method. Recording it as one would put "response" in
  // the ordering log and break the "initialize is frame 0" claim.
  if (typeof msg.method !== "string") return;
  wire(msg.method, msg.params);
});

const bridge = new AppBridge(
  null,
  // The wire is the spec's; the identity is ours. `connect()` gates the
  // `synapse/*` extensions on the host naming itself `nimblebrain`, so a
  // neutral identity here would leave the extension rows untested — which is
  // the opposite of what this suite is for. How those same calls degrade off a
  // NimbleBrain host is a separate contract, asserted in the unit suite.
  { name: "nimblebrain", version: "0.0.0" },
  {
    openLinks: {},
    downloadFile: {},
    serverTools: {},
    serverResources: { listChanged: true },
    logging: {},
    updateModelContext: { text: {} },
    message: { text: {} },
    // The MCP tasks utility, advertised the way the NimbleBrain host advertises
    // it. Not modelled by the ext-apps capability type, which is the finding
    // this keeps honest: a spec client parsing the result drops it.
    tasks: { cancel: {}, requests: { tools: { call: {} } } },
  } as never,
  {
    hostContext: {
      theme: "light",
      styles: { variables: { "--color-text-primary": "#111" } },
      // A non-spec top-level key, as the NimbleBrain host sends.
      workspace: { id: "workspace-a" },
    } as never,
  },
);

bridge.oncalltool = async (params) => {
  handled("tools/call", params);
  return { content: [{ type: "text", text: "ok" }], structuredContent: { echo: params.name } };
};
bridge.onreadresource = async (params) => {
  handled("resources/read", params);
  return { contents: [{ uri: params.uri, mimeType: "text/plain", text: "hello" }] };
};
bridge.onlistresources = async (params) => {
  handled("resources/list", params);
  return { resources: [{ uri: "x://a", name: "a" }] };
};
bridge.onmessage = async (params) => {
  handled("ui/message", params);
  return {};
};
bridge.onopenlink = async (params) => {
  handled("ui/open-link", params);
  return {};
};
bridge.ondownloadfile = async (params) => {
  handled("ui/download-file", params);
  return {};
};
bridge.onupdatemodelcontext = async (params) => {
  handled("ui/update-model-context", params);
  return {};
};
bridge.onrequestdisplaymode = async (params) => {
  handled("ui/request-display-mode", params);
  return { mode: params.mode };
};
bridge.onloggingmessage = (params) => handled("notifications/message", params);
bridge.onsizechange = (params) => handled("ui/notifications/size-changed", params);
bridge.onrequestteardown = (params) => handled("ui/notifications/request-teardown", params);

// `synapse/*` and `tasks/*` are outside the spec surface, so the bridge has no
// typed setter for them — they arrive here. Answering them at all is what proves
// a custom method survives a spec host's transport in both directions.
type RawHandlers = {
  fallbackRequestHandler: (req: { method: string; params?: unknown }) => Promise<unknown>;
  fallbackNotificationHandler: (n: { method: string; params?: unknown }) => Promise<void>;
  notification: (n: { method: string; params?: unknown }) => Promise<void>;
};
const raw = bridge as unknown as RawHandlers;
raw.fallbackRequestHandler = async (req) => {
  handled(req.method, req.params);
  if (req.method === "tasks/get") {
    return {
      taskId: "task-1",
      status: "completed",
      createdAt: new Date().toISOString(),
      ttl: 1000,
    };
  }
  if (req.method === "tasks/result") return { content: [{ type: "text", text: "task done" }] };
  if (req.method === "synapse/request-file") return { files: [] };
  return {};
};
raw.fallbackNotificationHandler = async (n) => {
  handled(n.method, n.params);
};

bridge.oninitialized = () => {
  state.hostEvents.push("initialized");

  // The race the whole handshake design exists for: a result sent in the same
  // turn `initialized` arrives. An app that registers its handler after the
  // handshake instead of before loses this one silently, and presents as a view
  // that renders an empty state forever.
  void bridge.sendToolResult({
    content: [{ type: "text", text: "r" }],
    structuredContent: { answer: 42 },
  });
  state.hostEvents.push("tool-result sent");

  setTimeout(async () => {
    await bridge.sendHostContextChange({ theme: "dark" });
    state.hostEvents.push("host-context-changed sent");
    await bridge.sendResourceListChanged();
    state.hostEvents.push("resources/list_changed sent");
    await raw.notification({
      method: "synapse/data-changed",
      params: { source: "agent", server: "srv", tool: "save" },
    });
    state.hostEvents.push("synapse/data-changed sent");

    // Let the app observe all three and finish its own script.
    setTimeout(() => {
      state.app =
        (iframe.contentWindow as unknown as { __results?: unknown } | null)?.__results ?? null;
      state.done = true;
    }, 500);
  }, 200);
};

try {
  const target = iframe.contentWindow;
  if (!target) throw new Error("iframe has no contentWindow");
  await bridge.connect(new PostMessageTransport(target, target));
} catch (e) {
  state.error = `bridge.connect threw: ${String(e)}`;
  state.done = true;
}

iframe.src = `app-${appPage}.html`;

// A client that never completes the handshake would otherwise hang the runner
// with no log to read. Give up and report what was captured.
setTimeout(() => {
  if (state.done) return;
  state.error ??= "timed out waiting for the app to finish";
  state.app =
    (iframe.contentWindow as unknown as { __results?: unknown } | null)?.__results ?? null;
  state.done = true;
}, 8000);
