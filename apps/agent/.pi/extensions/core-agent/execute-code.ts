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
import { runscAvailable } from "../../../src/runtime/mcp/runsc-spawn.js";
import { buildSandboxEnv } from "../../../src/sandbox/env-scrub.js";

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
  code?: string;
}

export type SandboxProviderFactory = (
  backend: "dev" | "runsc",
) => SandboxProvider;

export async function runExecuteCode(
  params: ExecuteCodeToolParams,
  env: NodeJS.ProcessEnv,
  providerFactory: SandboxProviderFactory = createSandboxProvider,
  runscAvailableFn: () => boolean = () => runscAvailable(),
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

  // P0-1: НИКОГДА не выполняем LLM-код на хосте. runsc обязателен; local —
  // только явный dev-флаг (GRIHA_EXECUTE_CODE_ALLOW_LOCAL=1 + NODE_ENV != production).
  const useLocal =
    env.GRIHA_EXECUTE_CODE_ALLOW_LOCAL === "1" && env.NODE_ENV !== "production";
  const runscOk = runscAvailableFn();
  let backend: "runsc" | "dev";
  if (runscOk) {
    backend = "runsc";
  } else if (useLocal) {
    backend = "dev";
  } else {
    return {
      ok: false,
      text:
        "execute_code unavailable: runsc (gVisor) не сконфигурирован. " +
        "Локальное исполнение — только для dev (GRIHA_EXECUTE_CODE_ALLOW_LOCAL=1 + NODE_ENV != production).",
      error: "SANDBOX_UNAVAILABLE",
      code: "SANDBOX_UNAVAILABLE",
    };
  }

  let provider: SandboxProvider;
  try {
    provider = providerFactory(backend);
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
    env: buildSandboxEnv(),
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
    sandbox: backend === "runsc" ? "runsc" : "local",
  };
}
