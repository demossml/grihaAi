/**
 * system_update — tool для агента: самообновление с GitHub (только владелец).
 * Не принимает URL. Данные ~/.grish-ai не трогает.
 */
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SystemUpdateService } from "../../../src/services/update/SystemUpdateService.js";
import { isOwnerUserId } from "../../../src/services/update/owner.js";
import { getSessionContext } from "../user-rules/context.js";

export default function systemUpdate(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "system_update",
    label: "System update",
    description:
      "Обновить код Griha с GitHub demossml/grihaAi (main), только владелец бота. " +
      "Не принимает URL. Данные ~/.grish-ai не трогает.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("status"), Type.Literal("run")], {
        description: "status | run",
      }),
    }),
    async execute(
      _id: string,
      params: { action: "status" | "run" },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const userId = getSessionContext(ctx.sessionManager.getSessionId())?.userId;
      if (!isOwnerUserId(userId)) {
        const text = JSON.stringify({ ok: false, code: "DENY", message: "Только владелец бота." });
        return { content: [{ type: "text", text }], details: { result: text } };
      }
      const svc = new SystemUpdateService({
        repoDir: process.cwd(),
        assertOwner: (u) => isOwnerUserId(u),
      });
      const result =
        params.action === "run" ? await svc.run({ userId, fromCli: false }) : await svc.status();
      const text = JSON.stringify(result);
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });
}
