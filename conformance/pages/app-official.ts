/**
 * The spec's own `App` as the app, used to test one of *our hosts*.
 *
 * The suite's other pages point our clients at the spec's host. This points the
 * spec's client at the Synapse dev preview, which is the only way to answer the
 * question that matters about it: can an app built on the official SDK render
 * in preview at all? `App.connect()` validates the `ui/initialize` result
 * against the published schema and rejects a reply that is merely close, so a
 * successful connect here is the whole assertion.
 */
import { App } from "@modelcontextprotocol/ext-apps";

const results: Record<string, unknown> = {};
(window as unknown as { __results: unknown }).__results = results;

document.body.innerHTML = '<div style="height:120px">conformance</div>';

const app = new App({ name: "conformance-official", version: "1.0.0" }, {});

try {
  await app.connect();
  results.connect = { ok: true };
  results.hostInfo = app.getHostVersion();
  results.hostContext = app.getHostContext();
  results.hostCapabilities = app.getHostCapabilities();
} catch (e) {
  results.connect = { ok: false, error: String(e) };
}

results.finished = true;
