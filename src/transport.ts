import type {
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";

type PendingEntry = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

type MessageHandler = (params: Record<string, unknown> | undefined) => void;

export class SynapseTransport {
  private counter = 0;
  private destroyed = false;
  private pending = new Map<string, PendingEntry>();
  private handlers = new Map<string, Set<MessageHandler>>();
  private listener: (event: MessageEvent) => void;

  constructor() {
    this.listener = (event: MessageEvent) => this.handleMessage(event);
    window.addEventListener("message", this.listener);
  }

  send(method: string, params?: Record<string, unknown>): void {
    if (this.destroyed) return;

    const msg: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined && { params }),
    };
    window.parent.postMessage(msg, "*");
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.destroyed) {
      return Promise.reject(new Error("Transport destroyed"));
    }

    const id = `syn-${++this.counter}`;
    const msg: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      id,
      ...(params !== undefined && { params }),
    };

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      window.parent.postMessage(msg, "*");
    });
  }

  onMessage(method: string, callback: MessageHandler): () => void {
    if (!this.handlers.has(method)) {
      this.handlers.set(method, new Set());
    }
    this.handlers.get(method)?.add(callback);

    return () => {
      const set = this.handlers.get(method);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.handlers.delete(method);
        }
      }
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    window.removeEventListener("message", this.listener);

    const error = new Error("Transport destroyed");
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
    this.handlers.clear();
  }

  private handleMessage(event: MessageEvent): void {
    if (this.destroyed) return;

    const data = event.data as JsonRpcMessage;
    if (!data || data.jsonrpc !== "2.0") return;

    // Response to a pending request
    if ("id" in data && data.id && !("method" in data)) {
      const response = data as JsonRpcResponse;
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);

      if (response.error) {
        const err = new Error(response.error.message);
        (err as any).code = response.error.code;
        (err as any).data = response.error.data;
        entry.reject(err);
      } else {
        entry.resolve(response.result);
      }
      return;
    }

    // Incoming notification
    if ("method" in data && !("id" in data && data.id)) {
      const notification = data as JsonRpcNotification;
      const set = this.handlers.get(notification.method);
      if (set) {
        for (const handler of set) {
          handler(notification.params);
        }
      }
    }
  }
}
