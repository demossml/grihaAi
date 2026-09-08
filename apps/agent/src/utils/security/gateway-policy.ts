import type { TrustLevel } from "../../sandbox/gateway-context.js";

export interface GatewayDecision {
  allow: boolean;
  reason?: string;
}

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

/**
 * Gateway allowlist policy — the single place that decides whether a tool call
 * may execute, based on the tool name and the session's trust level.
 *
 * Trusted sessions (main interactive): everything allowed.
 * Untrusted sessions (sub-agents, cron): no shell, no file mutation; read-only
 * tools and safe custom tools still allowed.
 *
 * Pure function — no side effects; unit-tested in gateway-policy.test.ts.
 */
export function evaluateToolCall(toolName: string, trust: TrustLevel): GatewayDecision {
  if (trust === "trusted") return { allow: true };

  if (toolName === "bash" || toolName === "powershell") {
    return {
      allow: false,
      reason: "shell execution is disabled for untrusted sessions (sub-agents/cron)",
    };
  }
  if (toolName === "edit" || toolName === "write") {
    return {
      allow: false,
      reason: "file mutation is disabled for untrusted sessions (sub-agents/cron)",
    };
  }
  if (READ_ONLY_TOOLS.has(toolName)) return { allow: true };

  // Custom tools: sub-agent sessions only bind safe extensions (no cron/
  // multi-agent/memory side effects), so unknown tools are allowed here.
  return { allow: true };
}
