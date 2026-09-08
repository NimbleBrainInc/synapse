import type {
  McpUiHostContext,
  McpUiHostContextChangedNotification,
  McpUiInitializeRequest,
  McpUiInitializeResult,
  McpUiMessageRequest,
  McpUiOpenLinkRequest,
  McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps";
import {
  HOST_CONTEXT_CHANGED_METHOD,
  INITIALIZE_METHOD,
  INITIALIZED_METHOD,
  LATEST_PROTOCOL_VERSION,
  MESSAGE_METHOD,
  OPEN_LINK_METHOD,
  TOOL_RESULT_METHOD,
} from "@modelcontextprotocol/ext-apps";
import type {
  ReadResourceRequest,
  ReadResourceResult,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";

import { parseToolResultParams } from "./content-parser.js";
import { detectHost, extractTheme, foldFontFaces } from "./detection.js";
import { ACTION_METHOD, DATA_CHANGED_METHOD, resolveEventMethod } from "./event-map.js";
import { KeyboardForwarder } from "./keyboard.js";
import { createResizer } from "./resize.js";
import { parseToolResult } from "./result-parser.js";
import { createTaskStatusRouter, TOOLS_CALL_METHOD } from "./task-handle.js";
import { applyTheme, fontFacesKey } from "./theme-defaults.js";
import { SynapseTransport } from "./transport.js";
import type {
  AgentAction,
  App,
  CallToolOptions,
  ConnectOptions,
  DataChangedEvent,
  Dimensions,
  FontFaceDescriptor,
  TasksCapability,
  Theme,
  ToolCallResult,
} from "./types.js";

// Derived locally because `@modelcontextprotocol/ext-apps` only exports
// METHOD constants for ext-apps specific ui/* methods. Typing the literal
// with the spec's request `method` field still produces a compile error if
// upstream renames it.
const READ_RESOURCE_METHOD: ReadResourceRequest["method"] = "resources/read";
const UPDATE_MODEL_CONTEXT_METHOD: McpUiUpdateModelContextRequest["method"] =
  "ui/update-model-context";

/**
 * Connect to an MCP Apps host.
 *
 * The one entry point: owns the ext-apps handshake, theme injection, content
 * parsing, resize management, and event routing, and resolves to a ready
 * {@link App}.
 *
 * The `App` it returns stays deliberately small. NimbleBrain's own extensions
 * (`action`, the file picker, `downloadFile`) and the MCP tasks utility are
 * composable functions over it — import them from the package root.
 */
export async function connect(options: ConnectOptions): Promise<App> {
  const { name, version, autoResize = false, internal = false, forwardKeys } = options;

  const transport = new SynapseTransport();
  let destroyed = false;

  // --- Mutable state ---
  //
  // The host context is the single source of truth. `theme` is a derived view
  // of it, not a parallel copy.
  let hostContext: McpUiHostContext = {};
  let hostInfo: { name: string; version: string } = { name: "unknown", version: "unknown" };
  let isNimbleBrainHost = false;
  let toolInfo: { tool: Record<string, unknown> } | null = null;
  let containerDimensions: Dimensions | null = null;
  let hostTasksCapability: TasksCapability | undefined;
  let keyboard: KeyboardForwarder | null = null;

  // Font faces are the one derived value that must NOT be recomputed from a
  // replaced context. A `host-context-changed` carries only the fields that
  // changed, so a bare `{ theme: "dark" }` toggle would otherwise re-derive
  // "no fonts" and unload the host's typeface mid-session — far more visible
  // than the equivalent for a colour token. Sticky here, cleared only by an
  // explicit empty list from the host.
  let fontFaces: FontFaceDescriptor[] | undefined;

  /**
   * The theme as reported to consumers: derived from the context, with the
   * sticky faces folded back in. Every public view goes through here — the
   * `theme` getter, the `theme-changed` payload, and its equality filter — so
   * they cannot disagree with each other or with what is actually loaded.
   */
  function resolveTheme(): Theme {
    const theme = extractTheme(hostContext);
    return fontFaces ? { ...theme, fontFaces } : theme;
  }

  // --- Event handlers ---
  //
  // Generic wire methods share one registry keyed by method. The four events
  // that are a *view* over a wire message rather than the message itself
  // (theme, host context, data-changed, action) get their own sets, because
  // two of them ride the same notification and hand their subscribers
  // different payloads.
  const handlers = new Map<string, Set<(params: unknown) => void>>();
  const themeCallbacks = new Set<(theme: Theme) => void>();
  const hostContextCallbacks = new Set<(ctx: McpUiHostContext) => void>();
  const dataCallbacks = new Set<(event: DataChangedEvent) => void>();
  const actionCallbacks = new Set<(action: AgentAction) => void>();

  // --- Step 1: Set up message listener (handled by SynapseTransport constructor) ---

  // --- Step 2: Send initial size ---
  const resizer = createResizer((method, params) => transport.send(method, params), autoResize);
  resizer.measureAndSend();

  // --- Steps 3-4: Send ui/initialize and wait for response ---
  //
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
  const initParams: McpUiInitializeRequest["params"] = {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    appInfo: { name, version },
    appCapabilities:
      appCapabilities as unknown as McpUiInitializeRequest["params"]["appCapabilities"],
  };

  const result = (await transport.request(
    INITIALIZE_METHOD,
    initParams as unknown as Record<string, unknown>,
  )) as McpUiInitializeResult | null;

  // --- Step 5: Adopt the handshake response ---
  if (result) {
    const detected = detectHost(result);
    isNimbleBrainHost = detected.isNimbleBrain;
    hostInfo = {
      name: result.hostInfo?.name ?? "unknown",
      version: result.hostInfo?.version ?? "unknown",
    };

    // The ext-apps `McpUiHostCapabilities` type lacks a `tasks` field (the
    // SDK extension post-dates it), so read via the result's index signature.
    const rawTasks = (result.hostCapabilities as Record<string, unknown> | undefined)?.tasks;
    hostTasksCapability =
      rawTasks && typeof rawTasks === "object" && !Array.isArray(rawTasks)
        ? (rawTasks as TasksCapability)
        : undefined;

    const ctx: McpUiHostContext | undefined = result.hostContext;
    if (ctx) {
      hostContext = ctx;
      fontFaces = foldFontFaces(fontFaces, ctx);

      if (ctx.toolInfo && typeof ctx.toolInfo === "object") {
        toolInfo = { tool: (ctx.toolInfo.tool as unknown as Record<string, unknown>) ?? {} };
      }
      if (ctx.containerDimensions && typeof ctx.containerDimensions === "object") {
        containerDimensions = ctx.containerDimensions as Dimensions;
      }

      // Inject the theme into the DOM: the host's values go inline, and the
      // neutral defaults for the mode go in a cascade layer, where they back
      // any var nobody declares and lose to every var that is declared. Any
      // host-supplied font faces load alongside — a token names a family, it
      // cannot load one.
      const theme = resolveTheme();
      applyTheme(theme.mode, theme.tokens, theme.fontFaces);
    }
  }

  // Keyboard forwarding is a NimbleBrain extension: only a NimbleBrain host
  // consumes `synapse/keydown`. Forwarding elsewhere would `preventDefault` a
  // key for a host that does nothing with it, so the gate is on identity, not
  // just on the option.
  if (forwardKeys !== false && forwardKeys !== undefined && isNimbleBrainHost) {
    keyboard = new KeyboardForwarder(transport, forwardKeys === true ? undefined : forwardKeys);
  }

  // --- Route incoming notifications ---

  /**
   * Deliver a notification's raw params to anyone who subscribed by wire
   * method name rather than by short event. The three methods below are routed
   * by hand because each also has a typed view, and `ensureTransportSub` skips
   * them for that reason — so the raw fan-out has to happen here or a
   * `on("synapse/data-changed", …)` would silently never fire.
   */
  function fanOutRaw(method: string, params: Record<string, unknown> | undefined): void {
    const set = handlers.get(method);
    if (!set) return;
    for (const handler of set) handler(params);
  }

  // `host-context-changed` feeds three different views, so it is handled once
  // here rather than through the generic registry.
  transport.onMessage(HOST_CONTEXT_CHANGED_METHOD, (params) => {
    if (destroyed) return;
    const ctx = (params ?? {}) as Partial<McpUiHostContextChangedNotification["params"]>;
    const prevTheme = resolveTheme();
    hostContext = ctx as McpUiHostContext;
    // A host-context-changed carries only the fields that changed;
    // `foldFontFaces` owns what an absent or unusable list means (see its doc).
    fontFaces = foldFontFaces(fontFaces, ctx);
    const nextTheme = resolveTheme();

    applyTheme(nextTheme.mode, nextTheme.tokens, nextTheme.fontFaces);

    for (const cb of hostContextCallbacks) cb(hostContext);
    fanOutRaw(HOST_CONTEXT_CHANGED_METHOD, params);
    // Theme subscribers see only real theme movement: a host-context change
    // that leaves the derived theme identical (a workspace switch, say) must
    // not re-render every themed component in the app.
    if (!themesEqual(prevTheme, nextTheme)) {
      for (const cb of themeCallbacks) cb(nextTheme);
    }
  });

  transport.onMessage(DATA_CHANGED_METHOD, (params) => {
    if (destroyed) return;
    fanOutRaw(DATA_CHANGED_METHOD, params);
    if (!params) return;
    const event: DataChangedEvent = {
      source: "agent",
      server: (params.server as string) ?? "",
      tool: (params.tool as string) ?? "",
    };
    for (const cb of dataCallbacks) cb(event);
  });

  transport.onMessage(ACTION_METHOD, (params) => {
    if (destroyed) return;
    fanOutRaw(ACTION_METHOD, params);
    // The typed view drops an action with no `type` discriminator; a raw
    // subscriber above has already seen it verbatim.
    if (!params || typeof params.type !== "string") return;
    const action: AgentAction = {
      type: params.type as string,
      payload: (params.payload as Record<string, unknown>) ?? {},
      requiresConfirmation: params.requiresConfirmation === true,
      label: typeof params.label === "string" ? params.label : undefined,
    };
    for (const cb of actionCallbacks) cb(action);
  });

  // Helper to ensure a transport subscription exists for a generic method
  const subscribedMethods = new Set<string>([
    HOST_CONTEXT_CHANGED_METHOD,
    DATA_CHANGED_METHOD,
    ACTION_METHOD,
  ]);

  function ensureTransportSub(method: string): void {
    if (subscribedMethods.has(method)) return;
    subscribedMethods.add(method);

    const isToolResult = method === TOOL_RESULT_METHOD;

    transport.onMessage(method, (params) => {
      if (destroyed) return;
      const set = handlers.get(method);
      if (!set) return;
      for (const handler of set) {
        if (isToolResult) {
          handler(parseToolResultParams(params));
        } else {
          handler(params);
        }
      }
    });
  }

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
      case "data-changed":
        dataCallbacks.add(handler);
        return () => {
          dataCallbacks.delete(handler);
        };
      case "action":
        actionCallbacks.add(handler);
        return () => {
          actionCallbacks.delete(handler);
        };
      default: {
        const method = resolveEventMethod(event);
        if (!handlers.has(method)) handlers.set(method, new Set());
        handlers.get(method)?.add(handler);
        ensureTransportSub(method);
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

  // --- Step 6: Pre-register handlers from options.on, then send initialized ---
  if (options.on) {
    for (const [event, handler] of Object.entries(options.on)) {
      if (typeof handler === "function") subscribe(event, handler);
    }
  }
  transport.send(INITIALIZED_METHOD, {});

  // Shared router for `notifications/tasks/status`. Created eagerly so the
  // transport-level listener registers exactly once — every `TaskHandle`
  // filters off this single wire subscription by taskId.
  const taskRouter = createTaskStatusRouter(transport);

  // --- Step 7: Build and return the App object ---
  const app: App = {
    get theme() {
      return resolveTheme();
    },
    get hostInfo() {
      return { ...hostInfo };
    },
    get hostContext() {
      return hostContext;
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

    on(event: string, handler: (params: any) => void): () => void {
      return subscribe(event, handler);
    },

    resize(width?: number, height?: number): void {
      resizer.resize(width, height);
    },

    openLink(url: string): void {
      if (destroyed) return;
      const params: McpUiOpenLinkRequest["params"] = { url };
      // Spec: ui/open-link is a request (expects a response), not a notification
      transport
        .request(OPEN_LINK_METHOD, params as unknown as Record<string, unknown>)
        .catch(() => {
          // Fallback: if the host doesn't respond, open directly.
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
      transport.send(UPDATE_MODEL_CONTEXT_METHOD, params as unknown as Record<string, unknown>);
    },

    async callTool<TOutput = unknown>(
      toolName: string,
      args?: Record<string, unknown>,
      callOptions?: CallToolOptions,
    ): Promise<ToolCallResult<TOutput>> {
      // `server` is a NimbleBrain bridge convention for cross-server dispatch,
      // not an MCP spec field. An internal app defaults to its own name, which
      // is what makes a plain `callTool` work for one.
      const server = callOptions?.server ?? (internal ? name : undefined);
      const params = {
        name: toolName,
        arguments: args ?? {},
        ...(server !== undefined && { server }),
      };
      const raw = await transport.request(TOOLS_CALL_METHOD, params);
      return parseToolResult(raw) as ToolCallResult<TOutput>;
    },

    async readServerResource(params: ReadResourceRequest["params"]): Promise<ReadResourceResult> {
      const raw = await transport.request(
        READ_RESOURCE_METHOD,
        params as unknown as Record<string, unknown>,
      );
      return raw as ReadResourceResult;
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
      transport.send(MESSAGE_METHOD, params as unknown as Record<string, unknown>);
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
      dataCallbacks.clear();
      actionCallbacks.clear();
      transport.destroy();
    },

    _internals: {
      send(method, params) {
        if (destroyed) return;
        transport.send(method, params);
      },
      request(method, params) {
        return transport.request(method, params);
      },
      onMessage(method, handler) {
        return transport.onMessage(method, handler);
      },
      taskRouter,
      get hostTasksCapability() {
        return hostTasksCapability;
      },
      appName: name,
      internalApp: internal,
    },
  };

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
