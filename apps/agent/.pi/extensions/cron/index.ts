import path from "node:path";
import { homedir } from "node:os";
import { Type } from "typebox";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CronService, type CronRunner } from "./CronService.js";
import { createRealCronChangeDetector, createRealCronRunner } from "./real-cron.js";
import { createRealSubAgentRunner } from "../multi-agent/RealSubAgentRunner.js";
import { getCronAuthCheck, getCronDelivery } from "./cron-bridge.js";
import { assertTargetAllowed } from "./cron-auth.js";
import { getSessionContext } from "../user-rules/context.js";
import { getUsersService } from "../../../src/services/UsersService.js";
import type { CronJob, CronRunRecord } from "../../../src/types/index.js";

const DB_PATH = path.join(homedir(), ".grish-ai", "memory.sqlite");

let service: CronService | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
/** P02: cron-расширение живёт и в главной, и в субсессиях — ticker один на процесс. */
let activeSessions = 0;

/** Emulated runner kept for offline/time-free unit tests. */
const emulatedRunner: CronRunner = async (job, prompt) => ({
  result: `[cron] ${job.name} — выполнение эмулировано (${prompt.slice(0, 120)})`,
  usedLlm: false,
});

async function getService(): Promise<CronService> {
  if (!service) {
    const svc = new CronService(
      DB_PATH,
      createRealCronRunner(createRealSubAgentRunner()),
      createRealCronChangeDetector((jobId) => svc.getStateSnapshot(jobId)),
      undefined,
      // P02: доставка читается в момент вызова — bot может пересоздаваться.
      () => getCronDelivery(),
    );
    await svc.init();
    service = svc;
  }
  return service;
}

function ensureTicker(): void {
  if (!ticker) {
    ticker = setInterval(() => {
      void getService().then((s) => s.tick());
    }, 60_000);
  }
}

