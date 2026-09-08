import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { evaluateToolCall } from "../../../src/utils/gateway-policy.js";
import { getSessionTrust } from "../../../src/sandbox/gateway-context.js";

/**
 * Gateway layer — the single chokepoint for side-effect tool calls.
 *
 * Listens to `tool_call` (before execution) and applies the allowlist policy
 * from `src/utils/gateway-policy.ts`. Trusted sessions pass through; untrusted
 * sessions (sub-agents, cron) cannot run shell or mutate the filesystem.
 * Individual extensions never re-implement these checks.
 */
export default function gateway(pi: ExtensionAPI): void {
  pi.on("tool_call", (event, ctx) => {
    const trust = getSessionTrust(ctx.sessionManager.getSessionId());
    const decision = evaluateToolCall(event.toolName, trust);
    if (!decision.allow) {
      return { block: true, reason: decision.reason };
    }
    return {};
  });
}
