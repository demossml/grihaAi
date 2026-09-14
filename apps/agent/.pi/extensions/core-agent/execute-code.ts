import { isAgentRuntimeEnabled } from "../../../src/runtime/index.js";
import {
  DEFAULT_EXECUTION_POLICY,
  preflight,
} from "../../../src/runtime/programmatic/execute.js";
import { compactExecutionResult } from "../../../src/runtime/programmatic/plan.js";
import {
  createSandboxProvider,
  type SandboxProvider,
} from "../../../src/sandbox/index.js";

/**
 * I1 (post-wiring, §20) — инструмент execute_code за флагом.
 *
 * §20: LLM → execute_code → multiple operations → compact result → LLM.
 * Sandbox обязателен для опасного кода (classifyCodeRisk → runsc).
 * Python запрещён в production runtime (master spec §0.2 — только
 * TypeScript/Node.js). Flag off → инструмент отвечает disabled (1:1 по
 * эффектам: исполнения нет).
 */

export interface ExecuteCodeToolParams {
  language: "typescript" | "javascript" | "python";
  code: string;
  expectedResult?: string;
}

export interface ExecuteCodeOutcome {
  ok: boolean;
  text: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  sandbox?: string;
  error?: string;
}

export type SandboxProviderFactory = (
  backend: "dev" | "runsc",
) => SandboxProvider;

export async function runExecuteCode(
  params: ExecuteCodeToolParams,
  env: NodeJS.ProcessEnv,
  providerFactory: SandboxProviderFactory = createSandboxProvider,
): Promise<ExecuteCodeOutcome> {
  if (!isAgentRuntimeEnabled(env)) {
    return {
      ok: false,
      text: "execute_code disabled (GRIHA_AGENT_RUNTIME off).",
      error: "disabled",
    };
  }
  if (params.language === "python") {
    return {
      ok: false,
      text: "Python запрещён в production runtime — только typescript/javascript.",
      error: "python forbidden",
    };
  }
  const request = {
    language: params.language,
    code: params.code,
    expectedResult: params.expectedResult,
  };
  const pre = preflight(request, DEFAULT_EXECUTION_POLICY);
  if (!pre.allowed) {
    return { ok: false, text: `execute_code rejected: ${pre.reason}`, error: pre.reason };
  }

  let provider: SandboxProvider;
  try {
    provider = providerFactory(pre.sandbox === "runsc" ? "runsc" : "dev");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      text: `execute_code sandbox-missing: ${message}`,
      error: `sandbox-missing: ${message}`,
    };
  }

  const startedAt = Date.now();
  const result = await provider.run({
    command: "node",
    args: ["-e", request.code],
    timeoutMs: DEFAULT_EXECUTION_POLICY.timeoutMs,
  });
  const durationMs = Date.now() - startedAt;

  if (result.error) {
    return {
      ok: false,
      text: `execute_code sandbox-missing: ${result.error}`,
      error: `sandbox-missing: ${result.error}`,
    };
  }

  const text = compactExecutionResult({
    exitCode: result.exitCode ?? 1,
    operationCount: 1,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  return {
    ok: true,
    text,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? undefined,
    sandbox: pre.sandbox,
  };
}
