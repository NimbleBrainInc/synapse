/**
 * Store profiles for `synapse check`: which checks each host applies, and how
 * hard. A check a profile does not list is not run for that target.
 *
 * `error` fails the run. `warn` is reported and does not: it marks a
 * requirement the host is documented to have but is not known to enforce, so a
 * failure is a risk rather than a certain break.
 */

export type CheckId =
  | "extension-declared"
  | "ui-resource-mime"
  | "tool-resource-uri"
  | "tool-ui-meta"
  | "resource-csp"
  | "resource-openai-csp"
  | "resource-data-fonts"
  | "resource-openai-data-fonts"
  | "auth-challenge"
  | "auth-resource-metadata"
  | "auth-issuer"
  | "tool-security-schemes";

export type Severity = "error" | "warn";

export interface ProfileRule {
  severity: Severity;
  /** The host requirement behind the rule, printed when the check fails. */
  why: string;
}

export interface Profile {
  name: TargetName;
  description: string;
  rules: Partial<Record<CheckId, ProfileRule>>;
}

export type TargetName = "nimblebrain" | "claude" | "chatgpt";

const SPEC_MIME = "UI resources are served as text/html;profile=mcp-app.";
const RESOLVES = "A tool's ui.resourceUri must name a ui:// resource the server serves.";
const UI_META =
  "ui.visibility is a non-empty subset of model/app; csp and permissions belong on the resource, not the tool.";
const EXTENSION = "A client uses MCP Apps only when both sides declare io.modelcontextprotocol/ui.";
const CHALLENGE = "Sign-in starts from a 401 whose WWW-Authenticate carries resource_metadata.";
const PRM_RESOURCE =
  "The protected-resource metadata's resource must equal the connector URL exactly.";
const ISSUER =
  "The authorization server's metadata issuer must equal the advertised authorization server exactly (RFC 8414).";
const SPEC_CSP =
  "ui.csp is the frame's security policy for Claude and the NimbleBrain host, and OpenAI documents it as generally preferred for new UI; measured 2026-09-18 in ChatGPT developer mode, the frame ran under ChatGPT's own default sandbox policy whichever dialect the resource carried.";

export const PROFILES: Record<TargetName, Profile> = {
  nimblebrain: {
    name: "nimblebrain",
    description: "The NimbleBrain host.",
    rules: {
      "ui-resource-mime": { severity: "error", why: SPEC_MIME },
      "tool-resource-uri": { severity: "error", why: RESOLVES },
      "tool-ui-meta": { severity: "error", why: UI_META },
      // The host resolves an app by its ui:// scheme and does not gate on the
      // declaration, so a missing one is a portability risk, not a break.
      "extension-declared": { severity: "warn", why: EXTENSION },
      // Only reported when the server challenges at all.
      "auth-challenge": { severity: "warn", why: CHALLENGE },
      "auth-resource-metadata": { severity: "warn", why: PRM_RESOURCE },
      "auth-issuer": { severity: "warn", why: ISSUER },
    },
  },
  claude: {
    name: "claude",
    description: "claude.ai and Claude Desktop.",
    rules: {
      "ui-resource-mime": { severity: "error", why: SPEC_MIME },
      "tool-resource-uri": { severity: "error", why: RESOLVES },
      "tool-ui-meta": { severity: "error", why: UI_META },
      "extension-declared": { severity: "error", why: EXTENSION },
      "resource-csp": {
        severity: "warn",
        why: "Claude builds the frame's security policy from ui.csp; an undeclared origin is blocked.",
      },
      "resource-data-fonts": {
        severity: "error",
        why: "Claude's default security policy blocks data: fonts unless the resource declares them.",
      },
      "auth-challenge": { severity: "error", why: CHALLENGE },
      "auth-resource-metadata": { severity: "error", why: PRM_RESOURCE },
      // Claude has been observed to accept an issuer that differs by a trailing
      // slash, so this is a correctness warning for Claude rather than a break.
      "auth-issuer": { severity: "warn", why: ISSUER },
    },
  },
  chatgpt: {
    name: "chatgpt",
    description: "ChatGPT apps.",
    rules: {
      "ui-resource-mime": { severity: "error", why: SPEC_MIME },
      "tool-resource-uri": { severity: "error", why: RESOLVES },
      "tool-ui-meta": { severity: "error", why: UI_META },
      "extension-declared": { severity: "error", why: EXTENSION },
      // A requirement the vendor documents and the host was not observed to
      // enforce is what `warn` is for. Neither dialect has been observed to
      // produce an enforced policy, so both sit at warn.
      "resource-csp": { severity: "warn", why: SPEC_CSP },
      "resource-openai-csp": {
        severity: "warn",
        why: "OpenAI documents openai/widgetCSP (snake_case origin lists) as a legacy compatibility surface, and it is still the only way to declare redirect_domains. Measured 2026-09-18 in developer mode, a resource carrying it — alone or beside ui.csp — produced no enforced policy: the component ran under ChatGPT's default sandbox CSP either way. Declare it for the documented requirement; it is not known to change what the host enforces.",
      },
      "resource-openai-data-fonts": {
        severity: "warn",
        why: "A data: font is blocked by a security policy that does not declare it.",
      },
      "auth-challenge": { severity: "error", why: CHALLENGE },
      "auth-resource-metadata": { severity: "error", why: PRM_RESOURCE },
      "auth-issuer": { severity: "error", why: ISSUER },
      "tool-security-schemes": {
        severity: "error",
        why: "ChatGPT prompts for sign-in mid-conversation only for tools that declare securitySchemes.",
      },
    },
  },
};

export function isTargetName(value: string): value is TargetName {
  return Object.hasOwn(PROFILES, value);
}
