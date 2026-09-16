import type {
  AppEventMap,
  AppNotification,
  AppRequest,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiHostContextChangedNotification,
  McpUiInitializeRequest,
  McpUiMessageRequest,
  McpUiOpenLinkRequest,
  McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps";
import {
  App as ExtAppsApp,
  HOST_CONTEXT_CHANGED_METHOD,
  RESOURCE_TEARDOWN_METHOD,
  TOOL_CANCELLED_METHOD,
  TOOL_INPUT_METHOD,
  TOOL_INPUT_PARTIAL_METHOD,
  TOOL_RESULT_METHOD,
} from "@modelcontextprotocol/ext-apps";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolRequest,
  ReadResourceRequest,
  ReadResourceResult,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema, ResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { parseToolResultParams } from "./content-parser.js";
import { extractTheme, foldFontFaces } from "./detection.js";
import { resolveEventMethod } from "./event-map.js";
import { registerInternals } from "./internals.js";
import { KeyboardForwarder } from "./keyboard.js";
import { createResizer } from "./resize.js";
import { parseToolResult } from "./result-parser.js";
import {
  createTaskStatusRouter,
  readHostTasksCapability,
  TOOLS_CALL_METHOD,
} from "./task-handle.js";
import { applyTheme, fontFacesKey } from "./theme-defaults.js";
import type {
  App,
  ConnectOptions,
  Dimensions,
  FontFaceDescriptor,
  TasksCapability,
  Theme,
  ToolCallResult,
} from "./types.js";

/**
 * The host name that identifies a NimbleBrain host in the handshake. The
 * `synapse/*` extensions are gated on it.
 */
const NIMBLEBRAIN_HOST = "nimblebrain";

/**
 * Requests this SDK sends carry no deadline.
 *
 * The MCP SDK gives every request a 60-second one, which is wrong for all three
 * kinds of request an app makes: a file picker waits on a person, `tasks/result`
 * blocks until the task finishes, and a tool call takes as long as the tool
 * takes. A deadline here would reject a call the host is still working on, and
 * the app would report a failure that did not happen.
 *
 * `Infinity` is not usable — `setTimeout` coerces it to `0` and the timer fires
 * immediately — so this is the largest delay a browser timer accepts, about 24
 * days.
 */
const NO_DEADLINE: RequestOptions = { timeout: 2_147_483_647 };

/**
 * The events `App` models, paired with the wire method each one carries.
 *
 * Every one is registered exactly once, before the handshake, and fans out to
 * this SDK's own subscribers underneath. Two reasons it has to be this way: a
 * second registration for the same method through the `on*` setters throws, and
 * `App` warns when a handler for a one-shot event (the tool ones) is registered
 * after `connect()` resolves, which is when every hook subscribes.
 */
const MAPPED_EVENTS = [
  ["toolinput", TOOL_INPUT_METHOD],
  ["toolinputpartial", TOOL_INPUT_PARTIAL_METHOD],
  ["toolresult", TOOL_RESULT_METHOD],
  ["toolcancelled", TOOL_CANCELLED_METHOD],
] as const satisfies ReadonlyArray<readonly [keyof AppEventMap, string]>;

/**
 * Connect to an MCP Apps host.
 *
 * The one entry point. The protocol underneath is the spec's own client,
 * `@modelcontextprotocol/ext-apps`'s `App`: it owns the transport, the
 * handshake and the wire schemas. What this adds is the framework on top —
 * theme injection, the parsed payloads, multi-subscriber events, resize, and
 * the NimbleBrain extensions — and it resolves to a ready {@link App}.
 *
 * The `App` it returns stays deliberately small. NimbleBrain's own extensions
 * (`action`, the file picker), `downloadFile` and the MCP tasks utility are
 * composable functions over it — import them from the package root.
 */
export async function connect(options: ConnectOptions): Promise<App> {
  const { name, version, autoResize = false, forwardKeys } = options;

  let destroyed = false;

  // --- Mutable state ---
  //
  // The host context lives in `App`, which merges each delta into it, so it is
  // read back rather than copied. `theme` is a derived view of it.
  let hostInfo: { name: string; version: string } = { name: "unknown", version: "unknown" };
  let isNimbleBrainHost = false;
  let toolInfo: { tool: Record<string, unknown> } | null = null;
  let containerDimensions: Dimensions | null = null;
  let hostTasksCapability: TasksCapability | undefined;
  let hostDownloadFileCapability: McpUiHostCapabilities["downloadFile"];
  let keyboard: KeyboardForwarder | null = null;

  // Font faces are the one derived value that must NOT be recomputed from a
  // replaced context. A `host-context-changed` carries only the fields that
  // changed, so a bare `{ theme: "dark" }` toggle would otherwise re-derive
  // "no fonts" and unload the host's typeface mid-session — far more visible
  // than the equivalent for a colour token. Sticky here, cleared only by an
  // explicit empty list from the host.
  let fontFaces: FontFaceDescriptor[] | undefined;

  // The theme currently applied to the document. Tracked rather than derived at
  // dispatch time, because `App` merges a host-context delta into the context it
  // holds *before* it calls listeners — so by the time this SDK hears about a
  // change, "the theme before it" is no longer recoverable from the context.
  // Comparing against what is actually loaded is also the honest question: the
  // filter exists to skip a re-render when nothing visible moved.
  let appliedTheme: Theme = { mode: "light", tokens: {} };

  // `appCapabilities` is typed as `McpUiAppCapabilities` by the ext-apps spec
  // package, which does not yet model the MCP 2025-11-25 tasks utility. We
  // extend structurally via `TasksCapability` and `satisfies` the extension so
  // the nested objects match the spec literally — empty objects `{}` as
  // presence flags, NOT booleans.
  const appCapabilities = {
    tasks: {
      cancel: {},
      requests: { tools: { call: {} } },
    } satisfies TasksCapability,
  };

  // `autoResize` is handed to `App`, which observes the document and reports
  // size after the handshake. Ours must not observe as well: two observers mean
  // two `size-changed` streams for one document.
  const client = new ExtAppsApp(
    { name, version },
    appCapabilities as unknown as McpUiInitializeRequest["params"]["appCapabilities"],
    { autoResize },
  );

  function currentContext(): McpUiHostContext {
    return client.getHostContext() ?? {};
  }

  /**
   * The theme as reported to consumers: derived from the context, with the
   * sticky faces folded back in. Every public view goes through here — the
   * `theme` getter, the `theme-changed` payload, and its equality filter — so
   * they cannot disagree with each other or with what is actually loaded.
   */
  function resolveTheme(): Theme {
    const theme = extractTheme(currentContext());
    return fontFaces ? { ...theme, fontFaces } : theme;
  }

  /** Apply the current theme to the document, and record what was applied. */
  function applyResolvedTheme(): Theme {
    const theme = resolveTheme();
    applyTheme(theme.mode, theme.tokens, theme.fontFaces);
    appliedTheme = theme;
    return theme;
  }

  // --- Event handlers ---
  //
  // Generic wire methods share one registry keyed by method. The two events
  // that are a *view* over a wire message rather than the message itself
  // (theme, host context) get their own sets, because they ride the same
  // notification and hand their subscribers different payloads.
  const handlers = new Map<string, Set<(params: unknown) => void>>();
  const themeCallbacks = new Set<(theme: Theme) => void>();
  const hostContextCallbacks = new Set<(ctx: McpUiHostContext) => void>();

  /** Deliver a payload to everyone subscribed to a wire method. */
  function fanOut(method: string, payload: unknown): void {
    const set = handlers.get(method);
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  /**
   * Send a notification `App` does not model. The `synapse/*` extensions have
   * no spec equivalent and so no place in its notification union; the cast is
   * the one place that is admitted, and the method still comes from a constant
   * rather than a literal spelled at the call site.
   */
  function sendRaw(method: string, params?: Record<string, unknown>): void {
    if (destroyed) return;
    void client
      .notification({ method, params } as unknown as AppNotification)
      // A closed transport is the ordinary way this rejects, during teardown.
      .catch(() => {});
  }

  /** Send a request `App` does not model, and resolve with the host's result. */
  function requestRaw(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return client.request({ method, params } as unknown as AppRequest, ResultSchema, NO_DEADLINE);
  }

  // --- Route what the host sends ---
  //
  // Registered before `connect()`, so a notification the host sends the instant
  // the handshake completes is already routed.

  for (const [event, method] of MAPPED_EVENTS) {
    client.addEventListener(event, (params) => {
      if (destroyed) return;
      // `tool-result` is delivered parsed — the payload every subscriber gets,
      // however they subscribed — because the wire shape is three shapes and
      // picking between them is work each app would otherwise repeat.
      fanOut(
        method,
        method === TOOL_RESULT_METHOD
          ? parseToolResultParams(params as Record<string, unknown>)
          : params,
      );
    });
  }

  client.addEventListener("hostcontextchanged", (params) => {
    if (destroyed) return;
    const prevTheme = appliedTheme;

    // `App` has already merged this delta into the context it holds — shallowly,
    // which is what the spec asks for: `styles.variables` is a complete map when
    // the host sends one, so a deep merge would leave a host no way to remove a
    // variable.
    //
    // Fonts keep their own fold even so, because it encodes a rule the merge
    // cannot: a batch whose entries are ALL malformed reads as `undefined` and
    // must leave the loaded faces alone. Deriving from the merged context would
    // instead see the key present, find nothing usable in it, and unload the
    // host's typeface.
    fontFaces = foldFontFaces(fontFaces, params as Partial<McpUiHostContext>);
    const nextTheme = applyResolvedTheme();

    // Subscribers to the short event get the merged snapshot, because that is
    // what `app.hostContext` means and a delta cannot distinguish an omitted
    // field from a cleared one. A caller who genuinely wants the notification as
    // sent subscribes to the wire method instead, which is passed through
    // untouched.
    const merged = currentContext();
    for (const cb of hostContextCallbacks) cb(merged);
    fanOut(HOST_CONTEXT_CHANGED_METHOD, params);
    // Theme subscribers see only real theme movement: a host-context change
    // that leaves the derived theme identical (a workspace switch, say) must
    // not re-render every themed component in the app.
    if (!themesEqual(prevTheme, nextTheme)) {
      for (const cb of themeCallbacks) cb(nextTheme);
    }
  });

  // Teardown is a *request* in the spec, not a notification: the host asks, and
  // the view is expected to answer. Subscribers see it as the `teardown` event;
  // answering it is this SDK's job, not theirs.
  client.onteardown = () => {
    if (!destroyed) fanOut(RESOURCE_TEARDOWN_METHOD, undefined);
    return {};
  };

  // Everything else the host sends: the `synapse/*` extensions, the server's
  // `notifications/resources/list_changed`, and `notifications/tasks/status`.
  // `App` routes a notification here when no typed handler claims its method,
  // and one handler with a fan-out under it is the only safe shape —
  // registering a second handler for a method would silently replace the first.
  client.fallbackNotificationHandler = async (notification) => {
    if (destroyed) return;
    fanOut(notification.method, notification.params);
  };

  /** Register one handler and return its unsubscribe. */
  function subscribe(event: string, handler: (params: any) => void): () => void {
    switch (event) {
      case "theme-changed":
        themeCallbacks.add(handler);
        return () => {
          themeCallbacks.delete(handler);
        };
      case "host-context-changed":
        hostContextCallbacks.add(handler);
        return () => {
          hostContextCallbacks.delete(handler);
        };
      default: {
        const method = resolveEventMethod(event);
        if (!handlers.has(method)) handlers.set(method, new Set());
        handlers.get(method)?.add(handler);
        return () => {
          const set = handlers.get(method);
          if (set) {
            set.delete(handler);
            if (set.size === 0) handlers.delete(method);
          }
        };
      }
    }
  }

  // Handlers from `options.on` are registered before the handshake goes out, so
  // a tool result the host sends in the same turn as `initialized` is not lost.
  if (options.on) {
    for (const [event, handler] of Object.entries(options.on)) {
      if (typeof handler === "function") subscribe(event, handler);
    }
  }

  // --- The handshake: `ui/initialize`, then `initialized` ---
  await client.connect();

  const hostVersion = client.getHostVersion();
  hostInfo = {
    name: hostVersion?.name ?? "unknown",
    version: hostVersion?.version ?? "unknown",
  };
  isNimbleBrainHost = hostInfo.name === NIMBLEBRAIN_HOST;

  const hostCapabilities = client.getHostCapabilities();
  hostTasksCapability = readHostTasksCapability(hostCapabilities);
  hostDownloadFileCapability = hostCapabilities?.downloadFile;

  const initialContext = client.getHostContext();
  if (initialContext) {
    fontFaces = foldFontFaces(fontFaces, initialContext);

    if (initialContext.toolInfo && typeof initialContext.toolInfo === "object") {
      toolInfo = {
        tool: (initialContext.toolInfo.tool as unknown as Record<string, unknown>) ?? {},
      };
    }
    if (
      initialContext.containerDimensions &&
      typeof initialContext.containerDimensions === "object"
    ) {
      containerDimensions = initialContext.containerDimensions as Dimensions;
    }

    // Inject the theme into the DOM: the host's values go inline, and the
    // neutral defaults for the mode go in a cascade layer, where they back any
    // var nobody declares and lose to every var that is declared. Any
    // host-supplied font faces load alongside — a token names a family, it
    // cannot load one.
    applyResolvedTheme();
  }

  // Keyboard forwarding is a NimbleBrain extension: only a NimbleBrain host
  // consumes `synapse/keydown`. Forwarding elsewhere would `preventDefault` a
  // key for a host that does nothing with it, so the gate is on identity, not
  // just on the option.
  if (forwardKeys && isNimbleBrainHost) {
    keyboard = new KeyboardForwarder(sendRaw, forwardKeys === true ? undefined : forwardKeys);
  }

  // The resizer serves `app.resize()`. It never observes: under `autoResize`
  // that is `App`'s job, and it has already reported the first size.
  const resizer = createResizer(sendRaw, false);
  if (!autoResize) resizer.measureAndSend();

  // Shared router for `notifications/tasks/status`. Created eagerly so the
  // subscription registers exactly once — every `TaskHandle` filters off this
  // single wire subscription by taskId.
  const taskRouter = createTaskStatusRouter((method, handler) =>
    subscribe(method, handler as (params: any) => void),
  );

  // --- The App this SDK hands out ---
  const app: App = {
    get theme() {
      return resolveTheme();
    },
    get hostInfo() {
      return { ...hostInfo };
    },
    get hostContext() {
      return currentContext();
    },
    get isNimbleBrainHost() {
      return isNimbleBrainHost;
    },
    get toolInfo() {
      return toolInfo;
    },
    get containerDimensions() {
      return containerDimensions;
    },
    get destroyed() {
      return destroyed;
    },
    get supportsTasks() {
      return hostTasksCapability?.requests?.tools?.call !== undefined;
    },

    on(event: string, handler: (params: any) => void): () => void {
      return subscribe(event, handler);
    },

    resize(width?: number, height?: number): void {
      resizer.resize(width, height);
    },

    openLink(url: string): void {
      if (destroyed) return;
      const params: McpUiOpenLinkRequest["params"] = { url };
      client.openLink(params, NO_DEADLINE).catch(() => {
        // The host refused or does not serve it: open directly instead.
        window.open(url, "_blank", "noopener");
      });
    },

    updateModelContext(state: Record<string, unknown>, summary?: string): void {
      if (destroyed) return;
      const params: McpUiUpdateModelContextRequest["params"] = {
        structuredContent: state,
        ...(summary !== undefined && {
          content: [{ type: "text", text: summary } satisfies TextContent],
        }),
      };
      client.updateModelContext(params, NO_DEADLINE).catch(() => {});
    },

    async callTool<TOutput = unknown>(
      toolName: string,
      args?: Record<string, unknown>,
    ): Promise<ToolCallResult<TOutput>> {
      // No target. A host scopes an app's call to the server that mounted it,
      // so `params` carries what the spec names and nothing else.
      const params: CallToolRequest["params"] = {
        name: toolName,
        arguments: args ?? {},
      };
      // Sent through the generic request path rather than `callServerTool`,
      // which asks for a progress token: that puts `_meta.progressToken` on
      // every call, and nothing here subscribes to progress. The result is
      // validated against the spec's schema either way.
      const raw = await client.request(
        { method: TOOLS_CALL_METHOD, params },
        CallToolResultSchema,
        NO_DEADLINE,
      );
      return parseToolResult(raw) as ToolCallResult<TOutput>;
    },

    async readServerResource(params: ReadResourceRequest["params"]): Promise<ReadResourceResult> {
      return await client.readServerResource(params, NO_DEADLINE);
    },

    sendMessage(text: string, context?: { action?: string; entity?: string }): void {
      if (destroyed) return;
      const textBlock: TextContent = {
        type: "text",
        text,
        // `_meta.context` is a NimbleBrain convention; other hosts ignore it,
        // but there is no reason to spend the bytes off one.
        ...(isNimbleBrainHost && context && { _meta: { context } }),
      };
      const params: McpUiMessageRequest["params"] = {
        role: "user",
        content: [textBlock],
      };
      client.sendMessage(params, NO_DEADLINE).catch(() => {});
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      keyboard?.destroy();
      resizer.destroy();
      taskRouter.dispose();
      handlers.clear();
      themeCallbacks.clear();
      hostContextCallbacks.clear();
      void client.close();
    },
  };

  registerInternals(app, {
    send(method, params) {
      sendRaw(method, params);
    },
    request(method, params) {
      return requestRaw(method, params);
    },
    onMessage(method, handler) {
      return subscribe(method, handler as (params: any) => void);
    },
    taskRouter,
    get hostTasksCapability() {
      return hostTasksCapability;
    },
    get hostDownloadFileCapability() {
      return hostDownloadFileCapability;
    },
  });

  return app;
}

/**
 * Shallow equality for `Theme` — used to filter host-context changes that
 * don't actually move the theme (e.g. a workspace switch that leaves
 * theme/styles untouched). Cheap; tokens are ~40 entries. Typography counts:
 * a host can swap typeface without touching mode or tokens, and that must
 * still reach subscribers.
 */
function themesEqual(a: Theme, b: Theme): boolean {
  if (a.mode !== b.mode) return false;
  if (fontFacesKey(a.fontFaces) !== fontFacesKey(b.fontFaces)) return false;
  const aKeys = Object.keys(a.tokens);
  const bKeys = Object.keys(b.tokens);
  if (aKeys.length !== bKeys.length) return false;
  // Iterating only over `a`'s keys is sufficient: under equal length, any key
  // in `a` missing from `b` reads `b[k] === undefined`, which fails the strict
  // inequality check. Symmetric difference is covered.
  for (const k of aKeys) {
    if (a.tokens[k] !== b.tokens[k]) return false;
  }
  return true;
}
