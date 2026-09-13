/**
 * Phase 9 (Item 9.1, матрица I1) — планирование execute_code.
 *
 * §20 master spec: один скрипт вместо N tool calls уменьшает tool-call
 * overhead; multiple operations → compact result → LLM. Чистые функции.
 */

export interface ExecuteCodePolicy {
  /** Порог числа tool calls, после которого выгоднее один скрипт. */
  toolCallThreshold: number;
}

export const DEFAULT_EXECUTE_CODE_POLICY: ExecuteCodePolicy = {
  toolCallThreshold: 3,
};

export interface CodeExecutionPlan {
  language: "typescript" | "javascript" | "python";
  code: string;
  /** Сколько tool calls заменяет скрипт (обоснование). */
  replacesToolCalls: number;
  /** Ожидаемый результат (для проверки). */
  expectedResult?: string;
}

export interface ExecuteCodeDecision {
  useCode: boolean;
  reason: string;
}

/** Решение: превратить N tool calls в один скрипт. */
export function shouldUseExecuteCode(
  toolCallCount: number,
  policy: ExecuteCodePolicy = DEFAULT_EXECUTE_CODE_POLICY,
): ExecuteCodeDecision {
  if (toolCallCount >= policy.toolCallThreshold) {
    return {
      useCode: true,
      reason: `${toolCallCount} tool calls >= порог ${policy.toolCallThreshold} — выгоднее один скрипт`,
    };
  }
  return { useCode: false, reason: `${toolCallCount} tool calls — оверхед мал` };
}

export interface ExecutionOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Число операций внутри скрипта (multiple operations). */
  operationCount: number;
}

/** Компактный результат для LLM (§20: compact result). */
export function compactExecutionResult(output: ExecutionOutput, maxChars = 2000): string {
  const parts: string[] = [`exitCode: ${output.exitCode}`, `operations: ${output.operationCount}`];
  if (output.stdout) parts.push(`stdout:\n${output.stdout}`);
  if (output.stderr) parts.push(`stderr:\n${output.stderr}`);
  const body = parts.join("\n");
  return body.length > maxChars ? body.slice(0, Math.max(0, maxChars - 1)) + "…" : body;
}

/** Проверка, что выполненный план дал ожидаемый результат. */
export function planSatisfied(plan: CodeExecutionPlan, output: ExecutionOutput): boolean {
  if (output.exitCode !== 0) return false;
  if (plan.expectedResult) {
    return output.stdout.includes(plan.expectedResult);
  }
  return true;
}