export default function cron(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    activeSessions++;
    await getService();
    ensureTicker();
  });

  pi.on("session_shutdown", () => {
    activeSessions = Math.max(0, activeSessions - 1);
    if (activeSessions === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  });

  pi.registerTool({
    name: "cron_create",
    label: "Create cron job",
    description: "Создать запланированную задачу. Из Telegram-сессии target чата подставляется автоматически.",
    parameters: Type.Object({
      name: Type.String(),
      schedule: Type.String(),
      prompt: Type.String(),
      continuity: Type.Optional(Type.Boolean()),
      monitorMode: Type.Optional(Type.Boolean()),
      enabled: Type.Optional(Type.Boolean()),
      targetChatId: Type.Optional(Type.String()),
      threadId: Type.Optional(Type.Number()),
    }),
    async execute(
      _toolCallId: string,
      params: {
        name: string;
        schedule: string;
        prompt: string;
        continuity?: boolean;
        monitorMode?: boolean;
        enabled?: boolean;
        targetChatId?: string;
        threadId?: number;
      },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ job: CronJob | null }>> {
      // P02: контекст определяет target, но НЕ авторизацию (server-side check).
      const tctx = getSessionContext(ctx.sessionManager.getSessionId());
      const targetChatId = params.targetChatId ?? tctx?.chatId;
      let telegramTarget: { chatId: string; threadId?: string } | undefined;
      if (targetChatId) {
        const actor = tctx?.userId ?? "owner"; // главная сессия = оператор
        const auth = await assertTargetAllowed({
          actor,
          sessionChatId: tctx?.chatId,
          targetChatId,
          canManage: (uid) => getUsersService().canManage(uid),
          getChatMember: getCronAuthCheck() ?? undefined,
        });
        if (!auth.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Не удалось создать задачу: ${auth.reason} (чат ${targetChatId})`,
              },
            ],
            details: { job: null },
          };
        }
        telegramTarget = {
          chatId: targetChatId,
          threadId:
            params.threadId !== undefined ? String(params.threadId) : tctx?.threadId,
        };
      }
      const job = await (await getService()).createJob({
        name: params.name,
        schedule: params.schedule,
        prompt: params.prompt,
        continuity: params.continuity,
        monitorMode: params.monitorMode,
        enabled: params.enabled,
        telegramTarget,
      });
      return {
        content: [
          {
            type: "text",
            text: `Created cron job "${job.name}" (${job.id})${job.chatId ? ` → telegram ${job.chatId}` : ""}`,
          },
        ],
        details: { job },
      };
    },
  });

  pi.registerTool({
    name: "cron_list",
    label: "List cron jobs",
    description: "Показать все запланированные задачи.",
    parameters: Type.Object({}),
    async execute(): Promise<AgentToolResult<{ jobs: CronJob[] }>> {
      const jobs = await (await getService()).listJobs();
      const text =
        jobs.length === 0
          ? "No cron jobs."
          : jobs
              .map((j) => `- [${j.enabled ? "on" : "off"}] ${j.name} (${j.id}) ${j.schedule}`)
              .join("\n");
      return { content: [{ type: "text", text }], details: { jobs } };
    },
  });

  pi.registerTool({
    name: "cron_enable",
    label: "Enable cron job",
    description: "Включить запланированную задачу.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_toolCallId: string, params: { id: string }): Promise<AgentToolResult<{ job: CronJob | null }>> {
      const job = await (await getService()).setEnabled(params.id, true);
      return { content: [{ type: "text", text: job ? `Enabled ${job.name}` : "Job not found." }], details: { job } };
    },
  });

  pi.registerTool({
    name: "cron_disable",
    label: "Disable cron job",
    description: "Отключить запланированную задачу.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_toolCallId: string, params: { id: string }): Promise<AgentToolResult<{ job: CronJob | null }>> {
      const job = await (await getService()).setEnabled(params.id, false);
      return { content: [{ type: "text", text: job ? `Disabled ${job.name}` : "Job not found." }], details: { job } };
    },
  });

  pi.registerTool({
    name: "cron_run_now",
    label: "Run cron job now",
    description: "Запустить запланированную задачу вручную.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_toolCallId: string, params: { id: string }): Promise<AgentToolResult<{ run: CronRunRecord }>> {
      const run = await (await getService()).runJobNow(params.id);
      return {
        content: [{ type: "text", text: `Run ${run.status}${run.result ? `: ${run.result}` : ""}` }],
        details: { run },
      };
    },
  });

  pi.registerTool({
    name: "cron_update_notepad",
    label: "Update cron notepad",
    description: "Обновить durable notepad задачи.",
    parameters: Type.Object({ id: Type.String(), text: Type.String() }),
    async execute(_toolCallId: string, params: { id: string; text: string }): Promise<AgentToolResult<{ job: CronJob | null }>> {
      const job = await (await getService()).updateNotepad(params.id, params.text);
      return { content: [{ type: "text", text: job ? `Notepad updated for ${job.name}` : "Job not found." }], details: { job } };
    },
  });

  pi.registerCommand("cron", {
    description: "Manage cron jobs: list / create / notepad / run",
    async handler(args) {
      const [sub, ...rest] = args.trim().split(/\s+/);
      const svc = await getService();

      if (!sub || sub === "list") {
        const jobs = await svc.listJobs();
        const text =
          jobs.length === 0
            ? "No cron jobs."
            : jobs.map((j) => `- [${j.enabled ? "on" : "off"}] ${j.name} (${j.id}) ${j.schedule}`).join("\n");
        pi.sendMessage({ customType: "cron-list", content: [{ type: "text", text }], display: true, details: { jobs } });
        return;
      }

      if (sub === "create") {
        const [name, schedule, ...promptParts] = rest;
        const prompt = promptParts.join(" ");
        if (!name || !schedule || !prompt) {
          pi.sendMessage({ customType: "cron-error", content: [{ type: "text", text: "Usage: /cron create <name> <schedule> <prompt>" }], display: true });
          return;
        }
        const job = await svc.createJob({ name, schedule, prompt });
        pi.sendMessage({ customType: "cron-create", content: [{ type: "text", text: `Created "${job.name}" (${job.id})` }], display: true, details: { job } });
        return;
      }

      if (sub === "notepad") {
        const [id, ...textParts] = rest;
        const text = textParts.join(" ");
        if (!id || !text) {
          pi.sendMessage({ customType: "cron-error", content: [{ type: "text", text: "Usage: /cron notepad <id> <text>" }], display: true });
          return;
        }
        const job = await svc.updateNotepad(id, text);
        pi.sendMessage({ customType: "cron-notepad", content: [{ type: "text", text: job ? `Notepad updated for ${job.name}` : "Job not found." }], display: true });
        return;
      }

      if (sub === "run") {
        const id = rest[0];
        if (!id) {
          pi.sendMessage({ customType: "cron-error", content: [{ type: "text", text: "Usage: /cron run <id>" }], display: true });
          return;
        }
        const run = await svc.runJobNow(id);
        pi.sendMessage({ customType: "cron-run", content: [{ type: "text", text: `Run ${run.status}${run.result ? `: ${run.result}` : ""}` }], display: true, details: { run } });
        return;
      }

      pi.sendMessage({ customType: "cron-error", content: [{ type: "text", text: "Unknown subcommand. Use: /cron list|create|notepad|run" }], display: true });
    },
  });
}
