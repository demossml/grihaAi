/**
 * system-update — owner-only обновление кода с GitHub (U1–U12).
 * Tool `system_update` + команда /update (через мост).
 * Не трогает ~/.grish-ai (кроме append-лога и restart.flag).
 */
import { execFile } from "node:child_process";
import { Type } from "typebox";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getConfigDir, loadConfig } from "@griha/config";
import { getUsersService, resolveOwnerId } from "../../../src/services/UsersService.js";
import {
  createRestartRequester,
  createUpdateLogger,
  findRepoRoot,
  isOwnerCheck,
  runSafeUpdate,
  type ExecResult,
  type UpdateDeps,
  type UpdateResult,
} from "../../../src/services/system/update-service.js";
import { getSessionContext } from "../user-rules/context.js";

function execPromise(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          // Код >0 и таймауты — обычный сигнал ошибки шага.
          resolve({
            code: typeof (error as { code?: unknown }).code === "number"
              ? ((error as { code: number }).code as number)
              : 1,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? "") || String(error.message ?? ""),
          });
          return;
        }
        resolve({ code: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

/** U2/U3: deps для runSafeUpdate из env/автодетекта. */
export function buildUpdateDeps(): { error: string } | { deps: UpdateDeps } {
  const dataDir = getConfigDir();
  const repoDir = process.env.GRIHA_REPO_DIR?.trim() || findRepoRoot(process.cwd());
  if (!repoDir) {
    return { error: "Репозиторий не найден (задайте GRIHA_REPO_DIR)." };
  }
  return {
    deps: {
      repoDir,
      dataDir,
      exec: execPromise,
      requestRestart: createRestartRequester(dataDir, execPromise),
      log: createUpdateLogger(dataDir),
    },
  };
}

export function formatUpdateResult(result: UpdateResult): string {
  const sha = result.beforeSha
    ? ` (${result.beforeSha.slice(0, 7)} → ${result.afterSha ? result.afterSha.slice(0, 7) : "?"})`
    : "";
  if (!result.ok) {
    return `Обновление не выполнено (шаг ${result.step}):\n${result.message}`;
  }
  const restartLabel =
    result.restart === "requested"
      ? "requested"
      : result.restart === "exit"
        ? "exit"
        : result.restart === "flag"
          ? "requested (flag)"
          : "skipped";
  return [
    `Обновление кода завершено${sha}.`,
    `Данные (~/.grish-ai) не изменялись.`,
    `Рестарт: ${restartLabel}.`,
  ].join("\n");
}

async function isOwnerUser(userId: string): Promise<boolean> {
  const cfg = loadConfig();
  return isOwnerCheck(
    {
      ownerUserId: resolveOwnerId(cfg),
      getRole: async (id) => (await getUsersService().get(id))?.role ?? null,
    },
    userId,
  );
}

/** /update — из моста: private + owner. */
export async function runUpdateCommand(userId: string, chatType: string): Promise<string> {
  if (chatType !== "private") {
    return "Команда /update только в личке.";
  }
  if (!(await isOwnerUser(userId))) {
    return "Недостаточно прав.";
  }
  const built = buildUpdateDeps();
  if ("error" in built) return built.error;
  const result = await runSafeUpdate(built.deps);
  return formatUpdateResult(result);
}

export default function systemUpdate(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "system_update",
    label: "Обновить код Гриши",
    description:
      "Owner-only: git pull --ff-only кода приложения, установка зависимостей при необходимости, сборка и запрос рестарта. Не трогает ~/.grish-ai (config/users/rules/documents/media/sessions).",
    parameters: Type.Object({
      confirm: Type.Boolean({ description: "Must be true to run" }),
    }),
    async execute(
      _id: string,
      params: { confirm: boolean },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      if (params.confirm !== true) {
        return {
          content: [{ type: "text", text: "Передайте confirm: true для запуска обновления." }],
          details: { result: "confirm required" },
        };
      }
      const sessionCtx = getSessionContext(ctx.sessionManager.getSessionId());
      const userId = sessionCtx?.userId;
      if (!userId || !(await isOwnerUser(userId))) {
        return {
          content: [{ type: "text", text: "Только владелец бота может обновлять систему." }],
          details: { result: "denied" },
        };
      }
      const built = buildUpdateDeps();
      if ("error" in built) {
        return { content: [{ type: "text", text: built.error }], details: { result: built.error } };
      }
      const result = await runSafeUpdate(built.deps);
      const text = formatUpdateResult(result);
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });
}
