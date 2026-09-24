/**
 * Sandboxed execution of cron script-jobs (no-agent automation).
 *
 * Same isolation policy as execute_code: runsc required in production; refuse
 * (SANDBOX_UNAVAILABLE) when runsc is missing and local exec is not explicitly
 * allowed. Env is scrubbed (`buildSandboxEnv`) — no host secrets.
 */
import type { SandboxProvider } from "./types.js";
import { buildSandboxEnv } from "./env-scrub.js";
import type { ScriptJobSpec, ScriptRunResult } from "../runtime/automation/script.js";

export interface ScriptSandboxDeps {
  runscAvailable: () => boolean;
  /** dev-only escape hatch (GRIHA_EXECUTE_CODE_ALLOW_LOCAL=1 + non-production). */
  allowLocal: boolean;
  providerFactory: (backend: "dev" | "runsc") => SandboxProvider;
}

export async function runScriptSandboxed(
  spec: ScriptJobSpec,
  deps: ScriptSandboxDeps,
): Promise<ScriptRunResult> {
  const startedAt = Date.now();
  const runscOk = deps.runscAvailable();
  if (!runscOk && !deps.allowLocal) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "SANDBOX_UNAVAILABLE: runsc (gVisor) not configured for cron script-job.",
      durationMs: Date.now() - startedAt,
    };
  }
  const provider = deps.providerFactory(runscOk ? "runsc" : "dev");
  const result = await provider.run({
    command: spec.command,
    args: spec.args ?? [],
    timeoutMs: spec.timeoutMs,
    env: buildSandboxEnv(),
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: Date.now() - startedAt,
  };
}
