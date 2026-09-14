/**
 * L1 (post-wiring, отдельный шаг) — runsc-песочница для MCP stdio-серверов.
 *
 * Hermes: внешние MCP-серверы изолируются. Здесь — обёртка спавна:
 * `runsc do --rootless --network=none -- <command> <args...>` (gVisor,
 * userspace-kernel, сеть выключена). Активируется только за флагом
 * `HERMES_AGENT_RUNTIME` и только для серверов с `sandbox: "runsc"`
 * (off / "none" = обычный spawn, 1:1).
 */
import { spawn, spawnSync } from "node:child_process";
import type { McpChildProcess, SpawnMcpFn } from "./transport.js";

export const DEFAULT_RUNSC_PATH = "runsc";

export const RUNSC_ARGS_PREFIX = ["do", "--rootless", "--network=none", "--"] as const;

/** argv для runsc-обёртки (детерминированный, без хардкода в call-sites). */
export function runscArgv(command: string, args: string[]): string[] {
  return [...RUNSC_ARGS_PREFIX, command, ...args];
}

/**
 * SpawnMcpFn-обёртка: MCP-сервер запускается внутри gVisor-песочницы.
 * Потоки stdin/stdout/stderr остаются pipe'ами — JSON-RPC не меняется.
 */
export function runscSpawn(
  command: string,
  args: string[],
  opts: { env: Record<string, string> },
  runscPath: string = DEFAULT_RUNSC_PATH,
  spawnFn: typeof spawn = spawn,
): McpChildProcess {
  return spawnFn(runscPath, runscArgv(command, args), {
    env: opts.env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as McpChildProcess;
}

/**
 * Проверка доступности runsc (`runsc --version` exit 0).
 * `probeFn` — инъекция для тестов.
 */
export function runscAvailable(
  runscPath: string = DEFAULT_RUNSC_PATH,
  probeFn: (path: string) => { status: number | null } = (p) =>
    spawnSync(p, ["--version"], { stdio: "ignore" }),
): boolean {
  try {
    return probeFn(runscPath).status === 0;
  } catch {
    return false;
  }
}

/** Фабрика спавна: runsc-обёртка или обычный spawn (1:1 с текущим). */
export function sandboxedSpawnFactory(
  sandbox: "none" | "runsc",
  runscPath: string = DEFAULT_RUNSC_PATH,
): SpawnMcpFn {
  if (sandbox === "runsc") {
    return (command, args, opts) => runscSpawn(command, args, opts, runscPath);
  }
  return (command, args, opts) =>
    spawn(command, args, { env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
}
